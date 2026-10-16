using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Claims;
using System.Text;
using Microsoft.Data.SqlClient;
using BenchRestoration.Api.Data;
using BenchRestoration.Api.Hubs;
using BenchRestoration.Api.Security;
using BenchRestoration.Shared.Models;
using Microsoft.AspNetCore.SignalR;

namespace BenchRestoration.Api.Endpoints;

public static class RestoreEndpoints
{
    public static void MapRestoreEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/restore")
            .WithTags("Restore");

        group.MapPost("/start", async (
            HttpContext httpContext,
            RestoreRequestDto request,
            AppDbContext db,
            IHubContext<RestoreHub> hubContext,
            CancellationToken ct) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            var history = new RestoreHistoryModel
            {
                ServerName = request.ServerName,
                InstanceName = request.InstanceName,
                DatabaseName = request.DatabaseName,
                Status = RestoreStatus.EmAndamento,
                StartedAt = DateTime.Now,
                UserId = userId
            };

            db.AddRestoreHistory(history);

            async Task SendStatus(string message, string color)
            {
                await hubContext.Clients.All.SendAsync("StatusUpdate", new { message, color }, ct);
            }

            try
            {
                await SendStatus("Iniciando restauração...", "#FFC107");
                await SendStatus($"Servidor: {request.ServerName}\\{request.InstanceName}", "#FFEB3B");
                await SendStatus($"Banco de Dados: {request.DatabaseName}", "#FFEB3B");

                // Security rule check
                var hasRestoreRule = db.HasSecurityRule(request.ServerName, request.InstanceName, request.DatabaseName, "Restauração");
                if (hasRestoreRule)
                {
                    var ruleType = db.GetSecurityRuleType(request.ServerName, request.InstanceName, request.DatabaseName, "Restauração");
                    throw new Exception($"O banco '{request.DatabaseName}' não pode ser restaurado em {request.ServerName}\\{request.InstanceName} porque existe uma regra de segurança ({ruleType}) cadastrada.");
                }

                var server = string.IsNullOrEmpty(request.InstanceName) || request.InstanceName == "MSSQLSERVER"
                    ? request.ServerName
                    : $"{request.ServerName}\\{request.InstanceName}";

                var useTrusted = string.IsNullOrEmpty(request.SqlUsername) || string.IsNullOrEmpty(request.SqlPassword);

                // Find sqlcmd.exe
                var sqlCmdPath = FindSqlCmd();
                if (string.IsNullOrEmpty(sqlCmdPath))
                {
                    throw new Exception("sqlcmd.exe não encontrado. Instale o SQL Server Client Tools ou adicione ao PATH.");
                }

                await SendStatus($"sqlcmd: {sqlCmdPath}", "#00BCD4");

                // Connect to network shares with credentials (per-user settings)
                var netUser = !string.IsNullOrEmpty(request.NetworkUsername)
                    ? request.NetworkUsername
                    : db.GetUserSetting(userId, "NetworkUsername");
                var netPassRaw = !string.IsNullOrEmpty(request.NetworkPassword)
                    ? request.NetworkPassword
                    : db.GetUserSetting(userId, "NetworkPassword");
                var netPass = PasswordEncryption.Decrypt(netPassRaw ?? string.Empty);

                if (!string.IsNullOrEmpty(netUser) && !string.IsNullOrEmpty(netPass))
                {
                    await SendStatus("Autenticando com credenciais de rede...", "#00BCD4");
                    // Connect to source backup share
                    if (!string.IsNullOrEmpty(request.BackupFilePath) && request.BackupFilePath.StartsWith("\\\\"))
                    {
                        ConnectToUncPath(GetUncRoot(request.BackupFilePath), netUser, netPass);
                    }
                }

                // Determine server's backup path (UNC) - where to copy the backup
                var serverBackupPath = db.GetServers(userId).FirstOrDefault(s => s.Name == request.ServerName)?.BackupPath;
                var serverBackupUNC = !string.IsNullOrEmpty(serverBackupPath)
                    ? ToUNCPath(request.ServerName, serverBackupPath)
                    : $@"\\{request.ServerName}\D$\Backups";
                serverBackupUNC = serverBackupUNC.TrimEnd('\\');

                // Ensure backup directory exists on server
                try { Directory.CreateDirectory(serverBackupUNC); } catch { }

                // Determine restore path (local on server) - where MDF/LDF files go
                var restorePath = request.RestorePath
                    ?? db.GetServers(userId).FirstOrDefault(s => s.Name == request.ServerName)?.RestorePath
                    ?? $"D:\\Bases\\{request.InstanceName}";
                restorePath = Path.Combine(restorePath.TrimEnd('\\'), request.DatabaseName);

                // Ensure restore directory exists on server
                var restoreUNC = ToUNCPath(request.ServerName, restorePath);
                try { Directory.CreateDirectory(restoreUNC); } catch { }

                await SendStatus($"Pasta backup (servidor): {serverBackupUNC}", "#00BCD4");
                await SendStatus($"Pasta restauração (servidor): {restorePath}", "#00BCD4");

                // Item 4: Pre-check free disk space on the server's backup and restore paths
                try
                {
                    var sourceBackups = new List<string>();
                    if (!string.IsNullOrEmpty(request.BackupFilePath)) sourceBackups.Add(request.BackupFilePath);
                    if (request.BackupFilePaths != null) sourceBackups.AddRange(request.BackupFilePaths.Where(p => !string.IsNullOrEmpty(p)));
                    if (!string.IsNullOrEmpty(request.LogBackupFilePath)) sourceBackups.Add(request.LogBackupFilePath);

                    long totalBackupBytes = 0;
                    foreach (var src in sourceBackups.Distinct(StringComparer.OrdinalIgnoreCase))
                    {
                        try { totalBackupBytes += new FileInfo(src).Length; } catch { }
                    }

                    // Restoring expands the backup into MDF/LDF files; estimate a 1.5x growth factor
                    var estimatedDataBytes = (long)(totalBackupBytes * 1.5);

                    var freeBackupBytes = GetFreeDiskSpace(serverBackupUNC);
                    var freeRestoreBytes = GetFreeDiskSpace(restoreUNC);

                    if (freeRestoreBytes >= 0)
                    {
                        if (estimatedDataBytes > freeRestoreBytes)
                            await SendStatus($"[ESPAÇO] AVISO: espaço livre em '{restorePath}' ({FormatBytes(freeRestoreBytes)}) pode ser INSUFICIENTE para os arquivos de dados estimados ({FormatBytes(estimatedDataBytes)}).", "#FF9800");
                        else
                            await SendStatus($"[ESPAÇO] Espaço em '{restorePath}' suficiente: {FormatBytes(freeRestoreBytes)} livres para ~{FormatBytes(estimatedDataBytes)} de dados.", "#4CAF50");
                    }

                    if (freeBackupBytes >= 0 && totalBackupBytes > freeBackupBytes)
                        await SendStatus($"[ESPAÇO] AVISO: espaço livre na pasta de backups ({FormatBytes(freeBackupBytes)}) pode ser INSUFICIENTE para copiar {FormatBytes(totalBackupBytes)} de .bak.", "#FF9800");
                }
                catch (Exception diskEx)
                {
                    await SendStatus($"[ESPAÇO] Falha ao verificar espaço livre: {diskEx.Message}", "#FF9800");
                }

                // Guarda: sem backup informado e sem reaproveitamento, não há o que copiar
                if (!request.ReuseBackup && string.IsNullOrWhiteSpace(request.BackupFilePath))
                {
                    throw new Exception("Nenhum backup selecionado. Pesquise e selecione um backup ou use 'Reaproveitar backup'.");
                }

                ct.ThrowIfCancellationRequested();

                // Copy backup from source to server's backup dir
                string backupFileOnServer;
                var cleanupFiles = new List<string>();

                if (request.ReuseBackup)
                {
                    await SendStatus("[MODO] Reaproveitamento de backup ativado", "#FF9800");
                    await SendStatus("Buscando backup na pasta do servidor...", "#00BCD4");

                    // Search for backup in server's backup folder
                    if (!string.IsNullOrEmpty(request.BackupFilePath) && File.Exists(request.BackupFilePath))
                    {
                        // Backup path provided and exists
                        backupFileOnServer = request.BackupFilePath;
                    }
                    else
                    {
                        // Search in server's backup folder for the most recent FULL backup matching the database name
                        var searchPaths = new List<string>();
                        var srvBackupPath = db.GetServers(userId).FirstOrDefault(s => s.Name == request.ServerName)?.BackupPath;
                        if (!string.IsNullOrEmpty(srvBackupPath))
                        {
                            searchPaths.Add(ToUNCPath(request.ServerName, srvBackupPath));
                            // Also check FULL subdirectory
                            searchPaths.Add(ToUNCPath(request.ServerName, Path.Combine(srvBackupPath, "FULL")));
                        }
                        // Default fallback paths
                        searchPaths.Add($@"\\{request.ServerName}\D$\Backups");
                        searchPaths.Add($@"\\{request.ServerName}\D$\Backups\FULL");

                        string? foundBackup = null;
                        foreach (var searchPath in searchPaths)
                        {
                            try
                            {
                                if (!Directory.Exists(searchPath)) continue;
                                var bakFiles = Directory.GetFiles(searchPath, "*.bak", SearchOption.TopDirectoryOnly);
                                var matchingFiles = bakFiles.Where(f =>
                                {
                                    var fn = Path.GetFileName(f);
                                    return fn.Contains(request.DatabaseName, StringComparison.OrdinalIgnoreCase)
                                        && fn.Contains("_FULL_", StringComparison.OrdinalIgnoreCase)
                                        && !fn.Contains("_LOG_", StringComparison.OrdinalIgnoreCase);
                                }).ToList();

                                if (matchingFiles.Count > 0)
                                {
                                    foundBackup = matchingFiles.OrderByDescending(f => new FileInfo(f).LastWriteTime).First();
                                    break;
                                }
                            }
                            catch { }
                        }

                        if (foundBackup == null)
                        {
                            // Try broader search
                            foreach (var searchPath in searchPaths)
                            {
                                try
                                {
                                    if (!Directory.Exists(searchPath)) continue;
                                    var bakFiles = Directory.GetFiles(searchPath, "*.bak", SearchOption.AllDirectories);
                                    var matchingFiles = bakFiles.Where(f =>
                                    {
                                        var fn = Path.GetFileName(f);
                                        return fn.Contains(request.DatabaseName, StringComparison.OrdinalIgnoreCase)
                                            && !fn.Contains("_LOG_", StringComparison.OrdinalIgnoreCase);
                                    }).ToList();

                                    if (matchingFiles.Count > 0)
                                    {
                                        foundBackup = matchingFiles.OrderByDescending(f => new FileInfo(f).LastWriteTime).First();
                                        break;
                                    }
                                }
                                catch { }
                            }
                        }

                        if (foundBackup == null)
                            throw new Exception($"Nenhum backup encontrado na pasta do servidor para o banco '{request.DatabaseName}'");

                        backupFileOnServer = foundBackup;
                    }

                    var localCheck = NetworkPathToLocal(backupFileOnServer);
                    if (!File.Exists(backupFileOnServer) && !File.Exists(localCheck))
                        throw new Exception($"Backup não encontrado: {backupFileOnServer}");

                    await SendStatus($"Backup encontrado: {Path.GetFileName(backupFileOnServer)}", "#4CAF50");
                }
                else
                {
                    await SendStatus($"Copiando backup para o servidor...", "#FFC107");
                    await SendStatus($"De: {request.BackupFilePath}", "#888888");
                    await SendStatus($"Para: {serverBackupUNC}", "#888888");

                    try
                    {
                        var destFile = Path.Combine(serverBackupUNC, Path.GetFileName(request.BackupFilePath));
                        await CopyFileWithProgress(request.BackupFilePath, destFile, (pct, copiedMb, totalMb, _) =>
                            hubContext.Clients.All.SendAsync("CopyProgress", new { percent = pct, copiedMb, totalMb }, ct), ct);
                        backupFileOnServer = destFile;
                        cleanupFiles.Add(destFile);
                        var fileInfo = new FileInfo(destFile);
                        await SendStatus($"Cópia concluída: {(fileInfo.Length / 1024.0 / 1024.0):F1} MB", "#4CAF50");
                    }
                    catch (Exception copyEx)
                    {
                        throw new Exception($"Falha ao copiar backup para o servidor: {copyEx.Message}. Verifique as credenciais de rede.");
                    }
                }

                // The local path on the server where sqlcmd will access the file
                var backupLocalOnServer = NetworkPathToLocal(backupFileOnServer);
                await SendStatus($"Caminho local no servidor: {backupLocalOnServer}", "#00BCD4");

                try
                {
                // Detect DIFF backup: needs FULL base restored with NORECOVERY first
                var isDiffBackup = Path.GetFileName(backupLocalOnServer).Contains("_DIFF_", StringComparison.OrdinalIgnoreCase);
                string? fullLocalOnServer = null;

                if (isDiffBackup)
                {
                    // Build the candidate DIFF list: use the supplied list (most recent first)
                    // falling back to the single selected DIFF when none is provided.
                    var diffCandidates = new List<string>();
                    if (request.BackupFilePaths != null && request.BackupFilePaths.Any(p =>
                        !string.IsNullOrWhiteSpace(p) && Path.GetFileName(p).Contains("_DIFF_", StringComparison.OrdinalIgnoreCase)))
                    {
                        diffCandidates = request.BackupFilePaths
                            .Where(p => !string.IsNullOrWhiteSpace(p)
                                && Path.GetFileName(p).Contains("_DIFF_", StringComparison.OrdinalIgnoreCase)
                                && !Path.GetFileName(p).Contains("_LOG_", StringComparison.OrdinalIgnoreCase))
                            .OrderByDescending(GetFileWriteTime)
                            .ToList();
                    }
                    else
                    {
                        diffCandidates.Add(backupFileOnServer);
                    }

                    await SendStatus("[CHAIN] Backup DIFF detectado. Buscando backup FULL base...", "#FF9800");

                    var fullSourcePath = FindFullBaseForDiffAsync(db, userId, request.DatabaseName, backupFileOnServer);
                    if (string.IsNullOrEmpty(fullSourcePath))
                        throw new Exception("Nenhum backup FULL encontrado como base para o backup DIFF selecionado. Selecione também o backup FULL correspondente.");

                    await SendStatus($"FULL base encontrado: {Path.GetFileName(fullSourcePath)}", "#4CAF50");

                    // Copy FULL to server (if not already there)
                    var fullDestFile = Path.Combine(serverBackupUNC, Path.GetFileName(fullSourcePath));
                    if (!string.Equals(fullSourcePath, fullDestFile, StringComparison.OrdinalIgnoreCase))
                    {
                        await SendStatus($"Copiando backup FULL para o servidor...", "#FFC107");
                        await CopyFileWithProgress(fullSourcePath, fullDestFile, (pct, copiedMb, totalMb, _) =>
                            hubContext.Clients.All.SendAsync("CopyProgress", new { percent = pct, copiedMb, totalMb }, ct), ct);
                        cleanupFiles.Add(fullDestFile);
                    }
                    fullLocalOnServer = NetworkPathToLocal(fullDestFile);
                    await SendStatus($"FULL local no servidor: {fullLocalOnServer}", "#00BCD4");

                    // Verify FULL integrity
                    if (request.VerifyIntegrity)
                    {
                        await SendStatus($"Verificando integridade do FULL: {Path.GetFileName(fullLocalOnServer)}", "#00BCD4");
                        var fullVerifyArgs = useTrusted
                        ? $"-b -S \"{server}\" -Q \"RESTORE VERIFYONLY FROM DISK = N'{fullLocalOnServer.Replace("'", "''")}'\" -E -t 21600"
                        : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE VERIFYONLY FROM DISK = N'{fullLocalOnServer.Replace("'", "''")}'\" -t 21600";
                        var fullVerify = await RunSqlCmdAsync(sqlCmdPath, fullVerifyArgs, ct);
                        if (!fullVerify.Success)
                        {
                            var fullErr = string.IsNullOrEmpty(fullVerify.Output) ? fullVerify.Error : fullVerify.Output;
                            throw new Exception($"Falha na verificação do FULL (exit {fullVerify.ExitCode}): {fullErr}");
                        }
                        await SendStatus("Integridade do FULL verificada!", "#4CAF50");
                    }

                    // Get logical files of FULL and build MOVE clauses
                    var fullFileList = new List<(string LogicalName, string Type, string PhysicalPath)>();
                    var fullListArgs = useTrusted
                        ? $"-b -S \"{server}\" -Q \"RESTORE FILELISTONLY FROM DISK = N'{fullLocalOnServer.Replace("'", "''")}'\" -E -s \",\" -h -1 -w 4096 -t 60"
                        : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE FILELISTONLY FROM DISK = N'{fullLocalOnServer.Replace("'", "''")}'\" -s \",\" -h -1 -w 4096 -t 60";
                    var fullListResult = await RunSqlCmdAsync(sqlCmdPath, fullListArgs, ct);
                    if (fullListResult.Success && !string.IsNullOrEmpty(fullListResult.Output))
                        fullFileList = ParseFileList(fullListResult.Output);

                    var fullMoveClauses = new List<string>();
                    if (fullFileList.Count > 0)
                    {
                        int dIdx = 0, lIdx = 0, oIdx = 0;
                        foreach (var (logicalName, type, _) in fullFileList)
                        {
                            string pd;
                            if (type == "D") { dIdx++; pd = Path.Combine(restorePath, $"{request.DatabaseName}{(dIdx == 1 ? "" : $"_{dIdx}")}.mdf"); }
                            else if (type == "L") { lIdx++; pd = Path.Combine(restorePath, $"{request.DatabaseName}{(lIdx == 1 ? "_log" : $"_log{lIdx}")}.ldf"); }
                            else { oIdx++; pd = Path.Combine(restorePath, $"{request.DatabaseName}_{logicalName}{(oIdx == 1 ? "" : $"_{oIdx}")}.ndf"); }
                            fullMoveClauses.Add($"    MOVE N'{logicalName}' TO N'{pd}'");
                        }
                    }

                    // Restore FULL with NORECOVERY
                    var fullSql = fullMoveClauses.Count > 0
                        ? $"RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{fullLocalOnServer.Replace("'", "''")}' WITH {string.Join(", ", fullMoveClauses)}, REPLACE, NORECOVERY, STATS = 10"
                        : $"RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{fullLocalOnServer.Replace("'", "''")}' WITH REPLACE, NORECOVERY, STATS = 10";

                    // Kill existing connections first, but skip if DB is already in RESTORING state
                    // (RESTORING DBs have no user connections, and SINGLE_USER would break the chain)
                    var fullConnKillSql = $@"IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'{request.DatabaseName}' AND state_desc <> 'RESTORING')
BEGIN
    ALTER DATABASE [{request.DatabaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
END
{fullSql}";

                    await SendStatus("Restaurando FULL (NORECOVERY)...", "#FF9800");
                    var fullRestoreArgs = useTrusted
                        ? $"-b -S \"{server}\" -Q \"{fullConnKillSql.Replace("\"", "\\\"")}\" -E -t 21600"
                        : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{fullConnKillSql.Replace("\"", "\\\"")}\" -t 21600";
                    var fullRestore = await RunRestoreAsync(sqlCmdPath, fullRestoreArgs, server, request.DatabaseName, "FULL", useTrusted, request.SqlUsername, request.SqlPassword, hubContext, ct);
                    if (!fullRestore.Success)
                    {
                        var fullRestoreErr = string.IsNullOrEmpty(fullRestore.Output) ? fullRestore.Error : fullRestore.Output;
                        throw new Exception($"Falha na restauração do FULL (exit {fullRestore.ExitCode}): {fullRestoreErr}");
                    }
                    await SendStatus("FULL restaurado (NORECOVERY).", "#4CAF50");

                    // Validate FULL FirstLsn once to be used as the chain reference
                    var fullFirstLsn = await GetHeaderOnlyColumnAsync(sqlCmdPath, server, useTrusted, request.SqlUsername, request.SqlPassword, fullLocalOnServer, "FirstLsn", ct);
                    await SendStatus($"FULL FirstLsn: {fullFirstLsn ?? "N/D"}", "#00BCD4");

                    // Try DIFF candidates from most recent to oldest.
                    // Skip any DIFF that fails integrity verification or chain compatibility,
                    // reporting the problem in the log but continuing with the next candidate.
                    var diffProblems = new List<string>();
                    string? chosenDiffLocal = null;
                    var failedRestoreAttempts = 0;
                    const int maxFailedRestoreAttempts = 4;
                    await SendStatus($"Avaliando {diffCandidates.Count} candidato(s) DIFF (mais recente → mais antigo)...", "#00BCD4");

                    foreach (var candidate in diffCandidates)
                    {
                        ct.ThrowIfCancellationRequested();
                        var candidateName = Path.GetFileName(candidate);
                        await SendStatus($"  Avaliando DIFF: {candidateName}", "#00BCD4");

                        // Copy the candidate DIFF to the server (if not already there)
                        string candidateLocalOnServer;
                        var candidateDest = Path.Combine(serverBackupUNC, Path.GetFileName(candidate));
                        try
                        {
                            if (string.Equals(candidate, backupFileOnServer, StringComparison.OrdinalIgnoreCase)
                                || string.Equals(candidate, candidateDest, StringComparison.OrdinalIgnoreCase))
                            {
                                candidateLocalOnServer = NetworkPathToLocal(candidate);
                            }
                            else if (File.Exists(NetworkPathToLocal(candidateDest)))
                            {
                                candidateLocalOnServer = NetworkPathToLocal(candidateDest);
                            }
                            else
                            {
                                await SendStatus($"  Copiando DIFF para o servidor...", "#FFC107");
                                await CopyFileWithProgress(candidate, candidateDest, (pct, copiedMb, totalMb, _) =>
                                    hubContext.Clients.All.SendAsync("CopyProgress", new { percent = pct, copiedMb, totalMb }, ct), ct);
                                cleanupFiles.Add(candidateDest);
                                candidateLocalOnServer = NetworkPathToLocal(candidateDest);
                            }
                        }
                        catch (Exception copyEx)
                        {
                            var problem = $"{candidateName} (falha ao copiar: {copyEx.Message})";
                            diffProblems.Add(problem);
                            await SendStatus($"  [ERRO] DIFF {problem} com problema. Passando para o próximo candidato...", "#F44336");
                            continue;
                        }

                        // Verify candidate integrity
                        if (request.VerifyIntegrity)
                        {
                            var candVerifyArgs = useTrusted
                                ? $"-b -S \"{server}\" -Q \"RESTORE VERIFYONLY FROM DISK = N'{candidateLocalOnServer.Replace("'", "''")}'\" -E -t 21600"
                                : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE VERIFYONLY FROM DISK = N'{candidateLocalOnServer.Replace("'", "''")}'\" -t 21600";
                            var candVerify = await RunSqlCmdAsync(sqlCmdPath, candVerifyArgs, ct);
                            if (!candVerify.Success)
                            {
                                var candErr = string.IsNullOrEmpty(candVerify.Output) ? candVerify.Error : candVerify.Output;
                                var problem = $"{candidateName} (falha na verificação: {candErr.Trim()})";
                                diffProblems.Add(problem);
                                await SendStatus($"  [ERRO] DIFF {problem}. Passando para o próximo candidato...", "#F44336");
                                continue;
                            }
                        }

                        // Validate chain compatibility
                        var candDiffLsn = await GetHeaderOnlyColumnAsync(sqlCmdPath, server, useTrusted, request.SqlUsername, request.SqlPassword, candidateLocalOnServer, "DatabaseBackupLsn", ct);
                        await SendStatus($"  DIFF DatabaseBackupLsn: {candDiffLsn ?? "N/D"}", "#00BCD4");
                        if (!string.IsNullOrEmpty(candDiffLsn) && !string.IsNullOrEmpty(fullFirstLsn))
                        {
                            if (!string.Equals(candDiffLsn.Trim(), fullFirstLsn.Trim(), StringComparison.OrdinalIgnoreCase))
                            {
                                var problem = $"{candidateName} (cadeia incompatível: DatabaseBackupLsn={candDiffLsn} x FULL FirstLsn={fullFirstLsn})";
                                diffProblems.Add(problem);
                                await SendStatus($"  [ERRO] DIFF {problem}. Passando para o próximo candidato...", "#F44336");
                                continue;
                            }
                        }

                        // Candidate passed verification/chain: attempt the actual DIFF restore with RECOVERY.
                        await SendStatus($"  Tentando restaurar DIFF: {candidateName}", "#FF9800");

                        List<(string LogicalName, string Type, string PhysicalPath)> candFileList = new();
                        var candEsc = candidateLocalOnServer.Replace("'", "''");
                        var candListArgs = useTrusted
                            ? $"-b -S \"{server}\" -Q \"RESTORE FILELISTONLY FROM DISK = N'{candEsc}'\" -E -s \",\" -h -1 -w 4096 -t 60"
                            : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE FILELISTONLY FROM DISK = N'{candEsc}'\" -s \",\" -h -1 -w 4096 -t 60";
                        var candListResult = await RunSqlCmdAsync(sqlCmdPath, candListArgs, ct);
                        if (candListResult.Success && !string.IsNullOrEmpty(candListResult.Output))
                            candFileList = ParseFileList(candListResult.Output);

                        var candMoveClauses = new List<string>();
                        if (candFileList.Count > 0)
                        {
                            int cIdx = 0, lIdx = 0, oIdx = 0;
                            foreach (var (logicalName, type, _) in candFileList)
                            {
                                string physicalDest;
                                if (type == "D") { cIdx++; physicalDest = Path.Combine(restorePath, $"{request.DatabaseName}{(cIdx == 1 ? "" : $"_{cIdx}")}.mdf"); }
                                else if (type == "L") { lIdx++; physicalDest = Path.Combine(restorePath, $"{request.DatabaseName}{(lIdx == 1 ? "_log" : $"_log{lIdx}")}.ldf"); }
                                else { oIdx++; physicalDest = Path.Combine(restorePath, $"{request.DatabaseName}_{logicalName}{(oIdx == 1 ? "" : $"_{oIdx}")}.ndf"); }
                                candMoveClauses.Add($"    MOVE N'{logicalName}' TO N'{physicalDest}'");
                            }
                        }

                        var candRestoreSql = candMoveClauses.Count > 0
                            ? $"RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{candEsc}' WITH {string.Join(", ", candMoveClauses)}, RECOVERY, STATS = 10"
                            : $"RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{candEsc}' WITH RECOVERY, STATS = 10";
                        var candRestoreArgs = useTrusted
                            ? $"-b -S \"{server}\" -Q \"{candRestoreSql.Replace("\"", "\\\"")}\" -E -t 21600"
                            : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{candRestoreSql.Replace("\"", "\\\"")}\" -t 21600";
                        var candRestore = await RunRestoreAsync(sqlCmdPath, candRestoreArgs, server, request.DatabaseName, "RESTORE", useTrusted, request.SqlUsername, request.SqlPassword, hubContext, ct);
                        if (candRestore.Success)
                        {
                            await SendStatus($"  DIFF restaurado com sucesso: {candidateName}", "#4CAF50");
                            chosenDiffLocal = candidateLocalOnServer;
                            break;
                        }

                        // Restore failed (e.g. 3136 chain mismatch detected at execution time).
                        var candRestoreErr = string.IsNullOrEmpty(candRestore.Output) ? candRestore.Error : candRestore.Output;
                        var restoreProblem = $"{candidateName} (falha na restauração: {candRestoreErr.Trim()})";
                        diffProblems.Add(restoreProblem);
                        await SendStatus($"  [ERRO] DIFF {restoreProblem}. Passando para o próximo candidato...", "#F44336");
                        failedRestoreAttempts++;

                        // Reset the FULL base to NORECOVERY before trying the next candidate (or before
                        // finalizing with the FULL), because the failed attempt may have left the
                        // database in a partial state.
                        await SendStatus("  Re-restaurando FULL base (NORECOVERY) para a próxima tentativa...", "#FF9800");
                        var resetFullRestore = await RunRestoreAsync(sqlCmdPath, fullRestoreArgs, server, request.DatabaseName, "FULL", useTrusted, request.SqlUsername, request.SqlPassword, hubContext, ct);
                        if (!resetFullRestore.Success)
                        {
                            var resetErr = string.IsNullOrEmpty(resetFullRestore.Output) ? resetFullRestore.Error : resetFullRestore.Output;
                            throw new Exception($"Falha ao re-restaurar o FULL base (exit {resetFullRestore.ExitCode}): {resetErr}");
                        }
                        await SendStatus("  FULL base re-restaurado (NORECOVERY).", "#4CAF50");

                        // Per requirement: after 4 DIFF restore attempts without success, stop trying
                        // DIFFs and finalize the process with the FULL base only.
                        if (failedRestoreAttempts >= maxFailedRestoreAttempts)
                        {
                            await SendStatus($"[AVISO] {failedRestoreAttempts} tentativas de restauração de DIFF falharam. Encerrando tentativas e finalizando com o backup FULL base.", "#FF9800");
                            break;
                        }
                        continue;
                    }

                    if (chosenDiffLocal == null)
                    {
                        // No DIFF candidate was successfully restored. The FULL base is in place (NORECOVERY).
                        // Per requirement, a problem in a DIFF must NOT stop the process if the FULL is OK:
                        // finalize the database with the FULL base.
                        await SendStatus("[AVISO] Nenhum DIFF pôde ser restaurado. Finalizando com o backup FULL base (sem aplicar DIFF).", "#FF9800");
                        foreach (var problem in diffProblems)
                            await SendStatus($"  [ERRO] DIFF com problema: {problem}", "#F44336");

                        var fallbackSql = $"RESTORE DATABASE [{request.DatabaseName}] WITH RECOVERY";
                        var fallbackArgs = useTrusted
                            ? $"-b -S \"{server}\" -Q \"{fallbackSql.Replace("\"", "\\\"")}\" -E -t 21600"
                            : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{fallbackSql.Replace("\"", "\\\"")}\" -t 21600";
                        var fallbackResult = await RunRestoreAsync(sqlCmdPath, fallbackArgs, server, request.DatabaseName, "RESTORE", useTrusted, request.SqlUsername, request.SqlPassword, hubContext, ct);
                        if (!fallbackResult.Success)
                        {
                            var fallbackErr = string.IsNullOrEmpty(fallbackResult.Output) ? fallbackResult.Error : fallbackResult.Output;
                            throw new Exception($"Falha na finalização do FULL (exit {fallbackResult.ExitCode}): {fallbackErr}");
                        }
                        await SendStatus("Banco finalizado com o backup FULL base.", "#4CAF50");
                    }
                    else
                    {
                        backupFileOnServer = chosenDiffLocal;
                        backupLocalOnServer = chosenDiffLocal;
                        await SendStatus($"Restauração do DIFF concluída: {Path.GetFileName(chosenDiffLocal)}", "#4CAF50");
                    }
                }

                // Step 1: Verify integrity (only for non-DIFF restores; DIFF is fully handled above)
                if (!isDiffBackup && request.VerifyIntegrity)
                {
                    await SendStatus($"Verificando integridade: {Path.GetFileName(backupLocalOnServer)}", "#00BCD4");
                    var escapedPath = backupLocalOnServer.Replace("'", "''");
                    var verifyArgs = useTrusted
                        ? $"-b -S \"{server}\" -Q \"RESTORE VERIFYONLY FROM DISK = N'{escapedPath}'\" -E -t 21600"
                        : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE VERIFYONLY FROM DISK = N'{escapedPath}'\" -t 21600";

                    var verifyResult = await RunSqlCmdAsync(sqlCmdPath, verifyArgs, ct);
                    if (!verifyResult.Success)
                    {
                        var errorDetail = string.IsNullOrEmpty(verifyResult.Output) ? verifyResult.Error : verifyResult.Output;
                        throw new Exception($"Falha na verificação (exit {verifyResult.ExitCode}): {errorDetail}");
                    }
                    await SendStatus("Integridade verificada com sucesso!", "#4CAF50");
                }

                // Step 2: Get logical file names (non-DIFF; DIFF was fully handled above)
                if (!isDiffBackup)
                {
                List<(string LogicalName, string Type, string PhysicalPath)> fileList = new();
                await SendStatus("Obtendo nomes lógicos do backup...", "#00BCD4");
                var escapedPath2 = backupLocalOnServer.Replace("'", "''");
                var fileListArgs = useTrusted
                    ? $"-b -S \"{server}\" -Q \"RESTORE FILELISTONLY FROM DISK = N'{escapedPath2}'\" -E -s \",\" -h -1 -w 4096 -t 60"
                    : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE FILELISTONLY FROM DISK = N'{escapedPath2}'\" -s \",\" -h -1 -w 4096 -t 60";

                var fileListResult = await RunSqlCmdAsync(sqlCmdPath, fileListArgs, ct);
                if (fileListResult.Success && !string.IsNullOrEmpty(fileListResult.Output))
                {
                    fileList = ParseFileList(fileListResult.Output);
                    foreach (var (logicalName, type, _) in fileList)
                        await SendStatus($"  {type}: {logicalName}", "#888888");
                }

                // Step 3: Build RESTORE DATABASE command
                var moveClauses = new List<string>();
                if (fileList.Count > 0)
                {
                    int dataIdx = 0, logIdx = 0, otherIdx = 0;
                    foreach (var (logicalName, type, _) in fileList)
                    {
                        string physicalDest;
                        if (type == "D") { dataIdx++; var s = dataIdx == 1 ? "" : $"_{dataIdx}"; physicalDest = Path.Combine(restorePath, $"{request.DatabaseName}{s}.mdf"); }
                        else if (type == "L") { logIdx++; var s = logIdx == 1 ? "_log" : $"_log{logIdx}"; physicalDest = Path.Combine(restorePath, $"{request.DatabaseName}{s}.ldf"); }
                        else { otherIdx++; var s = otherIdx == 1 ? $"_{logicalName}" : $"_{logicalName}_{otherIdx}"; physicalDest = Path.Combine(restorePath, $"{request.DatabaseName}{s}.ndf"); }
                        moveClauses.Add($"    MOVE N'{logicalName}' TO N'{physicalDest}'");
                        await SendStatus($"  {type}: {logicalName} -> {physicalDest}", "#00BCD4");
                    }
                }

                var escapedBackupPath = backupLocalOnServer.Replace("'", "''");

                // Kill existing connections and restore in a SINGLE sqlcmd call
                ct.ThrowIfCancellationRequested();
                await SendStatus("Forçando desconexões e restaurando...", "#FF9800");
                string combinedSql;
                if (moveClauses.Count > 0)
                {
                    combinedSql = isDiffBackup
                        ? $"RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{escapedBackupPath}' WITH {string.Join(", ", moveClauses)}, RECOVERY, STATS = 10"
                        : $@"IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'{request.DatabaseName}')
                    BEGIN
                        ALTER DATABASE [{request.DatabaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                    END
                    RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{escapedBackupPath}' WITH {string.Join(", ", moveClauses)}, REPLACE, RECOVERY, STATS = 10";
                }
                else
                {
                    combinedSql = isDiffBackup
                        ? $"RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{escapedBackupPath}' WITH RECOVERY, STATS = 10"
                        : $@"IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'{request.DatabaseName}')
                    BEGIN
                        ALTER DATABASE [{request.DatabaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                    END
                    RESTORE DATABASE [{request.DatabaseName}] FROM DISK = N'{escapedBackupPath}' WITH REPLACE, RECOVERY, STATS = 10";
                }

                var restoreArgs = useTrusted
? $"-b -S \"{server}\" -Q \"{combinedSql.Replace("\"", "\\\"")}\" -E -t 21600"
                        : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{combinedSql.Replace("\"", "\\\"")}\" -t 21600";

                var restoreResult = await RunRestoreAsync(sqlCmdPath, restoreArgs, server, request.DatabaseName, "RESTORE", useTrusted, request.SqlUsername, request.SqlPassword, hubContext, ct);

                if (!restoreResult.Success)
                {
                    var errorDetail = string.IsNullOrEmpty(restoreResult.Output) ? restoreResult.Error : restoreResult.Output;
                    throw new Exception($"Falha na restauração (exit {restoreResult.ExitCode}): {errorDetail}");
                }
                }

                history.Status = RestoreStatus.Sucesso;
                history.FinishedAt = DateTime.Now;
                history.Duration = (history.FinishedAt - history.StartedAt)?.ToString(@"hh\:mm\:ss");
                history.BackupFile = backupFileOnServer;
                history.RestorePath = restorePath;

                // Item 3: Post-restore validation - verify DB is ONLINE and run a sanity check
                var isOnline = false;
                var postCheckParts = new List<string>();
                try
                {
                    var state = await RunScalarQueryAsync(sqlCmdPath, server, useTrusted, request.SqlUsername, request.SqlPassword,
                        $"SELECT state_desc FROM sys.databases WHERE name = N'{request.DatabaseName.Replace("'", "''")}'", "", ct);
                    isOnline = string.Equals(state?.Trim(), "ONLINE", StringComparison.OrdinalIgnoreCase);

                    if (isOnline)
                    {
                        var sanity = await RunScalarQueryAsync(sqlCmdPath, server, useTrusted, request.SqlUsername, request.SqlPassword,
                            "SELECT 1", request.DatabaseName, ct);
                        var sanityOk = sanity?.Trim() == "1";
                        postCheckParts.Add($"Estado: ONLINE | Sanity (SELECT 1): {(sanityOk ? "OK" : "Falhou")}");
                    }
                    else
                    {
                        postCheckParts.Add($"Estado: {(state ?? "N/D")} | Sanity: não executado");
                    }
                }
                catch (Exception ex)
                {
                    postCheckParts.Add($"Falha na validação pós-restauração: {ex.Message}");
                }
                history.PostCheck = string.Join(" | ", postCheckParts);
                await SendStatus($"[PÓS-RESTAURAÇÃO] {history.PostCheck}", isOnline ? "#4CAF50" : "#F44336");

                db.UpdateRestoreHistory(history);

                // Azure DevOps Pipeline Trigger
                ct.ThrowIfCancellationRequested();
                if (request.TriggerAzure)
                {
                    try
                    {
                        await SendStatus("Disparando pipeline Azure DevOps...", "#00BCD4");
                        var rawToken = (db.GetUserSetting(userId, "AzureDevOpsToken") ?? "").Trim();
                        var azureToken = PasswordEncryption.Decrypt(rawToken);
                        var azureUrl = (db.GetUserSetting(userId, "AzureDevOpsUrl") ?? "").Trim();

                        await SendStatus($"  Token stored length: {rawToken.Length} chars", "#888888");
                        if (rawToken != azureToken)
                            await SendStatus("  Token estava criptografado (DPAPI) - descriptografado", "#FF9800");
                        else
                            await SendStatus("  Token já estava em texto plano", "#4CAF50");

                        // Detect unreadable token: DPAPI blob that failed to decrypt (old SYSTEM-scoped encryption)
                        const string dpapiPrefix = "AQAAANCMnd";
                        if (azureToken.StartsWith(dpapiPrefix, StringComparison.OrdinalIgnoreCase))
                        {
                            await SendStatus("[ERRO] Token do Azure DevOps ILEGÍVEL: valor armazenado é um blob DPAPI que não pôde ser descriptografado (provavelmente criptografado antes da migração do serviço).", "#F44336");
                            await SendStatus("[ERRO] Re-digite o token em Configurações → Azure DevOps e salve para que ele seja criptografado com o formato atual.", "#F44336");
                            await SendStatus("[ERRO] A pipeline NÃO foi disparada.", "#F44336");
                        }
                        else
                        {
                        if (azureToken.Length > 10)
                            await SendStatus($"  Token preview: {azureToken[..10]}...{azureToken[^5..]}", "#888888");
                        else
                            await SendStatus($"  Token (curto): {azureToken}", "#FF9800");

                        if (!string.IsNullOrEmpty(azureToken) && !string.IsNullOrEmpty(azureUrl))
                        {
                            // Try to get definition ID from instance settings
                            var instances = db.GetInstancesByUserId(userId);
                            var instance = instances.FirstOrDefault(i => i.Name == request.InstanceName);
                            int definitionId = 0;
                            if (instance != null && instance.AzureReleaseDefinitionId > 0)
                                definitionId = instance.AzureReleaseDefinitionId;
                            else if (int.TryParse(db.GetUserSetting(userId, "AzureReleaseDefinitionId"), out var did))
                                definitionId = did;

                            if (definitionId > 0)
                            {
                                using var httpClient = new HttpClient();
                                httpClient.Timeout = TimeSpan.FromSeconds(100);
                                var base64Token = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{azureToken}"));
                                httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", base64Token);
                                httpClient.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));

                                // Use URL as-is from settings
                                var releaseUrl = azureUrl.TrimEnd('/');

                                // Build body matching desktop version format - includes variables
                                var releaseBody = new Dictionary<string, object>
                                {
                                    { "definitionId", definitionId }
                                };

                                // Add variables like desktop version does
                                var variables = new Dictionary<string, object>
                                {
                                    { "LISTABASES", new { value = request.DatabaseName } }
                                };
                                releaseBody["variables"] = variables;

                                var json = System.Text.Json.JsonSerializer.Serialize(releaseBody);
                                var content = new StringContent(json, Encoding.UTF8, "application/json");

                                await SendStatus($"  URL: {releaseUrl}", "#888888");
                                await SendStatus($"  Definition ID: {definitionId}", "#888888");
                                await SendStatus($"  Body: {json}", "#888888");

                                HttpResponseMessage? response = null;
                                string responseString = "";
                                try
                                {
                                    await SendStatus($"  Enviando POST...", "#00BCD4");
                                    response = await httpClient.PostAsync(releaseUrl, content);
                                    await SendStatus($"  Resposta recebida: HTTP {(int)response.StatusCode}", "#00BCD4");
                                    responseString = await response.Content.ReadAsStringAsync();
                                }
                                catch (Exception httpEx)
                                {
                                    await SendStatus($"  Erro HTTP: {httpEx.Message}", "#F44336");
                                }

                                if (response != null)
                                {
                                    var isJson = responseString.TrimStart().StartsWith("{") || responseString.TrimStart().StartsWith("[");

                                    if (response.IsSuccessStatusCode && isJson)
                                    {
                                        var releaseObj = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(responseString);
                                        history.TriggeredAzure = true;
                                        history.AzureReleaseId = releaseObj.TryGetProperty("id", out var idProp) ? idProp.ToString() : "OK";
                                        history.AzureStatus = MapAzureStatus(null);
                                        db.UpdateRestoreHistory(history);
                                        await SendStatus("Pipeline Azure DevOps disparado com sucesso!", "#4CAF50");
                                        if (!string.IsNullOrEmpty(history.AzureReleaseId) && history.AzureReleaseId != "OK")
                                        {
                                            _ = PollAzureStatusAsync(db, hubContext, userId, azureUrl, azureToken,
                                                [history.Id], history.AzureReleaseId, CancellationToken.None);
                                            await SendStatus($"  Acompanhando status da release #${history.AzureReleaseId}...", "#00BCD4");
                                        }
                                    }
                                    else
                                    {
                                        var contentType = response.Content.Headers.ContentType?.MediaType ?? "N/A";
                                        var isHtmlLogin = (int)response.StatusCode == 203
                                            || (contentType.Contains("html", StringComparison.OrdinalIgnoreCase) && responseString.Contains("Sign In", StringComparison.OrdinalIgnoreCase));

                                        if (isHtmlLogin)
                                        {
                                            await SendStatus($"[ERRO] Falha de autenticação no Azure DevOps: resposta HTTP {(int)response.StatusCode} (página de login). Token inválido, expirado ou sem permissão.", "#F44336");
                                            await SendStatus($"[ERRO] Verifique o token em Configurações → Azure DevOps (botão 'Testar conexão'). A pipeline NÃO foi disparada.", "#F44336");
                                        }
                                        else if ((int)response.StatusCode == 401 || (int)response.StatusCode == 203)
                                        {
                                            await SendStatus($"[ERRO] Não autorizado (HTTP {(int)response.StatusCode}): token do Azure DevOps inválido. A pipeline NÃO foi disparada.", "#F44336");
                                        }
                                        else
                                        {
                                            await SendStatus($"  HTTP Status: {(int)response.StatusCode} {response.StatusCode}", "#FF9800");
                                            await SendStatus($"  Content-Type: {contentType}", "#FF9800");
                                            await SendStatus($"  Response size: {responseString.Length} chars", "#FF9800");
                                            var preview = responseString.Length > 500 ? responseString.Substring(0, 500) : responseString;
                                            await SendStatus($"  Preview: {preview}", "#FF9800");
                                        }
                                    }
                                }
                            }
                            else
                            {
                                await SendStatus("Definition ID não configurado na instância ou nas configurações", "#FF9800");
                            }
                        }
                        else
                        {
                            await SendStatus("Token ou URL do Azure DevOps não configurado", "#FF9800");
                        }
                        }
                    }
                    catch (Exception azureEx)
                    {
                        await SendStatus($"Erro Azure DevOps: {azureEx.Message}", "#FF9800");
                    }
                }

                // Notification API Trigger
                if (request.SendNotification)
                {
                    try
                    {
                        var notificationUrl = db.GetUserSetting(userId, "NotificationApiUrl");
                        if (!string.IsNullOrEmpty(notificationUrl))
                        {
                            await SendStatus("Enviando notificação...", "#00BCD4");
                            using var httpClient = new HttpClient();
                            var ambienteNotif = $"{request.ServerName}\\{request.InstanceName}";
                            var notifBody = new
                            {
                                bancoDados = request.DatabaseName,
                                ambiente = ambienteNotif
                            };
                            var content = new StringContent(System.Text.Json.JsonSerializer.Serialize(notifBody), Encoding.UTF8, "application/json");
                            await httpClient.PostAsync(notificationUrl, content);
                            await SendStatus("Notificação enviada com sucesso!", "#4CAF50");
                        }
                    }
                    catch (Exception notifEx)
                    {
                        await SendStatus($"Aviso: Erro ao enviar notificação: {notifEx.Message}", "#FF9800");
                    }
                }

                // Log Database Restore
                ct.ThrowIfCancellationRequested();
                if (request.IncludeLogDb)
                {
                    try
                    {
                        var logDbName = $"{request.DatabaseName}_LOG";
                        var logRestorePath = request.RestorePathLog
                            ?? Path.Combine(Path.GetDirectoryName(restorePath) ?? restorePath, logDbName);
                        var logUNC = ToUNCPath(request.ServerName, logRestorePath);
                        try { Directory.CreateDirectory(logUNC); } catch { }

                        await SendStatus($"Restaurando banco de LOG: {logDbName}", "#00BCD4");

                        // Determine the log backup file
                        string? logBackupSource = null;

                        if (!string.IsNullOrEmpty(request.LogBackupFilePath))
                        {
                            logBackupSource = request.LogBackupFilePath;
                            await SendStatus($"Backup LOG selecionado: {Path.GetFileName(logBackupSource)}", "#4CAF50");
                        }
                        else
                        {
                            await SendStatus($"Buscando backup automático para {logDbName}...", "#FF9800");
                            var logCandidates = new List<string>();
                            var logSources = db.GetBackupSources(userId).Select(s => s.SharePath).ToList();
                            foreach (var ls in logSources)
                            {
                                try { if (Directory.Exists(ls)) logCandidates.AddRange(SearchBackupsRecursively(ls, logDbName)); } catch { }
                            }
                            if (logCandidates.Count == 0 && !string.IsNullOrEmpty(request.BackupFilePath))
                            {
                                var parentDir = Path.GetDirectoryName(request.BackupFilePath);
                                if (!string.IsNullOrEmpty(parentDir) && Directory.Exists(parentDir))
                                    logCandidates.AddRange(SearchBackupsRecursively(parentDir, logDbName));
                            }
                            if (logCandidates.Count == 0)
                                logCandidates.AddRange(SearchBackupsRecursively(serverBackupUNC, logDbName));

                            if (logCandidates.Count > 0)
                                logBackupSource = logCandidates.OrderByDescending(f => new FileInfo(f).LastWriteTime).First();
                        }

                        if (string.IsNullOrEmpty(logBackupSource))
                        {
                            await SendStatus($"Nenhum backup encontrado para {logDbName}", "#FF9800");
                        }
                        else
                        {
                            await SendStatus($"Backup LOG: {Path.GetFileName(logBackupSource)}", "#4CAF50");

                            // Copy to server if needed
                            string logLocalPath;
                            if (logBackupSource.StartsWith(serverBackupUNC, StringComparison.OrdinalIgnoreCase)
                                || logBackupSource.StartsWith($@"\\{request.ServerName}\", StringComparison.OrdinalIgnoreCase))
                            {
                                logLocalPath = NetworkPathToLocal(logBackupSource);
                                await SendStatus($"Backup LOG já está no servidor", "#888888");
                            }
                            else
                            {
                                var logDestFile = Path.Combine(serverBackupUNC, Path.GetFileName(logBackupSource));
                                await CopyFileWithProgress(logBackupSource, logDestFile, null, ct);
                                cleanupFiles.Add(logDestFile);
                                logLocalPath = NetworkPathToLocal(logDestFile);
                                await SendStatus($"Backup LOG copiado para o servidor", "#888888");
                            }

                            // Get file list
                            var logEscaped = logLocalPath.Replace("'", "''");
                            var logFileListArgs = useTrusted
                                ? $"-b -S \"{server}\" -Q \"RESTORE FILELISTONLY FROM DISK = N'{logEscaped}'\" -s \",\" -h -1 -w 4096 -t 60"
                                : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"RESTORE FILELISTONLY FROM DISK = N'{logEscaped}'\" -s \",\" -h -1 -w 4096 -t 60";

                            var logFileListResult = await RunSqlCmdAsync(sqlCmdPath, logFileListArgs, ct);
                            var logMoveClauses = new List<string>();

                            if (logFileListResult.Success && !string.IsNullOrEmpty(logFileListResult.Output))
                            {
                                var logFiles = ParseFileList(logFileListResult.Output);
                                int logDataIdx = 0, logLogIdx = 0;
                                foreach (var (logicalName, type, _) in logFiles)
                                {
                                    string physicalDest;
                                    if (type == "D") { logDataIdx++; var s = logDataIdx == 1 ? "" : $"_{logDataIdx}"; physicalDest = Path.Combine(logRestorePath, $"{logDbName}{s}.mdf"); }
                                    else if (type == "L") { logLogIdx++; var s = logLogIdx == 1 ? "_log" : $"_log{logLogIdx}"; physicalDest = Path.Combine(logRestorePath, $"{logDbName}{s}.ldf"); }
                                    else { physicalDest = Path.Combine(logRestorePath, $"{logDbName}_{logicalName}.ndf"); }
                                    logMoveClauses.Add($"    MOVE N'{logicalName}' TO N'{physicalDest}'");
                                    await SendStatus($"  LOG {type}: {logicalName} -> {physicalDest}", "#888888");
                                }
                            }

                            string logCombinedSql;
                            if (logMoveClauses.Count > 0)
                            {
                                logCombinedSql = $@"IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'{logDbName}')
                                BEGIN
                                    ALTER DATABASE [{logDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                                END
                                RESTORE DATABASE [{logDbName}] FROM DISK = N'{logEscaped}' WITH {string.Join(", ", logMoveClauses)}, REPLACE, RECOVERY, STATS = 10";
                            }
                            else
                            {
                                logCombinedSql = $@"IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'{logDbName}')
                                BEGIN
                                    ALTER DATABASE [{logDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                                END
                                RESTORE DATABASE [{logDbName}] FROM DISK = N'{logEscaped}' WITH REPLACE, RECOVERY, STATS = 10";
                            }

                            var logRestoreArgs = useTrusted
                                ? $"-b -S \"{server}\" -Q \"{logCombinedSql.Replace("\"", "\\\"")}\" -E -t 21600"
                                : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{logCombinedSql.Replace("\"", "\\\"")}\" -t 21600";

                            var logRestoreResult = await RunRestoreAsync(sqlCmdPath, logRestoreArgs, server, logDbName, "LOG", useTrusted, request.SqlUsername, request.SqlPassword, hubContext, ct);

                            if (logRestoreResult.Success)
                                await SendStatus($"Banco de LOG restaurado com sucesso: {logDbName}", "#4CAF50");
                            else
                                await SendStatus($"Aviso: Falha ao restaurar LOG: {logRestoreResult.Error}", "#FF9800");

                        }
                    }
                    catch (Exception logEx)
                    {
                        await SendStatus($"Aviso: Erro ao restaurar banco LOG: {logEx.Message}", "#FF9800");
                    }
                }

                // Execute Post-Restore Scripts
                try
                {
                    var scriptsBasePath = db.GetUserSetting(userId, "ScriptsRestoreBasePath");
                    var executedScripts = false;

                    // First: Try pattern-based script folders (like desktop version)
                    if (!string.IsNullOrEmpty(scriptsBasePath) && Directory.Exists(scriptsBasePath))
                    {
                        var scriptFolder = ResolveScriptsFolder(scriptsBasePath, request.DatabaseName);
                        if (!string.IsNullOrEmpty(scriptFolder) && Directory.Exists(scriptFolder))
                        {
                            var sqlFiles = Directory.GetFiles(scriptFolder, "*.sql").OrderBy(f => f).ToList();
                            if (sqlFiles.Count > 0)
                            {
                                await SendStatus($"Executando {sqlFiles.Count} script(s) pós-restauração...", "#00BCD4");
                                foreach (var sqlFile in sqlFiles)
                                {
                                    try
                                    {
                                        await SendStatus($"  Executando: {Path.GetFileName(sqlFile)}", "#888888");
                                        var scriptContent = await File.ReadAllTextAsync(sqlFile, ct);

                                        // Replace template variables
                                        scriptContent = scriptContent
                                            .Replace("$DATABASE", request.DatabaseName)
                                            .Replace("$SERVER", request.ServerName)
                                            .Replace("$INSTANCE", request.InstanceName);

                                        // sqlcmd connects with QUOTED_IDENTIFIER OFF by default (SSMS uses ON);
                                        // restoring/scripting tables with filtered indexes or computed columns
                                        // requires it ON, otherwise UPDATE fails with Msg 1934.
                                        scriptContent = "SET QUOTED_IDENTIFIER ON;" + scriptContent;

                                        var scriptArgs = useTrusted
                                            ? $"-b -S \"{server}\" -Q \"{scriptContent.Replace("\"", "\\\"")}\" -E -t 300"
                                            : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{scriptContent.Replace("\"", "\\\"")}\" -t 300";

                                        var scriptResult = await RunSqlCmdAsync(sqlCmdPath, scriptArgs, ct, line =>
                                        {
                                            hubContext.Clients.All.SendAsync("StatusUpdate", new { message = line, color = "#888888" }, ct);
                                        });

                                        if (scriptResult.Success)
                                            await SendStatus($"  Script executado com sucesso: {Path.GetFileName(sqlFile)}", "#4CAF50");
                                        else
                                            await SendStatus($"  Aviso: Script falhou: {scriptResult.Error}", "#FF9800");
                                    }
                                    catch (Exception scriptEx)
                                    {
                                        await SendStatus($"  Aviso: Erro ao executar script: {scriptEx.Message}", "#FF9800");
                                    }
                                }
                                executedScripts = true;
                            }
                        }
                    }

                    // Second: Try scripts from PostRestoreScripts table
                    if (!executedScripts)
                    {
                        var scripts = db.GetPostRestoreScripts();
                        var matchingScripts = scripts.Where(s =>
                            s.DatabaseName.Equals(request.DatabaseName, StringComparison.OrdinalIgnoreCase) ||
                            request.DatabaseName.StartsWith(s.DatabaseName, StringComparison.OrdinalIgnoreCase)
                        ).OrderBy(s => s.SortOrder).ToList();

                        if (matchingScripts.Count > 0)
                        {
                            await SendStatus($"Executando {matchingScripts.Count} script(s) pós-restauração...", "#00BCD4");
                            foreach (var script in matchingScripts)
                            {
                                try
                                {
                                    var scriptPath = script.ScriptPath;
                                    // Resolve relative path from ScriptsRestoreBasePath setting
                                    if (!Path.IsPathRooted(scriptPath) && !string.IsNullOrEmpty(scriptsBasePath))
                                        scriptPath = Path.Combine(scriptsBasePath, scriptPath);

                                    await SendStatus($"  Executando: {Path.GetFileName(scriptPath)}", "#888888");

                                    if (File.Exists(scriptPath))
                                    {
                                        var scriptContent = await File.ReadAllTextAsync(scriptPath, ct);
                                        scriptContent = scriptContent
                                            .Replace("$DATABASE", request.DatabaseName)
                                            .Replace("$SERVER", request.ServerName)
                                            .Replace("$INSTANCE", request.InstanceName);

                                        // sqlcmd connects with QUOTED_IDENTIFIER OFF by default (SSMS uses ON);
                                        // tables with filtered indexes or computed columns require it ON (Msg 1934 otherwise).
                                        scriptContent = "SET QUOTED_IDENTIFIER ON;" + scriptContent;

                                        var scriptArgs = useTrusted
                                            ? $"-b -S \"{server}\" -Q \"{scriptContent.Replace("\"", "\\\"")}\" -E -t 300"
                                            : $"-b -S \"{server}\" -U {request.SqlUsername} -P {request.SqlPassword} -Q \"{scriptContent.Replace("\"", "\\\"")}\" -t 300";

                                        var scriptResult = await RunSqlCmdAsync(sqlCmdPath, scriptArgs, ct);
                                        if (scriptResult.Success)
                                            await SendStatus($"  Script executado com sucesso: {Path.GetFileName(scriptPath)}", "#4CAF50");
                                        else
                                            await SendStatus($"  Aviso: Script falhou: {scriptResult.Error}", "#FF9800");
                                    }
                                    else
                                    {
                                        await SendStatus($"  Aviso: Script não encontrado: {scriptPath}", "#FF9800");
                                    }
                                }
                                catch (Exception scriptEx)
                                {
                                    await SendStatus($"  Aviso: Erro ao executar script: {scriptEx.Message}", "#FF9800");
                                }
                            }
                        }
                    }
                }
                catch (Exception scriptsEx)
                {
                    await SendStatus($"Aviso: Erro ao processar scripts pós-restauração: {scriptsEx.Message}", "#FF9800");
                }

                await SendStatus("", "#00BCD4");
                await SendStatus("Restauração concluída com sucesso!", "#4CAF50");
                await SendStatus($"Duração: {history.Duration}", "#4CAF50");

                // Notify all clients that restore is complete
                await hubContext.Clients.All.SendAsync("RestoreComplete", new { historyId = history.Id, success = true, databaseName = request.DatabaseName }, ct);

                return Results.Ok(new { success = true, message = "Restauração concluída com sucesso", historyId = history.Id, duration = history.Duration });
                }
                finally
                {
                    // Cleanup all copied backups from server
                    if (cleanupFiles.Count > 0 && request.CleanupAfterRestore)
                    {
                        try
                        {
                            await SendStatus("Removendo backups copiados do servidor...", "#888888");
                            foreach (var file in cleanupFiles)
                            {
                                try
                                {
                                    if (File.Exists(NetworkPathToLocal(file)))
                                        File.Delete(NetworkPathToLocal(file));
                                    else if (File.Exists(file))
                                        File.Delete(file);
                                }
                                catch { }
                            }
                        }
                        catch { }
                    }
                }
            }
            catch (Exception ex)
            {
                history.Status = RestoreStatus.Erro;
                history.ErrorMessage = ex.Message;
                history.FinishedAt = DateTime.Now;
                history.Duration = (history.FinishedAt - history.StartedAt)?.ToString(@"hh\:mm\:ss");
                db.UpdateRestoreHistory(history);

                await SendStatus($"[ERRO] {ex.Message}", "#F44336");

                // Notify all clients that restore failed
                await hubContext.Clients.All.SendAsync("RestoreComplete", new { historyId = history.Id, success = false, databaseName = request.DatabaseName }, ct);

                return Results.Ok(new
                {
                    success = false,
                    message = ex.Message,
                    historyId = history.Id
                });
            }
        });

        group.MapPost("/batch-azure-trigger", async (
            HttpContext httpContext,
            BatchAzureTriggerRequest request,
            AppDbContext db,
            IHubContext<RestoreHub> hubContext) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            try
            {
                var rawToken = (db.GetUserSetting(userId, "AzureDevOpsToken") ?? "").Trim();
                var azureToken = PasswordEncryption.Decrypt(rawToken);
                var azureUrl = (db.GetUserSetting(userId, "AzureDevOpsUrl") ?? "").Trim();

                const string dpapiPrefix = "AQAAANCMnd";
                if (azureToken.StartsWith(dpapiPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    return Results.Ok(new { success = false, message = "[ERRO] Token do Azure DevOps ILEGÍVEL: valor armazenado é um blob DPAPI que não pôde ser descriptografado. Re-digite o token em Configurações → Azure DevOps e salve." });
                }

                if (string.IsNullOrEmpty(azureToken) || string.IsNullOrEmpty(azureUrl))
                {
                    return Results.Ok(new { success = false, message = "URL ou token do Azure DevOps não configurado" });
                }

                // Determine definition ID: instance-setting first, then user-level
                var instances = db.GetInstancesByUserId(userId);
                var instance = instances.FirstOrDefault(i => i.Name == request.InstanceName);
                int definitionId = 0;
                if (instance != null && instance.AzureReleaseDefinitionId > 0)
                    definitionId = instance.AzureReleaseDefinitionId;
                else if (int.TryParse(db.GetUserSetting(userId, "AzureReleaseDefinitionId"), out var did))
                    definitionId = did;

                if (definitionId <= 0)
                {
                    return Results.Ok(new { success = false, message = "Definition ID do Azure DevOps não configurado na instância nem nas configurações" });
                }

                var listabases = string.Join(" ", request.DatabaseNames);

                using var httpClient = new HttpClient();
                httpClient.Timeout = TimeSpan.FromSeconds(100);
                var base64Token = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{azureToken}"));
                httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", base64Token);
                httpClient.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));

                var releaseUrl = azureUrl.TrimEnd('/');
                var releaseBody = new Dictionary<string, object>
                {
                    { "definitionId", definitionId },
                    { "variables", new Dictionary<string, object> { { "LISTABASES", new { value = listabases } } } }
                };
                var json = System.Text.Json.JsonSerializer.Serialize(releaseBody);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await httpClient.PostAsync(releaseUrl, content);
                var responseString = await response.Content.ReadAsStringAsync();

                var isJson = responseString.TrimStart().StartsWith("{") || responseString.TrimStart().StartsWith("[");

                if (response.IsSuccessStatusCode && isJson)
                {
                    var releaseObj = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(responseString);
                    var releaseId = releaseObj.TryGetProperty("id", out var idProp) ? idProp.ToString() : "OK";
                    db.UpdateAzureStatus(request.HistoryIds, releaseId);

                    if (!string.IsNullOrEmpty(releaseId) && releaseId != "OK")
                    {
                        _ = PollAzureStatusAsync(db, hubContext, userId, azureUrl, azureToken,
                            request.HistoryIds, releaseId, CancellationToken.None);
                    }

                    return Results.Ok(new { success = true, message = "Pipeline Azure DevOps disparado com sucesso!", releaseId });
                }

                var isHtmlLogin = (int)response.StatusCode == 203
                    || ((response.Content.Headers.ContentType?.MediaType ?? "").Contains("html", StringComparison.OrdinalIgnoreCase)
                        && responseString.Contains("Sign In", StringComparison.OrdinalIgnoreCase));

                if (isHtmlLogin)
                    return Results.Ok(new { success = false, message = "[ERRO] Falha de autenticação no Azure DevOps: resposta é a página de login. Token inválido ou expirado. A pipeline NÃO foi disparada." });

                if ((int)response.StatusCode == 401 || (int)response.StatusCode == 203)
                    return Results.Ok(new { success = false, message = $"[ERRO] Não autorizado (HTTP {(int)response.StatusCode}): token do Azure DevOps inválido. A pipeline NÃO foi disparada." });

                var preview = responseString.Length > 300 ? responseString.Substring(0, 300) : responseString;
                return Results.Ok(new { success = false, message = $"Falha ao disparar pipeline: HTTP {(int)response.StatusCode} - {preview}" });
            }
            catch (Exception azureEx)
            {
                return Results.Ok(new { success = false, message = $"Erro Azure DevOps: {azureEx.Message}" });
            }
        });

        group.MapGet("/search-backups", async (
            HttpContext httpContext,
            string databaseName,
            bool includeLogDb,
            AppDbContext db) =>
        {
            try
            {
                var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
                var sources = db.GetBackupSources(userId).Select(s => s.SharePath).ToList();

                var netUser = db.GetUserSetting(userId, "NetworkUsername");
                var netPass = PasswordEncryption.Decrypt(db.GetUserSetting(userId, "NetworkPassword") ?? string.Empty);

                if (!string.IsNullOrEmpty(netUser) && !string.IsNullOrEmpty(netPass))
                {
                    foreach (var source in sources.Where(s => s.StartsWith("\\\\")))
                    {
                        try { ConnectToUncPath(source, netUser, netPass); } catch { }
                    }
                }

                var backups = new List<object>();
                var logBackups = new List<object>();

                static void CollectFiles(List<string> sources, string dbName, List<object> target, bool excludeLogBackups = false)
                {
                    foreach (var source in sources)
                    {
                        try
                        {
                            if (!Directory.Exists(source)) continue;
                            var files = SearchBackupsRecursively(source, dbName);
                            foreach (var file in files)
                            {
                                var fi = new FileInfo(file);
                                // LOG backups belong to the <db>_LOG database and its _LOG_FULL
                                // chain. They must NOT be listed as FULL/DIFF candidates of the
                                // main database (their LSNs never match a regular FULL base).
                                if (excludeLogBackups && fi.Name.Contains("_LOG_", StringComparison.OrdinalIgnoreCase))
                                    continue;
                                var isDifferential = fi.Name.Contains("_DIFF_", StringComparison.OrdinalIgnoreCase);
                                target.Add(new
                                {
                                    name = fi.Name,
                                    filePath = file,
                                    sizeKB = fi.Length / 1024,
                                    lastBackupDate = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"),
                                    backupType = isDifferential ? "DIFF" : "FULL"
                                });
                            }
                        }
                        catch { }
                    }
                }

                CollectFiles(sources, databaseName, backups, excludeLogBackups: true);

                if (includeLogDb)
                {
                    var logDbName = $"{databaseName}_LOG";
                    CollectFiles(sources, logDbName, logBackups);
                }

                return Results.Ok(new
                {
                    backups = backups.OrderByDescending(b => ((dynamic)b).lastBackupDate).ToList(),
                    logBackups = logBackups.OrderByDescending(b => ((dynamic)b).lastBackupDate).ToList()
                });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao buscar backups: {ex.Message}" });
            }
        });
    }

    private static async Task<(bool Success, string Output, string Error, int ExitCode)> RunSqlCmdAsync(
        string sqlCmdPath, string arguments, CancellationToken ct, Action<string>? onOutput = null)
    {
        var psi = new ProcessStartInfo
        {
            FileName = sqlCmdPath,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi);
        if (process == null) return (false, "", "Não foi possível iniciar sqlcmd.exe", -1);

        try
        {
            var outputTask = ReadStreamAsync(process.StandardOutput, ct, onOutput);
            var errorTask = ReadStreamAsync(process.StandardError, ct);

            var output = await outputTask;
            var error = await errorTask;
            await process.WaitForExitAsync(ct);

            return (process.ExitCode == 0, output, error, process.ExitCode);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(); } catch { }
            throw;
        }
    }

    private static async Task<string> ReadStreamAsync(System.IO.StreamReader stream, CancellationToken ct, Action<string>? callback = null)
    {
        var result = "";
        while (!stream.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await stream.ReadLineAsync(ct);
            if (!string.IsNullOrEmpty(line))
            {
                result += line + "\n";
                callback?.Invoke(line);
            }
        }
        return result.Trim();
    }

    /// <summary>
    /// Monitors the actual RESTORE progress via sys.dm_exec_requests.percent_complete.
    /// More reliable than parsing sqlcmd's stdout, which is buffered and only flushed
    /// when the whole batch finishes.
    /// </summary>
    private static async Task MonitorRestoreProgressAsync(
        string server, string database, string phase, bool useTrusted, string? sqlUser, string? sqlPass,
        IHubContext<RestoreHub> hubContext, CancellationToken ct)
    {
        try
        {
            var cs = $"Server={server};Encrypt=False;TrustServerCertificate=True;Connection Timeout=5;";
            cs += useTrusted ? "Integrated Security=True;" : $"User Id={sqlUser};Password={sqlPass};";

            using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);
            using var cmd = new SqlCommand(@"
SELECT CAST(d_percent.percent_complete AS INT)
FROM sys.dm_exec_requests d_percent
WHERE d_percent.command LIKE 'RESTORE DATABASE%'
   OR d_percent.command LIKE 'RESTORE LOG%';", conn);
            cmd.CommandTimeout = 10;

            var lastSent = -1;
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var val = await cmd.ExecuteScalarAsync(ct);
                    if (val != null && val != DBNull.Value)
                    {
                        var pct = Convert.ToInt32(val);
                        if (pct >= 0 && pct <= 100 && pct != lastSent)
                        {
                            lastSent = pct;
                            await hubContext.Clients.All.SendAsync("RestoreProgress",
                                new { percent = pct, phase, database }, ct);
                        }
                        if (pct >= 100) break;
                    }
                }
                catch { break; }
                await Task.Delay(TimeSpan.FromSeconds(1), ct);
            }
        }
        catch (Exception) { }
    }

    /// <summary>
    /// Runs a RESTORE via sqlcmd while concurrently monitoring live progress and
    /// streaming output back to the client.
    /// </summary>
    private static async Task<(bool Success, string Output, string Error, int ExitCode)> RunRestoreAsync(
        string sqlCmdPath, string args,
        string server, string displayName, string phase, bool useTrusted, string? sqlUser, string? sqlPass,
        IHubContext<RestoreHub> hubContext, CancellationToken ct)
    {
        using var monitorCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var monitor = MonitorRestoreProgressAsync(server, displayName, phase, useTrusted, sqlUser, sqlPass, hubContext, monitorCts.Token);
        try
        {
            return await RunSqlCmdAsync(sqlCmdPath, args, ct, line =>
            {
                if (TryParseRestoreProgress(line, out _)) return;
                hubContext.Clients.All.SendAsync("StatusUpdate", new { message = line, color = "#00BCD4" }, ct);
            });
        }
        finally
        {
            try { monitorCts.Cancel(); } catch { }
            try { await monitor; } catch { }
        }
    }

    private static string ResolveScriptsFolder(string scriptsBasePath, string databaseName)
    {
        // Pattern-based folder resolution matching desktop version behavior
        if (databaseName.StartsWith("DIOC", StringComparison.OrdinalIgnoreCase))
        {
            var diocFolder = Path.Combine(scriptsBasePath, "^DIOC_");
            if (Directory.Exists(diocFolder)) return diocFolder;
        }
        else if (databaseName.Contains("THEOSDBCENTRAL", StringComparison.OrdinalIgnoreCase))
        {
            var folder = Path.Combine(scriptsBasePath, "THEOSDBCENTRAL");
            if (Directory.Exists(folder)) return folder;
        }
        else if (databaseName.Contains("THEOSDBPAY", StringComparison.OrdinalIgnoreCase))
        {
            var folder = Path.Combine(scriptsBasePath, "THEOSDBPAY$");
            if (Directory.Exists(folder)) return folder;
        }
        else if (databaseName.Contains("THEOSSYSTEM", StringComparison.OrdinalIgnoreCase))
        {
            var folder = Path.Combine(scriptsBasePath, "THEOSSYSTEM");
            if (Directory.Exists(folder)) return folder;
        }

        // Try direct folder name match
        var directFolder = Path.Combine(scriptsBasePath, databaseName);
        if (Directory.Exists(directFolder)) return directFolder;

        return string.Empty;
    }

    private static string FindSqlCmd()
    {
        // Search in order of likelihood - prefer ODBC 18/17 first
        string[] paths = new[]
        {
            @"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\130\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files (x86)\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files\Microsoft SQL Server\160\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files\Microsoft SQL Server\150\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files\Microsoft SQL Server\140\Tools\Binn\sqlcmd.exe",
            @"C:\Program Files\Microsoft SQL Server\130\Tools\Binn\sqlcmd.exe",
        };

        foreach (var path in paths)
        {
            if (File.Exists(path)) return path;
        }

        // Search for any version in Program Files
        try
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var sqlServerDir = Path.Combine(programFiles, "Microsoft SQL Server");
            if (Directory.Exists(sqlServerDir))
            {
                foreach (var versionDir in Directory.GetDirectories(sqlServerDir))
                {
                    var candidate = Path.Combine(versionDir, "Tools", "Binn", "sqlcmd.exe");
                    if (File.Exists(candidate)) return candidate;

                    // Also check Client SDK path
                    var sdkPath = Path.Combine(versionDir, "Client SDK", "ODBC");
                    if (Directory.Exists(sdkPath))
                    {
                        foreach (var odbcDir in Directory.GetDirectories(sdkPath))
                        {
                            candidate = Path.Combine(odbcDir, "Tools", "Binn", "sqlcmd.exe");
                            if (File.Exists(candidate)) return candidate;
                        }
                    }
                }
            }
        }
        catch { }

        // Try PATH - prefer entries that look like SQL Server
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in pathEnv.Split(';'))
        {
            var trimmed = dir.Trim();
            if (string.IsNullOrEmpty(trimmed)) continue;
            var fullPath = Path.Combine(trimmed, "sqlcmd.exe");
            if (File.Exists(fullPath))
            {
                // Verify it's not a fake/custom sqlcmd by checking file version
                try
                {
                    var info = FileVersionInfo.GetVersionInfo(fullPath);
                    if (info.ProductName?.Contains("SQL Server") == true || info.CompanyName?.Contains("Microsoft") == true)
                        return fullPath;
                }
                catch { }
            }
        }

        // Last resort: any sqlcmd.exe in PATH
        foreach (var dir in pathEnv.Split(';'))
        {
            var trimmed = dir.Trim();
            if (string.IsNullOrEmpty(trimmed)) continue;
            var fullPath = Path.Combine(trimmed, "sqlcmd.exe");
            if (File.Exists(fullPath)) return fullPath;
        }

        return "";
    }

    private static List<(string LogicalName, string Type, string PhysicalPath)> ParseFileList(string output)
    {
        var result = new List<(string, string, string)>();
        var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Length < 5) continue;
            if (trimmed.StartsWith("rows affected", StringComparison.OrdinalIgnoreCase)) continue;

            var parts = trimmed.Split(',');
            if (parts.Length < 3) continue;

            var logicalName = parts[0].Trim().Trim('"');
            var physicalPath = parts[1].Trim().Trim('"');
            var type = parts[2].Trim().Trim('"');

            if (string.IsNullOrEmpty(logicalName) || string.IsNullOrEmpty(type)) continue;

            result.Add((logicalName, type.ToUpper(), physicalPath));
        }

        return result;
    }

    private static bool TryParseRestoreProgress(string line, out int percent)
    {
        percent = -1;
        if (string.IsNullOrEmpty(line)) return false;
        // sqlcmd output from RESTORE ... WITH STATS: "NN percent processed" (EN) / "NN por cento processado" (PT-BR)
        var match = System.Text.RegularExpressions.Regex.Match(line, @"(\d{1,3})\s*(?:percent|por\s+cento)\s*(?:processed|processad)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!match.Success) return false;
        if (int.TryParse(match.Groups[1].Value, out var p))
        {
            percent = Math.Clamp(p, 0, 100);
            return true;
        }
        return false;
    }

    private static List<string> SearchBackupsRecursively(string basePath, string databaseName)
    {
        var results = new List<string>();
        try
        {
            var subdirs = Directory.GetDirectories(basePath);
            foreach (var subdir in subdirs)
            {
                var dirName = Path.GetFileName(subdir);
                if (dirName.Equals(databaseName, StringComparison.OrdinalIgnoreCase))
                {
                    results.AddRange(GetBackupFilesFromFolder(subdir));
                    continue;
                }
                try
                {
                    foreach (var subSubdir in Directory.GetDirectories(subdir))
                    {
                        if (Path.GetFileName(subSubdir).Equals(databaseName, StringComparison.OrdinalIgnoreCase))
                            results.AddRange(GetBackupFilesFromFolder(subSubdir));
                    }
                }
                catch { }
            }
            if (results.Count == 0)
            {
                try
                {
                    var allBak = Directory.GetFiles(basePath, "*.bak", SearchOption.AllDirectories);
                    results.AddRange(allBak.Where(f =>
                    {
                        var fn = Path.GetFileName(f);
                        return fn.Contains(databaseName, StringComparison.OrdinalIgnoreCase)
                            && !fn.Contains(databaseName + "_LOG", StringComparison.OrdinalIgnoreCase);
                    }));
                }
                catch { }
            }
        }
        catch { }
        return results;
    }

    private static List<string> GetBackupFilesFromFolder(string databaseFolder)
    {
        var results = new List<string>();
        var fullFolder = Path.Combine(databaseFolder, "FULL");
        if (Directory.Exists(fullFolder))
            results.AddRange(Directory.GetFiles(fullFolder, "*.bak", SearchOption.TopDirectoryOnly));
        var diffFolder = Path.Combine(databaseFolder, "DIFF");
        if (Directory.Exists(diffFolder))
            results.AddRange(Directory.GetFiles(diffFolder, "*.bak", SearchOption.TopDirectoryOnly));
        if (results.Count > 0) return results;
        try
        {
            var allBak = Directory.GetFiles(databaseFolder, "*.bak", SearchOption.AllDirectories).ToList();
            var filtered = allBak.Where(f =>
            {
                var fn = Path.GetFileName(f);
                return fn.Contains("_FULL_", StringComparison.OrdinalIgnoreCase) || fn.Contains("_DIFF_", StringComparison.OrdinalIgnoreCase);
            }).ToList();
            return filtered.Count > 0 ? filtered : allBak;
        }
        catch { }
        return results;
    }

    private static string? FindFullBaseForDiffAsync(AppDbContext db, int userId, string databaseName, string diffFilePath)
    {
        var sources = db.GetBackupSources(userId).Select(s => s.SharePath).ToList();

        DateTime diffTime;
        try { diffTime = new FileInfo(diffFilePath).LastWriteTime; }
        catch { diffTime = DateTime.Now; }

        string? bestFull = null;
        DateTime bestTime = DateTime.MinValue;

        foreach (var source in sources)
        {
            try
            {
                if (!Directory.Exists(source)) continue;
                var fullFiles = Directory.GetFiles(source, "*.bak", SearchOption.AllDirectories).Where(f =>
                {
                    var fn = Path.GetFileName(f);
                    return fn.Contains(databaseName, StringComparison.OrdinalIgnoreCase)
                        && fn.Contains("_FULL_", StringComparison.OrdinalIgnoreCase)
                        && !fn.Contains("_LOG_", StringComparison.OrdinalIgnoreCase)
                        && !fn.Contains("_DIFF_", StringComparison.OrdinalIgnoreCase);
                });

                foreach (var file in fullFiles)
                {
                    var fi = new FileInfo(file);
                    if (fi.LastWriteTime > diffTime) continue;
                    if (fi.LastWriteTime > bestTime)
                    {
                        bestTime = fi.LastWriteTime;
                        bestFull = file;
                    }
                }
            }
            catch { }
        }

        return bestFull;
    }

    private static DateTime GetFileWriteTime(string path)
    {
        try { return new FileInfo(path).LastWriteTime; }
        catch { return DateTime.MinValue; }
    }

    private static async Task<string?> GetHeaderOnlyColumnAsync(
        string sqlCmdPath, string server, bool useTrusted, string sqlUsername, string sqlPassword,
        string backupLocalPath, string column, CancellationToken ct)
    {
        try
        {
            var args = useTrusted
                ? $"-b -S \"{server}\" -Q \"RESTORE HEADERONLY FROM DISK = N'{backupLocalPath.Replace("'", "''")}'\" -E -s \"|\" -h -1 -w 4096 -t 60"
                : $"-b -S \"{server}\" -U {sqlUsername} -P {sqlPassword} -Q \"RESTORE HEADERONLY FROM DISK = N'{backupLocalPath.Replace("'", "''")}'\" -s \"|\" -h -1 -w 4096 -t 60";
            var result = await RunSqlCmdAsync(sqlCmdPath, args, ct);
            if (!result.Success) return null;

            var lines = result.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length < 2) return null;

            var header = lines[0];
            var data = lines[1];
            var headerCols = header.Split('|').Select(c => c.Trim().Trim('"')).ToList();
            var dataCols = data.Split('|').Select(c => c.Trim().Trim('"')).ToList();

            var idx = headerCols.IndexOf(column);
            if (idx < 0 || idx >= dataCols.Count) return null;
            return dataCols[idx];
        }
        catch
        {
            return null;
        }
    }

    private static async Task<string?> RunScalarQueryAsync(
        string sqlCmdPath, string server, bool useTrusted, string? sqlUsername, string? sqlPassword,
        string sql, string database, CancellationToken ct)
    {
        try
        {
            var dbArg = string.IsNullOrEmpty(database) ? "" : $" -d \"{database}\"";
            var args = useTrusted
                ? $"-b -S \"{server}\"{dbArg} -Q \"{sql.Replace("\"", "\\\"")}\" -E -h -1 -W -t 60"
                : $"-b -S \"{server}\"{dbArg} -U {sqlUsername} -P {sqlPassword} -Q \"{sql.Replace("\"", "\\\"")}\" -h -1 -W -t 60";
            var result = await RunSqlCmdAsync(sqlCmdPath, args, ct);
            if (!result.Success) return null;
            var lines = result.Output
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(l => l.Trim())
                .Where(l => l.Length > 0 && !l.StartsWith("("))
                .ToList();
            return lines.Count > 0 ? lines[0] : null;
        }
        catch
        {
            return null;
        }
    }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetAddConnection2(NETRESOURCE netResource, string password, string username, int flags);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class NETRESOURCE
    {
        public int dwType;
        public string lpLocalName = "";
        public string lpRemoteName = "";
        public string lpProvider = "";
    }

    private static void ConnectToUncPath(string uncPath, string username, string password)
    {
        WNetAddConnection2(new NETRESOURCE { dwType = 1, lpRemoteName = uncPath }, password, username, 0);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetDiskFreeSpaceEx(string lpDirectoryName, out long lpFreeBytesAvailableToCaller, out long lpTotalNumberOfBytes, out long lpTotalNumberOfFreeBytes);

    private static long GetFreeDiskSpace(string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path)) return -1;
            path = path.TrimEnd('\\');

            // UNC path: \\server\share\... -> \\server\share (2 path segments after the initial \\)
            if (path.StartsWith("\\\\"))
            {
                var parts = path.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3)
                {
                    var share = $"\\\\{parts[0]}\\{parts[1]}";
                    if (GetDiskFreeSpaceEx(share, out var free, out _, out _)) return free;
                }
                if (GetDiskFreeSpaceEx(path, out var free2, out _, out _)) return free2;
            }
            // Local drive path: D:\... -> root of the drive
            else if (path.Length >= 2 && path[1] == ':')
            {
                var root = $"{path[0]}:\\";
                if (GetDiskFreeSpaceEx(root, out var free, out _, out _)) return free;
            }
        }
        catch { }
        return -1;
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double fileSize = bytes;
        int unitIndex = 0;
        while (fileSize >= 1024 && unitIndex < units.Length - 1)
        {
            fileSize /= 1024;
            unitIndex++;
        }
        return $"{fileSize:F1} {units[unitIndex]}";
    }

    private static string GetUncRoot(string uncPath)
    {
        // \\server\share\folder -> \\server\share
        var parts = uncPath.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 3)
            return $"\\\\{parts[0]}\\{parts[1]}";
        return uncPath;
    }

    private static string ToUNCPath(string serverName, string localPath)
    {
        // E:\Backups -> \\server\E$\Backups
        localPath = localPath.TrimEnd('\\');
        if (localPath.Length >= 2 && localPath[1] == ':')
        {
            var drive = localPath[0];
            var rest = localPath.Substring(2);
            return $@"\\{serverName}\{drive}${rest}";
        }
        return localPath;
    }

    private static string NetworkPathToLocal(string uncPath)
    {
        // \\server\D$\Backups\file.bak -> D:\Backups\file.bak
        if (uncPath.StartsWith("\\\\"))
        {
            var parts = uncPath.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 3 && parts[1].Length == 2 && parts[1][1] == '$')
            {
                var drive = parts[1][0];
                var rest = string.Join("\\", parts.Skip(2));
                return $"{drive}:\\{rest}";
            }
        }
        return uncPath;
    }

    private static async Task CopyFileWithProgress(
        string sourcePath,
        string destPath,
        Func<int, double, double, CancellationToken, Task>? sendProgress,
        CancellationToken ct,
        int bufferSize = 1024 * 1024)
    {
        var fileInfo = new FileInfo(sourcePath);
        var totalBytes = fileInfo.Length;
        long bytesCopied = 0;
        var lastReportPercent = -1;

        using var sourceStream = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize, useAsync: true);
        using var destStream = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize, useAsync: true);

        var buffer = new byte[bufferSize];
        int bytesRead;

        while ((bytesRead = await sourceStream.ReadAsync(buffer, ct)) > 0)
        {
            await destStream.WriteAsync(buffer.AsMemory(0, bytesRead), ct);
            bytesCopied += bytesRead;

            var percent = (int)(bytesCopied * 100 / totalBytes);
            if (percent / 10 != lastReportPercent / 10)
            {
                lastReportPercent = percent;
                var copiedMb = bytesCopied / 1024.0 / 1024.0;
                var totalMb = totalBytes / 1024.0 / 1024.0;
                var pct = percent / 10 * 10;
                if (sendProgress != null)
                    await sendProgress(pct, copiedMb, totalMb, ct);
            }
        }
    }

internal static string MapAzureStatus(string? rawStatus) => rawStatus?.ToLowerInvariant() switch
    {
        "queued" => "Na fila",
        "inprogress" => "Em andamento",
        "succeeded" => "Sucesso",
        "partiallysucceeded" => "Parcial",
        "rejected" => "Rejeitado",
        "canceled" => "Cancelado",
        _ => string.IsNullOrEmpty(rawStatus) ? "Disparado" : rawStatus
    };

internal static bool IsAzureTerminal(string rawStatus) => rawStatus.ToLowerInvariant() switch
    {
        "succeeded" or "partiallysucceeded" or "rejected" or "canceled" => true,
        _ => false
    };

    private static string AzureStatusColor(string rawStatus) => rawStatus.ToLowerInvariant() switch
    {
        "queued" => "#FFC107",
        "inprogress" => "#00BCD4",
        "succeeded" => "#4CAF50",
        "partiallysucceeded" => "#FF9800",
        "rejected" => "#F44336",
        "canceled" => "#9E9E9E",
        _ => "#888888"
    };

    private static async Task PollAzureStatusAsync(
        AppDbContext db,
        IHubContext<RestoreHub> hubContext,
        int userId,
        string azureUrl,
        string azureToken,
        List<int> historyIds,
        string releaseId,
        CancellationToken ct)
    {
        var statusUrl = await GetAzureStatusUrlAsync(azureUrl, azureToken, releaseId, ct);
        if (statusUrl == null) return;

        var terminalReached = false;
        for (int attempts = 0; attempts < 120 && !terminalReached && !ct.IsCancellationRequested; attempts++)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
                var rawStatus = await GetAzureStatusValueAsync(statusUrl, azureToken, ct);
                if (rawStatus == null) continue;

                var label = MapAzureStatus(rawStatus);
                var color = AzureStatusColor(rawStatus);

                foreach (var historyId in historyIds)
                    db.UpdateAzureReleaseStatus(historyId, label);

                await hubContext.Clients.All.SendAsync("AzureStatusUpdate",
                    new { historyIds, releaseId, status = label, rawStatus, color }, ct);

                terminalReached = IsAzureTerminal(rawStatus);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                // keep polling on transient errors
            }
        }
    }

    internal static async Task<string?> GetAzureStatusUrlAsync(string azureUrl, string azureToken, string releaseId, CancellationToken ct)
    {
        try
        {
            var baseApiUrl = azureUrl.Split('?')[0].TrimEnd('/');
            var queryString = azureUrl.Contains('?') ? azureUrl.Split('?', 2)[1] : "api-version=7.1";
            return $"{baseApiUrl}/{releaseId}?{queryString}";
        }
        catch { return null; }
    }

    internal static async Task<string?> GetAzureStatusValueAsync(string statusUrl, string azureToken, CancellationToken ct)
    {
        try
        {
            using var httpClient = new HttpClient();
            httpClient.Timeout = TimeSpan.FromSeconds(30);
            var base64Token = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{azureToken}"));
            httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", base64Token);

            var response = await httpClient.GetAsync(statusUrl, ct);
            if (!response.IsSuccessStatusCode) return null;

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("environments", out var envs) || envs.GetArrayLength() == 0)
                return null;

            var firstEnv = envs[0];
            return firstEnv.TryGetProperty("status", out var st) ? st.GetString() ?? "unknown" : "unknown";
        }
        catch { return null; }
    }
}

public class RestoreRequestDto
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string? BackupFilePath { get; set; }
    public List<string>? BackupFilePaths { get; set; }
    public string? RestorePath { get; set; }
    public string? SqlUsername { get; set; }
    public string? SqlPassword { get; set; }
    public string? NetworkUsername { get; set; }
    public string? NetworkPassword { get; set; }
    public bool VerifyIntegrity { get; set; } = true;
    public bool CleanupAfterRestore { get; set; } = true;
    public bool TriggerAzure { get; set; }
    public bool SendNotification { get; set; }
    public bool ReuseBackup { get; set; }
    public bool IncludeLogDb { get; set; }
    public string? LogBackupFilePath { get; set; }
    public string? RestorePathLog { get; set; }
}

public class BatchAzureTriggerRequest
{
    public string InstanceName { get; set; } = string.Empty;
    public List<string> DatabaseNames { get; set; } = new();
    public List<int> HistoryIds { get; set; } = new();
}
