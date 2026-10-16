using Microsoft.Data.SqlClient;

namespace BenchRestoration.Agent.Services;

public class SqlAgentService
{
    private string BuildConnectionString(string serverName, string instanceName, string username, string password)
    {
        var server = instanceName == "MSSQLSERVER" || string.IsNullOrEmpty(instanceName)
            ? serverName
            : $"{serverName}\\{instanceName}";

        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            return $"Server={server};Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connection Timeout=5;";
        }

        return $"Server={server};User Id={username};Password={password};Encrypt=False;TrustServerCertificate=True;Connection Timeout=5;";
    }

    public async Task<(bool Success, string Message)> TestConnectionAsync(
        string serverName, string instanceName, string username, string password)
    {
        try
        {
            var connStr = BuildConnectionString(serverName, instanceName, username, password);
            using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();

            using var cmd = new SqlCommand("SELECT @@SERVERNAME + ' - ' + @@VERSION", conn);
            var serverInfo = await cmd.ExecuteScalarAsync();
            return (true, $"Conexão estabelecida com sucesso!\n{serverInfo}");
        }
        catch (SqlException ex)
        {
            var message = ex.Number switch
            {
                2 => "Servidor não encontrado ou não acessível.",
                18 => "Timeout expirado. Verifique se o SQL Server permite conexões remotas.",
                18456 => "Falha no login. Verifique o usuário e senha.",
                _ => $"Erro SQL: {ex.Message}"
            };
            return (false, message);
        }
    }

    public async Task<List<(string Name, string DisplayName)>> ListInstancesAsync(
        string serverName, string username, string password)
    {
        var instances = new List<(string, string)>();

        try
        {
            var useTrusted = string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password);
            var connStr = useTrusted
                ? $"Server={serverName};Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connection Timeout=5;"
                : $"Server={serverName};User Id={username};Password={password};Encrypt=False;TrustServerCertificate=True;Connection Timeout=5;";

            using var conn = new SqlConnection(connStr);
            using var cmd = new SqlCommand("SELECT SERVERPROPERTY('InstanceName')", conn);
            await conn.OpenAsync();
            var result = await cmd.ExecuteScalarAsync();
            var instanceName = result?.ToString() ?? "MSSQLSERVER";

            var displayName = instanceName == "MSSQLSERVER" ? serverName : $"{serverName}\\{instanceName}";
            instances.Add((instanceName, displayName));
        }
        catch { }

        return instances;
    }

    public async Task<List<(string Name, long SizeKB, DateTime? LastBackupDate)>> ListDatabasesAsync(
        string serverName, string instanceName, string username, string password)
    {
        var databases = new List<(string, long, DateTime?)>();
        var connStr = BuildConnectionString(serverName, instanceName, username, password);

        using var conn = new SqlConnection(connStr);
        using var cmd = new SqlCommand(@"
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
        await conn.OpenAsync();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            databases.Add((
                reader.GetString(0),
                reader.GetInt64(1),
                reader.IsDBNull(2) ? null : reader.GetDateTime(2)
            ));
        }
        return databases;
    }

    public async Task<(bool Success, string Message)> DropDatabaseAsync(
        string serverName, string instanceName, string username, string password, string databaseName)
    {
        try
        {
            var connStr = BuildConnectionString(serverName, instanceName, username, password) + ";Initial Catalog=master";
            using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();

            var killCmd = new SqlCommand(@"
                DECLARE @sql NVARCHAR(MAX) = N'', @dbName NVARCHAR(128) = @name;
                SELECT @sql += N'KILL ' + CAST(session_id AS NVARCHAR) + N';'
                FROM sys.dm_exec_sessions WHERE database_id = DB_ID(@dbName);
                EXEC sp_executesql @sql;", conn);
            killCmd.Parameters.AddWithValue("@name", databaseName);
            await killCmd.ExecuteNonQueryAsync();

            var dropCmd = new SqlCommand("EXEC sp_executesql N'DROP DATABASE ' + QUOTENAME(@name)", conn);
            dropCmd.Parameters.AddWithValue("@name", databaseName);
            dropCmd.CommandTimeout = 60;
            await dropCmd.ExecuteNonQueryAsync();

            return (true, $"Banco '{databaseName}' excluído com sucesso.");
        }
        catch (Exception ex)
        {
            return (false, $"Erro ao excluir '{databaseName}': {ex.Message}");
        }
    }

    public async Task<(bool Success, string Message)> RestoreDatabaseAsync(
        string serverName, string instanceName, string username, string password,
        string databaseName, string backupFilePath, string restorePath, bool withRecovery)
    {
        try
        {
            var connStr = BuildConnectionString(serverName, instanceName, username, password) + ";Initial Catalog=master";
            using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();

            var recoveryMode = withRecovery ? "RECOVERY" : "NORECOVERY";
            var restoreSql = $@"
                RESTORE DATABASE [{databaseName.Replace("]", "]]")}]
                FROM DISK = N'{backupFilePath.Replace("'", "''")}'
                WITH REPLACE, {recoveryMode},
                MOVE N'{databaseName}' TO N'{restorePath}\\{databaseName}.mdf',
                MOVE N'{databaseName}_log' TO N'{restorePath}\\{databaseName}_log.ldf'";

            using var cmd = new SqlCommand(restoreSql, conn);
            cmd.CommandTimeout = 1800; // 30 minutes
            await cmd.ExecuteNonQueryAsync();

            return (true, $"Banco '{databaseName}' restaurado com sucesso.");
        }
        catch (Exception ex)
        {
            return (false, $"Erro ao restaurar '{databaseName}': {ex.Message}");
        }
    }

    public async Task<(bool Success, string Message)> VerifyIntegrityAsync(
        string serverName, string instanceName, string username, string password, string backupFilePath)
    {
        try
        {
            var connStr = BuildConnectionString(serverName, instanceName, username, password) + ";Initial Catalog=master";
            using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();

            var verifySql = $@"
                RESTORE VERIFYONLY
                FROM DISK = N'{backupFilePath.Replace("'", "''")}'";

            using var cmd = new SqlCommand(verifySql, conn);
            cmd.CommandTimeout = 600; // 10 minutes
            await cmd.ExecuteNonQueryAsync();

            return (true, "Verificação de integridade concluída com sucesso.");
        }
        catch (Exception ex)
        {
            return (false, $"Erro na verificação: {ex.Message}");
        }
    }
}
