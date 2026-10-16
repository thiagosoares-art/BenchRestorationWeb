using System.Security.Claims;
using BenchRestoration.Api.Data;
using BenchRestoration.Api.Security;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class DeleteEndpoints
{
    public static void MapDeleteEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/delete")
            .WithTags("Delete");

        group.MapPost("/list-databases", async (ListDatabasesRequest request) =>
        {
            try
            {
                var connStr = ConnectionStringBuilder.Build(request.ServerName, request.InstanceName, request.Username, request.Password);
                using var conn = new Microsoft.Data.SqlClient.SqlConnection(connStr);
                await conn.OpenAsync();

                using var cmd = new Microsoft.Data.SqlClient.SqlCommand(@"
                    SELECT db.name,
                           CAST(COALESCE(df.size, 0) AS BIGINT) * 8 AS SizeKB,
                           (SELECT MAX(bs.backup_finish_date)
                            FROM msdb.dbo.backupset bs
                            WHERE bs.database_name = db.name
                              AND bs.type = 'D') AS LastBackupDate
                    FROM sys.databases db
                    INNER JOIN sys.master_files df ON db.database_id = df.database_id AND df.file_id = 1
                    WHERE db.name NOT IN ('master', 'tempdb', 'model', 'msdb')
                    ORDER BY db.name", conn);

                using var reader = await cmd.ExecuteReaderAsync();
                var databases = new List<object>();
                while (await reader.ReadAsync())
                {
                    databases.Add(new
                    {
                        name = reader.GetString(0),
                        sizeKB = reader.GetInt64(1),
                        lastBackupDate = reader.IsDBNull(2) ? null : reader.GetDateTime(2).ToString("yyyy-MM-dd HH:mm:ss")
                    });
                }

                return Results.Ok(databases);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao listar bancos: {ex.Message}" });
            }
        });

        group.MapPost("/drop-databases", async (HttpContext httpContext, DropDatabasesRequest request, AppDbContext db) =>
            {
                var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
                var successCount = 0;
                var failCount = 0;
                var messages = new List<string>();

                void RecordHistory(string databaseName, string status, string? message)
                {
                    db.AddDeleteHistory(new DeleteHistoryModel
                    {
                        ServerName = request.ServerName,
                        InstanceName = request.InstanceName,
                        DatabaseName = databaseName,
                        Status = status,
                        Message = message,
                        DeletedAt = DateTime.Now,
                        UserId = userId
                    });
                }

                try
                {
                    var blockedNames = new List<string>();

                    // Check security rules (per-server/per-instance)
                    var ruleBlocked = request.DatabaseNames.Where(dbName =>
                        db.HasSecurityRule(request.ServerName, request.InstanceName, dbName, "Exclusão")
                    ).ToList();
                    var ruleBlockedDetails = ruleBlocked.Select(dbName => {
                        var ruleType = db.GetSecurityRuleType(request.ServerName, request.InstanceName, dbName, "Exclusão");
                        return new { dbName, ruleType };
                    }).ToList();
                    blockedNames.AddRange(ruleBlockedDetails.Select(r => r.dbName));
                    request.DatabaseNames = request.DatabaseNames.Except(ruleBlockedDetails.Select(r => r.dbName)).ToList();

                    if (blockedNames.Count > 0)
                    {
                        foreach (var dbName in blockedNames)
                        {
                            var detail = ruleBlockedDetails.FirstOrDefault(r => r.dbName == dbName);
                            var ruleType = detail?.ruleType ?? "Exclusão";
                            messages.Add($"O banco '{dbName}' possui regra de proteção ({ruleType}) e não será excluído.");
                            RecordHistory(dbName, "Bloqueado", $"Possui regra de proteção ({ruleType})");
                        }
                    }

                if (request.DatabaseNames.Count == 0)
                    return Results.Ok(new { successCount = 0, failCount = 0, messages });
                var connStr = ConnectionStringBuilder.Build(request.ServerName, request.InstanceName, request.Username, request.Password) + ";Initial Catalog=master";
                using var conn = new Microsoft.Data.SqlClient.SqlConnection(connStr);
                await conn.OpenAsync();

                foreach (var dbName in request.DatabaseNames)
                {
                    try
                    {
                        // Kill active sessions for this database
                        using var killCmd = new Microsoft.Data.SqlClient.SqlCommand();
                        killCmd.Connection = conn;
                        killCmd.CommandText = @"
                            DECLARE @sql NVARCHAR(MAX) = N'';
                            SELECT @sql += N'KILL ' + CAST(session_id AS NVARCHAR) + N';'
                            FROM sys.dm_exec_sessions WHERE database_id = DB_ID(@dbName);
                            IF @sql <> N'' EXEC sp_executesql @sql;";
                        killCmd.Parameters.AddWithValue("@dbName", dbName);
                        await killCmd.ExecuteNonQueryAsync();

                        // Drop the database using QUOTENAME in SQL
                        using var dropCmd = new Microsoft.Data.SqlClient.SqlCommand();
                        dropCmd.Connection = conn;
                        dropCmd.CommandText = @"
                            DECLARE @dropSql NVARCHAR(MAX) = N'DROP DATABASE ' + QUOTENAME(@dbName);
                            EXEC sp_executesql @dropSql;";
                        dropCmd.Parameters.AddWithValue("@dbName", dbName);
                        dropCmd.CommandTimeout = 120;
                        await dropCmd.ExecuteNonQueryAsync();

                        messages.Add($"[OK] Banco '{dbName}' excluído com sucesso.");
                        RecordHistory(dbName, "Excluido", "Banco excluído com sucesso.");
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        messages.Add($"[ERRO] Falha ao excluir '{dbName}': {ex.Message}");
                        RecordHistory(dbName, "Erro", $"Falha ao excluir: {ex.Message}");
                        failCount++;
                    }
                }
            }
            catch (Exception ex)
            {
                messages.Add($"[ERRO] Falha na conexão: {ex.Message}");
                foreach (var dbName in request.DatabaseNames)
                    RecordHistory(dbName, "Erro", $"Falha na conexão: {ex.Message}");
                failCount = request.DatabaseNames.Count;
            }

            return Results.Ok(new { successCount, failCount, messages });
        });
    }
}

public class ListDatabasesRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? Password { get; set; }
}

public class DropDatabasesRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public List<string> DatabaseNames { get; set; } = new();
}
