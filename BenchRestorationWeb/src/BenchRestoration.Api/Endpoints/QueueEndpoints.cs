using Microsoft.Data.SqlClient;
using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class QueueEndpoints
{
    public static void MapQueueEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/queue")
            .WithTags("Queue");

        group.MapPost("/items", async (QueueRequest request, AppDbContext db) =>
        {
            var connectionString = GetConnectionString(request.ServerName, request.InstanceName, request.SqlUsername, request.SqlPassword);
            await EnsureQueueTableExistsAsync(connectionString);
            var items = await GetQueueItemsAsync(connectionString);
            return Results.Ok(items);
        });

        group.MapPost("/add", async (QueueAddRequest request, AppDbContext db) =>
        {
            // Check security rules for restoration
            var hasRestoreRule = db.HasSecurityRule(request.ServerName, request.InstanceName, request.DatabaseName, "Restauração");
            if (hasRestoreRule)
            {
                return Results.BadRequest(new { message = $"O banco '{request.DatabaseName}' não pode ser adicionado à fila porque existe uma regra de segurança cadastrada para Restauração." });
            }

            var connectionString = GetConnectionString(request.ServerName, request.InstanceName, request.SqlUsername, request.SqlPassword);
            await EnsureQueueTableExistsAsync(connectionString);

            var item = new RestoreQueueItemModel
            {
                DatabaseName = request.DatabaseName,
                ServerName = request.ServerName,
                InstanceName = request.InstanceName,
                BackupFilePath = request.BackupFilePath,
                RestorePath = request.RestorePath,
                RequestedBy = Environment.MachineName,
                CreatedAt = DateTime.Now,
                ReuseBackup = request.ReuseBackup
            };

            var id = await AddToQueueAsync(connectionString, item);
            return Results.Ok(new { id, message = "Item adicionado à fila com sucesso" });
        });

        group.MapPost("/remove", async (QueueRemoveRequest request) =>
        {
            var connectionString = GetConnectionString(request.ServerName, request.InstanceName, request.SqlUsername, request.SqlPassword);
            await RemoveFromQueueAsync(connectionString, request.JobId);
            return Results.Ok(new { message = "Item removido da fila com sucesso" });
        });

        group.MapPost("/reset-stuck", async (QueueRequest request) =>
        {
            var connectionString = GetConnectionString(request.ServerName, request.InstanceName, request.SqlUsername, request.SqlPassword);
            var count = await ResetStuckJobsAsync(connectionString);
            return Results.Ok(new { count, message = $"{count} jobs travados reiniciados" });
        });
    }

    private static string GetConnectionString(string serverName, string instanceName, string? username, string? password)
    {
        var server = instanceName == "MSSQLSERVER" || string.IsNullOrEmpty(instanceName)
            ? serverName
            : $"{serverName}\\{instanceName}";

        var useTrusted = string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password);

        return useTrusted
            ? $"Server={server};Integrated Security=True;TrustServerCertificate=True;Connection Timeout=30;"
            : $"Server={server};User Id={username};Password={password};TrustServerCertificate=True;Connection Timeout=30;";
    }

    private static async Task EnsureQueueTableExistsAsync(string connectionString)
    {
        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        var createTableSql = @"
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RestoreQueue')
            BEGIN
                CREATE TABLE RestoreQueue (
                    Id              INT IDENTITY(1,1) PRIMARY KEY,
                    DatabaseName    NVARCHAR(256) NOT NULL,
                    ServerName      NVARCHAR(256) NOT NULL,
                    InstanceName    NVARCHAR(256) NOT NULL,
                    BackupFilePath  NVARCHAR(1024) NOT NULL,
                    RestorePath     NVARCHAR(1024) NOT NULL,
                    Status          NVARCHAR(20) NOT NULL DEFAULT 'Pending',
                    RequestedBy     NVARCHAR(256) NOT NULL,
                    CreatedAt       DATETIME2 NOT NULL DEFAULT GETDATE(),
                    StartedAt       DATETIME2 NULL,
                    FinishedAt      DATETIME2 NULL,
                    ErrorMessage    NVARCHAR(MAX) NULL,
                    SortOrder       INT NOT NULL
                );
            END";

        using var cmd = new SqlCommand(createTableSql, connection);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<int> AddToQueueAsync(string connectionString, RestoreQueueItemModel item)
    {
        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        var getMaxOrderSql = "SELECT ISNULL(MAX(SortOrder), 0) + 1 FROM RestoreQueue WHERE Status IN ('Pending', 'Running')";
        using var orderCmd = new SqlCommand(getMaxOrderSql, connection);
        var sortOrder = Convert.ToInt32(await orderCmd.ExecuteScalarAsync());

        var insertSql = @"
            INSERT INTO RestoreQueue (DatabaseName, ServerName, InstanceName, BackupFilePath, RestorePath, Status, RequestedBy, SortOrder)
            VALUES (@dbName, @server, @instance, @backup, @restorePath, 'Pending', @requestedBy, @sortOrder);
            SELECT SCOPE_IDENTITY();";

        using var cmd = new SqlCommand(insertSql, connection);
        cmd.Parameters.AddWithValue("@dbName", item.DatabaseName);
        cmd.Parameters.AddWithValue("@server", item.ServerName);
        cmd.Parameters.AddWithValue("@instance", item.InstanceName);
        cmd.Parameters.AddWithValue("@backup", item.BackupFilePath);
        cmd.Parameters.AddWithValue("@restorePath", item.RestorePath);
        cmd.Parameters.AddWithValue("@requestedBy", item.RequestedBy);
        cmd.Parameters.AddWithValue("@sortOrder", sortOrder);

        var id = Convert.ToInt32(await cmd.ExecuteScalarAsync());
        return id;
    }

    private static async Task<List<RestoreQueueItemModel>> GetQueueItemsAsync(string connectionString)
    {
        var items = new List<RestoreQueueItemModel>();

        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        var sql = @"SELECT Id, DatabaseName, ServerName, InstanceName, BackupFilePath, RestorePath,
                    Status, RequestedBy, CreatedAt, StartedAt, FinishedAt, ErrorMessage, SortOrder
                    FROM RestoreQueue
                    ORDER BY
                        CASE Status
                            WHEN 'Running' THEN 0
                            WHEN 'Pending' THEN 1
                            WHEN 'Completed' THEN 2
                            WHEN 'Failed' THEN 3
                        END,
                    SortOrder";

        using var cmd = new SqlCommand(sql, connection);
        using var reader = await cmd.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            items.Add(new RestoreQueueItemModel
            {
                Id = reader.GetInt32(0),
                DatabaseName = reader.GetString(1),
                ServerName = reader.GetString(2),
                InstanceName = reader.GetString(3),
                BackupFilePath = reader.GetString(4),
                RestorePath = reader.GetString(5),
                Status = Enum.Parse<QueueItemStatus>(reader.GetString(6)),
                RequestedBy = reader.GetString(7),
                CreatedAt = reader.GetDateTime(8),
                StartedAt = reader.IsDBNull(9) ? null : reader.GetDateTime(9),
                FinishedAt = reader.IsDBNull(10) ? null : reader.GetDateTime(10),
                ErrorMessage = reader.IsDBNull(11) ? null : reader.GetString(11),
                SortOrder = reader.GetInt32(12)
            });
        }

        return items;
    }

    private static async Task RemoveFromQueueAsync(string connectionString, int jobId)
    {
        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        var sql = "DELETE FROM RestoreQueue WHERE Id = @id AND Status = 'Pending'";
        using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@id", jobId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<int> ResetStuckJobsAsync(string connectionString, int timeoutMinutes = 30)
    {
        using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();

        var sql = @"UPDATE RestoreQueue
                    SET Status = 'Pending', StartedAt = NULL, ErrorMessage = 'Reiniciado automaticamente - processo anterior travado'
                    WHERE Status = 'Running'
                    AND StartedAt < DATEADD(MINUTE, -@timeout, GETDATE())";

        using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@timeout", timeoutMinutes);
        return await cmd.ExecuteNonQueryAsync();
    }
}

public class QueueRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string? SqlUsername { get; set; }
    public string? SqlPassword { get; set; }
}

public class QueueAddRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string BackupFilePath { get; set; } = string.Empty;
    public string RestorePath { get; set; } = string.Empty;
    public string? SqlUsername { get; set; }
    public string? SqlPassword { get; set; }
    public bool ReuseBackup { get; set; }
}

public class QueueRemoveRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string? SqlUsername { get; set; }
    public string? SqlPassword { get; set; }
    public int JobId { get; set; }
}

public class RestoreQueueItemModel
{
    public int Id { get; set; }
    public string DatabaseName { get; set; } = string.Empty;
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string BackupFilePath { get; set; } = string.Empty;
    public string RestorePath { get; set; } = string.Empty;
    public QueueItemStatus Status { get; set; }
    public string RequestedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? ErrorMessage { get; set; }
    public int SortOrder { get; set; }
    public bool ReuseBackup { get; set; }
}

public enum QueueItemStatus
{
    Pending,
    Running,
    Completed,
    Failed
}