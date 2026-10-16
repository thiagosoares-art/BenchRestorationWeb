using Grpc.Core;
using BenchRestoration.Agent.Proto;

namespace BenchRestoration.Agent.Services;

public class AgentGrpcService : AgentService.AgentServiceBase
{
    private readonly SqlAgentService _sqlService;
    private readonly FileAgentService _fileService;
    private readonly NetworkAgentService _networkService;
    private readonly Worker _worker;
    private readonly ILogger<AgentGrpcService> _logger;

    public AgentGrpcService(
        SqlAgentService sqlService,
        FileAgentService fileService,
        NetworkAgentService networkService,
        Worker worker,
        ILogger<AgentGrpcService> logger)
    {
        _sqlService = sqlService;
        _fileService = fileService;
        _networkService = networkService;
        _worker = worker;
        _logger = logger;
    }

    public override async Task<TestConnectionResponse> TestConnection(
        TestConnectionRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var (success, message) = await _sqlService.TestConnectionAsync(
            request.ServerName, request.InstanceName, request.Username, request.Password);
        return new TestConnectionResponse { Success = success, Message = message };
    }

    public override async Task<ListInstancesResponse> ListInstances(
        ListInstancesRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var instances = await _sqlService.ListInstancesAsync(
            request.ServerName, request.Username, request.Password);

        var response = new ListInstancesResponse();
        foreach (var (name, displayName) in instances)
        {
            response.Instances.Add(new InstanceInfo { Name = name, DisplayName = displayName });
        }
        return response;
    }

    public override async Task<ListDatabasesResponse> ListDatabases(
        ListDatabasesRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var databases = await _sqlService.ListDatabasesAsync(
            request.ServerName, request.InstanceName, request.Username, request.Password);

        var response = new ListDatabasesResponse();
        foreach (var (name, sizeKB, lastBackupDate) in databases)
        {
            response.Databases.Add(new DatabaseInfo
            {
                Name = name,
                SizeKb = sizeKB,
                LastBackupDate = lastBackupDate?.ToString("yyyy-MM-dd HH:mm:ss") ?? ""
            });
        }
        return response;
    }

    public override async Task<DropDatabaseResponse> DropDatabase(
        DropDatabaseRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var successCount = 0;
        var failCount = 0;
        var messages = new List<string>();

        foreach (var dbName in request.DatabaseNames)
        {
            var (success, message) = await _sqlService.DropDatabaseAsync(
                request.ServerName, request.InstanceName,
                request.Username, request.Password, dbName);
            messages.Add(message);
            if (success) successCount++; else failCount++;
        }

        return new DropDatabaseResponse
        {
            SuccessCount = successCount,
            FailCount = failCount
        };
    }

    public override async Task<SearchBackupsResponse> SearchBackups(
        SearchBackupsRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var backupFiles = _fileService.SearchBackups(
            request.DatabaseName,
            request.BackupSources.ToList(),
            request.NetworkUsername,
            request.NetworkPassword);

        var response = new SearchBackupsResponse();
        foreach (var file in backupFiles)
        {
            var fi = new FileInfo(file);
            response.Backups.Add(new BackupInfo
            {
                Name = fi.Name,
                FilePath = file,
                SizeKb = fi.Length / 1024,
                LastBackupDate = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            });
        }
        return response;
    }

    public override async Task<CopyBackupResponse> CopyBackup(
        CopyBackupRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var drive = _fileService.ProbeServerDrive(request.ServerName);
        var destPath = $@"\\{request.ServerName}\{drive}$\Backups";

        if (!Directory.Exists(destPath))
            Directory.CreateDirectory(destPath);

        var destFile = Path.Combine(destPath, Path.GetFileName(request.SourcePath));
        var result = await _fileService.CopyFileAsync(request.SourcePath, destFile);

        return new CopyBackupResponse
        {
            Success = result != null,
            LocalPath = result ?? "",
            Message = result != null ? "Cópia concluída com sucesso" : "Falha ao copiar arquivo"
        };
    }

    public override async Task<RestoreResponse> RestoreDatabase(
        RestoreRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var (success, message) = await _sqlService.RestoreDatabaseAsync(
            request.ServerName, request.InstanceName,
            request.Username, request.Password,
            request.DatabaseName, request.BackupFilePath,
            request.RestorePath, request.WithRecovery);

        return new RestoreResponse { Success = success, Message = message };
    }

    public override async Task<VerifyIntegrityResponse> VerifyIntegrity(
        VerifyIntegrityRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var (success, message) = await _sqlService.VerifyIntegrityAsync(
            request.ServerName, request.InstanceName,
            request.Username, request.Password,
            request.BackupFilePath);

        return new VerifyIntegrityResponse { Success = success, Message = message };
    }

    public override Task<ConnectNetworkResponse> ConnectNetwork(
        ConnectNetworkRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var success = _networkService.ConnectToUNCPath(
            request.Path, request.Username, request.Password);

        return Task.FromResult(new ConnectNetworkResponse
        {
            Success = success,
            Message = success ? "Conectado com sucesso" : "Falha na conexão"
        });
    }

    public override Task<ProbeServerDriveResponse> ProbeServerDrive(
        ProbeServerDriveRequest request, ServerCallContext context)
    {
        _worker.IncrementRequestCount();
        var drive = _fileService.ProbeServerDrive(request.ServerName);
        return Task.FromResult(new ProbeServerDriveResponse { DriveLetter = drive });
    }

    public override Task<HealthCheckResponse> HealthCheck(
        HealthCheckRequest request, ServerCallContext context)
    {
        return Task.FromResult(new HealthCheckResponse
        {
            Healthy = true,
            Message = $"Agent is running. Uptime: {_worker.Uptime:hh\\:mm\\:ss}, Requests: {_worker.RequestCount}"
        });
    }
}
