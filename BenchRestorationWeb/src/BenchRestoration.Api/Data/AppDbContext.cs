using Microsoft.Data.Sqlite;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Data;

public class AppDbContext
{
    private readonly string _connectionString;

    public AppDbContext(IConfiguration configuration)
    {
        var dataDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data");
        if (!Directory.Exists(dataDir)) Directory.CreateDirectory(dataDir);
        var dbPath = Path.Combine(dataDir, "BenchRestoration.db");
        _connectionString = $"Data Source={dbPath}";
        RunMigrations();
    }

    private void RunMigrations()
    {
        using var conn = new SqliteConnection(_connectionString);
        conn.Open();

        // Create SchemaVersion table if not exists
        using var init = conn.CreateCommand();
        init.CommandText = "CREATE TABLE IF NOT EXISTS SchemaVersion (Version INTEGER PRIMARY KEY, AppliedAt TEXT NOT NULL)";
        init.ExecuteNonQuery();

        // Get current version
        using var verCmd = conn.CreateCommand();
        verCmd.CommandText = "SELECT COALESCE(MAX(Version), 0) FROM SchemaVersion";
        var currentVersion = Convert.ToInt32(verCmd.ExecuteScalar());

        var migrations = GetMigrations();
        foreach (var (version, sql) in migrations.OrderBy(m => m.version))
        {
            if (version <= currentVersion) continue;
            using var txn = conn.BeginTransaction();
            try
            {
                foreach (var statement in sql.Split("---", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    if (string.IsNullOrWhiteSpace(statement)) continue;
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = statement;
                    cmd.Transaction = txn;
                    cmd.ExecuteNonQuery();
                }
                using var record = conn.CreateCommand();
                record.CommandText = "INSERT INTO SchemaVersion (Version, AppliedAt) VALUES (@v, @t)";
                record.Parameters.AddWithValue("@v", version);
                record.Parameters.AddWithValue("@t", DateTime.UtcNow.ToString("o"));
                record.Transaction = txn;
                record.ExecuteNonQuery();
                txn.Commit();
            }
            catch { txn.Rollback(); throw; }
        }
    }

    private static List<(int version, string sql)> GetMigrations() =>
    [
        (1, """
            CREATE TABLE IF NOT EXISTS Servers (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                Description TEXT,
                BackupPath TEXT,
                RestorePath TEXT,
                UserId INTEGER NOT NULL DEFAULT 0,
                UNIQUE(Name, UserId)
            );
            CREATE TABLE IF NOT EXISTS Instances (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ServerId INTEGER NOT NULL REFERENCES Servers(Id),
                Name TEXT NOT NULL,
                DisplayName TEXT,
                AuthType TEXT DEFAULT 'Windows',
                Username TEXT,
                PasswordEnc TEXT,
                RestorePath TEXT,
                AzureReleaseDefinitionId INTEGER DEFAULT 0,
                UNIQUE(ServerId, Name)
            );
            CREATE TABLE IF NOT EXISTS BackupSources (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                SharePath TEXT NOT NULL,
                Description TEXT,
                IsActive INTEGER DEFAULT 1,
                UserId INTEGER NOT NULL DEFAULT 0,
                UNIQUE(SharePath, UserId)
            );
            CREATE TABLE IF NOT EXISTS RestoreHistory (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ServerName TEXT NOT NULL,
                InstanceName TEXT NOT NULL,
                DatabaseName TEXT NOT NULL,
                BackupFile TEXT,
                RestorePath TEXT,
                Status TEXT NOT NULL,
                StartedAt TEXT,
                FinishedAt TEXT,
                Duration TEXT,
                ErrorMessage TEXT,
                TriggeredAzure INTEGER DEFAULT 0,
                AzureReleaseId TEXT
            );
            CREATE TABLE IF NOT EXISTS AppSettings (
                Key TEXT PRIMARY KEY,
                Value TEXT
            );
            CREATE TABLE IF NOT EXISTS KnownDatabases (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL UNIQUE,
                LastUsedAt TEXT
            );
            CREATE TABLE IF NOT EXISTS SecurityRules (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ServerName TEXT NOT NULL,
                InstanceName TEXT NOT NULL,
                DatabaseName TEXT NOT NULL,
                RuleType TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS PostRestoreScripts (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                DatabaseName TEXT NOT NULL,
                ScriptPath TEXT NOT NULL,
                SortOrder INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS RestoreJobs (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                DatabaseName TEXT NOT NULL,
                ServerName TEXT NOT NULL,
                InstanceName TEXT NOT NULL,
                BackupFilePath TEXT,
                RestorePath TEXT,
                Status TEXT NOT NULL DEFAULT 'Pending',
                CreatedAt TEXT,
                StartedAt TEXT,
                FinishedAt TEXT,
                ErrorMessage TEXT
            );
            CREATE TABLE IF NOT EXISTS Users (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Username TEXT NOT NULL UNIQUE,
                PasswordHash TEXT NOT NULL,
                Role TEXT NOT NULL DEFAULT 'Usuario',
                IsActive INTEGER DEFAULT 1,
                CreatedAt TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS UserPermissions (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL REFERENCES Users(Id),
                Permission TEXT NOT NULL,
                UNIQUE(UserId, Permission)
            );
            CREATE TABLE IF NOT EXISTS UserSettings (
                UserId INTEGER NOT NULL,
                Key TEXT NOT NULL,
                Value TEXT,
                PRIMARY KEY (UserId, Key)
            )
            """),
        (2, """
            ALTER TABLE RestoreHistory ADD COLUMN UserId INTEGER
            """),
        (3, """
            CREATE TABLE IF NOT EXISTS DeleteHistory (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ServerName TEXT NOT NULL,
                InstanceName TEXT NOT NULL,
                DatabaseName TEXT NOT NULL,
                Status TEXT NOT NULL,
                Message TEXT,
                DeletedAt TEXT,
                UserId INTEGER
            )
            """),
        (4, """
            ALTER TABLE RestoreHistory ADD COLUMN PostCheck TEXT
            """),
        (5, """
            ALTER TABLE RestoreHistory ADD COLUMN AzureStatus TEXT
            """)
    ];

    public SqliteConnection CreateConnection()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    public List<ServerModel> GetServers(int userId)
    {
        var servers = new List<ServerModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, Name, Description, BackupPath, RestorePath FROM Servers WHERE UserId = @uid ORDER BY Name";
        cmd.Parameters.AddWithValue("@uid", userId);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            servers.Add(new ServerModel
            {
                Id = reader.GetInt32(0),
                Name = reader.GetString(1),
                Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                BackupPath = reader.IsDBNull(3) ? null : reader.GetString(3),
                RestorePath = reader.IsDBNull(4) ? null : reader.GetString(4)
            });
        }
        return servers;
    }

    public void AddServer(string name, int userId, string? description = null, string? backupPath = null, string? restorePath = null)
    {
        using var conn = CreateConnection();
        using var checkCmd = conn.CreateCommand();
        checkCmd.CommandText = "SELECT COUNT(*) FROM Servers WHERE Name = @name AND UserId = @uid";
        checkCmd.Parameters.AddWithValue("@name", name);
        checkCmd.Parameters.AddWithValue("@uid", userId);
        if (Convert.ToInt32(checkCmd.ExecuteScalar()) > 0) return;

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO Servers (Name, Description, BackupPath, RestorePath, UserId) VALUES (@name, @desc, @backupPath, @restorePath, @uid)";
        cmd.Parameters.AddWithValue("@name", name);
        cmd.Parameters.AddWithValue("@desc", (object?)description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@backupPath", (object?)backupPath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@restorePath", (object?)restorePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.ExecuteNonQuery();
    }

    public void RemoveServer(int id)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM Instances WHERE ServerId = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
        cmd.CommandText = "DELETE FROM Servers WHERE Id = @id";
        cmd.ExecuteNonQuery();
    }

    public void UpdateServer(ServerModel server)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE Servers SET Name = @name, Description = @desc, BackupPath = @backupPath, RestorePath = @restorePath WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", server.Id);
        cmd.Parameters.AddWithValue("@name", server.Name);
        cmd.Parameters.AddWithValue("@desc", (object?)server.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@backupPath", (object?)server.BackupPath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@restorePath", (object?)server.RestorePath ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public List<InstanceModel> GetInstancesByUserId(int userId)
    {
        var instances = new List<InstanceModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT i.Id, i.ServerId, i.Name, i.DisplayName, i.AuthType, i.Username, i.PasswordEnc, i.RestorePath, i.AzureReleaseDefinitionId
                            FROM Instances i INNER JOIN Servers s ON i.ServerId = s.Id
                            WHERE s.UserId = @uid ORDER BY i.Name";
        cmd.Parameters.AddWithValue("@uid", userId);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            instances.Add(new InstanceModel
            {
                Id = reader.GetInt32(0),
                ServerId = reader.GetInt32(1),
                Name = reader.GetString(2),
                DisplayName = reader.IsDBNull(3) ? null : reader.GetString(3),
                AuthType = reader.GetString(4),
                Username = reader.IsDBNull(5) ? null : reader.GetString(5),
                PasswordEnc = reader.IsDBNull(6) ? null : reader.GetString(6),
                RestorePath = reader.IsDBNull(7) ? null : reader.GetString(7),
                AzureReleaseDefinitionId = reader.IsDBNull(8) ? 0 : reader.GetInt32(8)
            });
        }
        return instances;
    }

    public List<InstanceModel> GetInstances(int serverId)
    {
        var instances = new List<InstanceModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, ServerId, Name, DisplayName, AuthType, Username, PasswordEnc, RestorePath, AzureReleaseDefinitionId FROM Instances WHERE ServerId = @serverId ORDER BY Name";
        cmd.Parameters.AddWithValue("@serverId", serverId);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            instances.Add(new InstanceModel
            {
                Id = reader.GetInt32(0),
                ServerId = reader.GetInt32(1),
                Name = reader.GetString(2),
                DisplayName = reader.IsDBNull(3) ? null : reader.GetString(3),
                AuthType = reader.GetString(4),
                Username = reader.IsDBNull(5) ? null : reader.GetString(5),
                PasswordEnc = reader.IsDBNull(6) ? null : reader.GetString(6),
                RestorePath = reader.IsDBNull(7) ? null : reader.GetString(7),
                AzureReleaseDefinitionId = reader.IsDBNull(8) ? 0 : reader.GetInt32(8)
            });
        }
        return instances;
    }

    public void AddInstance(InstanceModel instance)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT OR REPLACE INTO Instances (ServerId, Name, DisplayName, AuthType, Username, PasswordEnc, RestorePath, AzureReleaseDefinitionId) 
                           VALUES (@serverId, @name, @displayName, @authType, @username, @passwordEnc, @restorePath, @azureReleaseDefinitionId)";
        cmd.Parameters.AddWithValue("@serverId", instance.ServerId);
        cmd.Parameters.AddWithValue("@name", instance.Name);
        cmd.Parameters.AddWithValue("@displayName", (object?)instance.DisplayName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@authType", instance.AuthType);
        cmd.Parameters.AddWithValue("@username", (object?)instance.Username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@passwordEnc", (object?)instance.PasswordEnc ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@restorePath", (object?)instance.RestorePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@azureReleaseDefinitionId", instance.AzureReleaseDefinitionId);
        cmd.ExecuteNonQuery();
    }

    public void UpdateInstance(int id, InstanceModel instance)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE Instances SET ServerId = @serverId, Name = @name, DisplayName = @displayName, AuthType = @authType, Username = @username, PasswordEnc = @passwordEnc, RestorePath = @restorePath, AzureReleaseDefinitionId = @azureReleaseDefinitionId WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@serverId", instance.ServerId);
        cmd.Parameters.AddWithValue("@name", instance.Name);
        cmd.Parameters.AddWithValue("@displayName", (object?)instance.DisplayName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@authType", instance.AuthType);
        cmd.Parameters.AddWithValue("@username", (object?)instance.Username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@passwordEnc", (object?)instance.PasswordEnc ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@restorePath", (object?)instance.RestorePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@azureReleaseDefinitionId", instance.AzureReleaseDefinitionId);
        cmd.ExecuteNonQuery();
    }

    public void RemoveInstance(int id)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM Instances WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }

    public List<BackupSourceModel> GetBackupSources(int userId)
    {
        var sources = new List<BackupSourceModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, SharePath, Description, IsActive FROM BackupSources WHERE IsActive = 1 AND UserId = @uid ORDER BY SharePath";
        cmd.Parameters.AddWithValue("@uid", userId);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            sources.Add(new BackupSourceModel
            {
                Id = reader.GetInt32(0),
                SharePath = reader.GetString(1),
                Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                IsActive = reader.GetInt32(3) == 1
            });
        }
        return sources;
    }

    public void AddBackupSource(string sharePath, int userId, string? description = null)
    {
        using var conn = CreateConnection();
        using var checkCmd = conn.CreateCommand();
        checkCmd.CommandText = "SELECT COUNT(*) FROM BackupSources WHERE SharePath = @path AND UserId = @uid";
        checkCmd.Parameters.AddWithValue("@path", sharePath);
        checkCmd.Parameters.AddWithValue("@uid", userId);
        if (Convert.ToInt32(checkCmd.ExecuteScalar()) > 0) return;

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO BackupSources (SharePath, Description, UserId) VALUES (@path, @desc, @uid)";
        cmd.Parameters.AddWithValue("@path", sharePath);
        cmd.Parameters.AddWithValue("@desc", (object?)description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.ExecuteNonQuery();
    }

    public void RemoveBackupSource(int id)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM BackupSources WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }

    public string? GetSetting(string key)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Value FROM AppSettings WHERE Key = @key";
        cmd.Parameters.AddWithValue("@key", key);
        var result = cmd.ExecuteScalar();
        return result?.ToString();
    }

    public void SetSetting(string key, string? value)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO AppSettings (Key, Value) VALUES (@key, @value)";
        cmd.Parameters.AddWithValue("@key", key);
        cmd.Parameters.AddWithValue("@value", (object?)value ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public AppSettingsModel GetSettingsModel()
    {
        return new AppSettingsModel
        {
            BackupDestination = GetSetting("BackupDestination"),
            DefaultRestoreBasePath = GetSetting("DefaultRestoreBasePath"),
            AzureDevOpsToken = GetSetting("AzureDevOpsToken"),
            AzureDevOpsUrl = GetSetting("AzureDevOpsUrl"),
            AzureReleaseDefinitionId = int.TryParse(GetSetting("AzureReleaseDefinitionId"), out var id) ? id : 0,
            NotificationApiUrl = GetSetting("NotificationApiUrl"),
            SqlUsername = GetSetting("SqlUsername"),
            SqlPassword = GetSetting("SqlPassword"),
            NetworkUsername = GetSetting("NetworkUsername"),
            NetworkPassword = GetSetting("NetworkPassword"),
            DefaultIncludeLogDatabase = string.Equals(GetSetting("DefaultIncludeLogDatabase"), "true", StringComparison.OrdinalIgnoreCase),
            ShowDiffDateRestore = string.Equals(GetSetting("ShowDiffDateRestore"), "true", StringComparison.OrdinalIgnoreCase),
            ScriptsRestoreBasePath = GetSetting("ScriptsRestoreBasePath"),
            HideSelectAllInDelete = string.Equals(GetSetting("HideSelectAllInDelete"), "true", StringComparison.OrdinalIgnoreCase),
            DeleteExceptionDatabases = GetSetting("DeleteExceptionDatabases"),
            RestoreExceptionDatabases = GetSetting("RestoreExceptionDatabases")
        };
    }

    public string? GetUserSetting(int userId, string key)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Value FROM UserSettings WHERE UserId = @uid AND Key = @key";
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.Parameters.AddWithValue("@key", key);
        var result = cmd.ExecuteScalar();
        return result?.ToString();
    }

    public void SetUserSetting(int userId, string key, string? value)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO UserSettings (UserId, Key, Value) VALUES (@uid, @key, @value)";
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.Parameters.AddWithValue("@key", key);
        cmd.Parameters.AddWithValue("@value", (object?)value ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public AppSettingsModel GetUserSettingsModel(int userId)
    {
        return new AppSettingsModel
        {
            BackupDestination = GetUserSetting(userId, "BackupDestination"),
            DefaultRestoreBasePath = GetUserSetting(userId, "DefaultRestoreBasePath"),
            AzureDevOpsToken = GetUserSetting(userId, "AzureDevOpsToken"),
            AzureDevOpsUrl = GetUserSetting(userId, "AzureDevOpsUrl"),
            AzureReleaseDefinitionId = int.TryParse(GetUserSetting(userId, "AzureReleaseDefinitionId"), out var id) ? id : 0,
            NotificationApiUrl = GetUserSetting(userId, "NotificationApiUrl"),
            SqlUsername = GetUserSetting(userId, "SqlUsername"),
            SqlPassword = GetUserSetting(userId, "SqlPassword"),
            NetworkUsername = GetUserSetting(userId, "NetworkUsername"),
            NetworkPassword = GetUserSetting(userId, "NetworkPassword"),
            DefaultIncludeLogDatabase = string.Equals(GetUserSetting(userId, "DefaultIncludeLogDatabase"), "true", StringComparison.OrdinalIgnoreCase),
            ShowDiffDateRestore = string.Equals(GetUserSetting(userId, "ShowDiffDateRestore"), "true", StringComparison.OrdinalIgnoreCase),
            ScriptsRestoreBasePath = GetUserSetting(userId, "ScriptsRestoreBasePath"),
            HideSelectAllInDelete = string.Equals(GetUserSetting(userId, "HideSelectAllInDelete"), "true", StringComparison.OrdinalIgnoreCase),
            DeleteExceptionDatabases = GetUserSetting(userId, "DeleteExceptionDatabases"),
            RestoreExceptionDatabases = GetUserSetting(userId, "RestoreExceptionDatabases"),
            Theme = GetUserSetting(userId, "Theme")
        };
    }

    public List<string> GetKnownDatabases()
    {
        var databases = new List<string>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Name FROM KnownDatabases ORDER BY LastUsedAt DESC, Name ASC";
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) databases.Add(reader.GetString(0));
        return databases;
    }

    public void AddKnownDatabase(string name)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO KnownDatabases (Name, LastUsedAt) VALUES (@name, @lastUsed)";
        cmd.Parameters.AddWithValue("@name", name);
        cmd.Parameters.AddWithValue("@lastUsed", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        cmd.ExecuteNonQuery();
    }

    public List<RestoreHistoryModel> GetRestoreHistory(int limit = 100)
    {
        var history = new List<RestoreHistoryModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT h.Id, h.ServerName, h.InstanceName, h.DatabaseName, h.BackupFile, h.RestorePath, h.Status, h.StartedAt, h.FinishedAt, h.Duration, h.ErrorMessage, h.TriggeredAzure, h.AzureReleaseId, h.PostCheck, h.UserId, u.Username, h.AzureStatus FROM RestoreHistory h LEFT JOIN Users u ON h.UserId = u.Id ORDER BY h.Id DESC LIMIT {limit}";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            history.Add(new RestoreHistoryModel
            {
                Id = reader.GetInt32(0),
                ServerName = reader.GetString(1),
                InstanceName = reader.GetString(2),
                DatabaseName = reader.GetString(3),
                BackupFile = reader.IsDBNull(4) ? null : reader.GetString(4),
                RestorePath = reader.IsDBNull(5) ? null : reader.GetString(5),
                Status = Enum.Parse<RestoreStatus>(reader.GetString(6)),
                StartedAt = reader.IsDBNull(7) ? null : DateTime.Parse(reader.GetString(7)),
                FinishedAt = reader.IsDBNull(8) ? null : DateTime.Parse(reader.GetString(8)),
                Duration = reader.IsDBNull(9) ? null : reader.GetString(9),
                ErrorMessage = reader.IsDBNull(10) ? null : reader.GetString(10),
                TriggeredAzure = reader.GetInt32(11) == 1,
                AzureReleaseId = reader.IsDBNull(12) ? null : reader.GetString(12),
                PostCheck = reader.IsDBNull(13) ? null : reader.GetString(13),
                UserId = reader.IsDBNull(14) ? null : reader.GetInt32(14),
                UserName = reader.IsDBNull(15) ? null : reader.GetString(15),
                AzureStatus = reader.IsDBNull(16) ? null : reader.GetString(16)
            });
        }
        return history;
    }

    public void AddRestoreHistory(RestoreHistoryModel history)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO RestoreHistory (ServerName, InstanceName, DatabaseName, BackupFile, RestorePath, Status, StartedAt, FinishedAt, Duration, ErrorMessage, TriggeredAzure, AzureReleaseId, PostCheck, UserId, AzureStatus)
                           VALUES (@server, @instance, @database, @backup, @restorePath, @status, @startedAt, @finishedAt, @duration, @error, @triggeredAzure, @azureReleaseId, @postCheck, @userId, @azureStatus)";
        cmd.Parameters.AddWithValue("@server", history.ServerName);
        cmd.Parameters.AddWithValue("@instance", history.InstanceName);
        cmd.Parameters.AddWithValue("@database", history.DatabaseName);
        cmd.Parameters.AddWithValue("@backup", (object?)history.BackupFile ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@restorePath", (object?)history.RestorePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@status", history.Status.ToString());
        cmd.Parameters.AddWithValue("@startedAt", (object?)history.StartedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@finishedAt", (object?)history.FinishedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@duration", (object?)history.Duration ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@error", (object?)history.ErrorMessage ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@triggeredAzure", history.TriggeredAzure ? 1 : 0);
        cmd.Parameters.AddWithValue("@azureReleaseId", (object?)history.AzureReleaseId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@postCheck", (object?)history.PostCheck ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@userId", (object?)history.UserId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@azureStatus", (object?)history.AzureStatus ?? DBNull.Value);
        cmd.ExecuteNonQuery();
        cmd.CommandText = "SELECT last_insert_rowid();";
        history.Id = Convert.ToInt32(cmd.ExecuteScalar());
    }

    public void UpdateRestoreHistory(RestoreHistoryModel history)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE RestoreHistory SET Status = @status, FinishedAt = @finishedAt, Duration = @duration, ErrorMessage = @error, TriggeredAzure = @triggeredAzure, AzureReleaseId = @azureReleaseId,
                            BackupFile = @backupFile, RestorePath = @restorePath, PostCheck = @postCheck, AzureStatus = @azureStatus
                           WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", history.Id);
        cmd.Parameters.AddWithValue("@status", history.Status.ToString());
        cmd.Parameters.AddWithValue("@finishedAt", (object?)history.FinishedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@duration", (object?)history.Duration ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@error", (object?)history.ErrorMessage ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@triggeredAzure", history.TriggeredAzure ? 1 : 0);
        cmd.Parameters.AddWithValue("@azureReleaseId", (object?)history.AzureReleaseId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@backupFile", (object?)history.BackupFile ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@restorePath", (object?)history.RestorePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@postCheck", (object?)history.PostCheck ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@azureStatus", (object?)history.AzureStatus ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public List<(int Id, string AzureReleaseId)> GetNonTerminalAzureHistory()
    {
        var results = new List<(int Id, string AzureReleaseId)>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT Id, AzureReleaseId FROM RestoreHistory 
                           WHERE TriggeredAzure = 1 
                           AND AzureReleaseId IS NOT NULL AND AzureReleaseId <> ''
                           AND (AzureStatus IS NULL OR AzureStatus = '' 
                                OR AzureStatus = 'Em andamento' 
                                OR AzureStatus = 'Na fila' 
                                OR AzureStatus = 'Disparado')
                           ORDER BY Id DESC";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            results.Add((reader.GetInt32(0), reader.GetString(1)));
        }
        return results;
    }

    public void UpdateAzureReleaseStatus(int historyId, string? azureStatus)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE RestoreHistory SET AzureStatus = @status WHERE Id = @id";
        cmd.Parameters.AddWithValue("@status", (object?)azureStatus ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@id", historyId);
        cmd.ExecuteNonQuery();
    }

    public void UpdateAzureStatus(List<int> historyIds, string azureReleaseId)
    {
        if (historyIds == null || historyIds.Count == 0) return;

        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        var placeholders = string.Join(",", historyIds.Select((_, i) => $"@id{i}"));
        var triggered = string.IsNullOrEmpty(azureReleaseId) ? 0 : 1;
        cmd.CommandText = $"UPDATE RestoreHistory SET TriggeredAzure = @triggered, AzureReleaseId = @azureReleaseId WHERE Id IN ({placeholders})";
        for (int i = 0; i < historyIds.Count; i++)
            cmd.Parameters.AddWithValue($"@id{i}", historyIds[i]);
        cmd.Parameters.AddWithValue("@triggered", triggered);
        cmd.Parameters.AddWithValue("@azureReleaseId", (object?)azureReleaseId ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    public void ClearRestoreHistory()
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM RestoreHistory";
        cmd.ExecuteNonQuery();
    }

    public List<DeleteHistoryModel> GetDeleteHistory(int limit = 100)
    {
        var history = new List<DeleteHistoryModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT h.Id, h.ServerName, h.InstanceName, h.DatabaseName, h.Status, h.Message, h.DeletedAt, h.UserId, u.Username FROM DeleteHistory h LEFT JOIN Users u ON h.UserId = u.Id ORDER BY h.Id DESC LIMIT {limit}";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            history.Add(new DeleteHistoryModel
            {
                Id = reader.GetInt32(0),
                ServerName = reader.GetString(1),
                InstanceName = reader.GetString(2),
                DatabaseName = reader.GetString(3),
                Status = reader.GetString(4),
                Message = reader.IsDBNull(5) ? null : reader.GetString(5),
                DeletedAt = reader.IsDBNull(6) ? null : DateTime.Parse(reader.GetString(6)),
                UserId = reader.IsDBNull(7) ? null : reader.GetInt32(7),
                UserName = reader.IsDBNull(8) ? null : reader.GetString(8)
            });
        }
        return history;
    }

    public void AddDeleteHistory(DeleteHistoryModel history)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO DeleteHistory (ServerName, InstanceName, DatabaseName, Status, Message, DeletedAt, UserId)
                           VALUES (@server, @instance, @database, @status, @message, @deletedAt, @userId)";
        cmd.Parameters.AddWithValue("@server", history.ServerName);
        cmd.Parameters.AddWithValue("@instance", history.InstanceName);
        cmd.Parameters.AddWithValue("@database", history.DatabaseName);
        cmd.Parameters.AddWithValue("@status", history.Status);
        cmd.Parameters.AddWithValue("@message", (object?)history.Message ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@deletedAt", (object?)history.DeletedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@userId", (object?)history.UserId ?? DBNull.Value);
        cmd.ExecuteNonQuery();
        cmd.CommandText = "SELECT last_insert_rowid();";
        history.Id = Convert.ToInt32(cmd.ExecuteScalar());
    }

    public void ClearDeleteHistory()
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM DeleteHistory";
        cmd.ExecuteNonQuery();
    }

    public List<PostRestoreScriptModel> GetPostRestoreScripts()
    {
        var scripts = new List<PostRestoreScriptModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, DatabaseName, ScriptPath, SortOrder FROM PostRestoreScripts ORDER BY SortOrder, DatabaseName";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            scripts.Add(new PostRestoreScriptModel
            {
                Id = reader.GetInt32(0),
                DatabaseName = reader.GetString(1),
                ScriptPath = reader.IsDBNull(2) ? "" : reader.GetString(2),
                SortOrder = reader.IsDBNull(3) ? 0 : reader.GetInt32(3)
            });
        }
        return scripts;
    }

    public void AddPostRestoreScript(string databaseName, string scriptPath, int sortOrder = 0)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO PostRestoreScripts (DatabaseName, ScriptPath, SortOrder) VALUES (@db, @path, @order)";
        cmd.Parameters.AddWithValue("@db", databaseName);
        cmd.Parameters.AddWithValue("@path", scriptPath);
        cmd.Parameters.AddWithValue("@order", sortOrder);
        cmd.ExecuteNonQuery();
    }

    public void RemovePostRestoreScript(int id)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM PostRestoreScripts WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }

    public List<SecurityRuleModel> GetSecurityRules()
    {
        var rules = new List<SecurityRuleModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, ServerName, InstanceName, DatabaseName, RuleType, CreatedAt FROM SecurityRules ORDER BY ServerName, InstanceName, DatabaseName";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            rules.Add(new SecurityRuleModel
            {
                Id = reader.GetInt32(0),
                ServerName = reader.GetString(1),
                InstanceName = reader.GetString(2),
                DatabaseName = reader.GetString(3),
                RuleType = reader.GetString(4),
                CreatedAt = reader.GetString(5)
            });
        }
        return rules;
    }

    public void AddSecurityRule(string serverName, string instanceName, string databaseName, string ruleType)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO SecurityRules (ServerName, InstanceName, DatabaseName, RuleType, CreatedAt) VALUES (@server, @instance, @db, @type, @created)";
        cmd.Parameters.AddWithValue("@server", serverName);
        cmd.Parameters.AddWithValue("@instance", instanceName);
        cmd.Parameters.AddWithValue("@db", databaseName);
        cmd.Parameters.AddWithValue("@type", ruleType);
        cmd.Parameters.AddWithValue("@created", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        cmd.ExecuteNonQuery();
    }

    public void RemoveSecurityRule(int id)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM SecurityRules WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }

    public bool HasSecurityRule(string serverName, string instanceName, string databaseName, string operation)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT COUNT(*) FROM SecurityRules
                            WHERE ServerName = @server AND InstanceName = @instance
                            AND DatabaseName = @database
                            AND (RuleType = @type OR RuleType = 'Exclusão e Restauração')";
        cmd.Parameters.AddWithValue("@server", serverName);
        cmd.Parameters.AddWithValue("@instance", instanceName);
        cmd.Parameters.AddWithValue("@database", databaseName);
        cmd.Parameters.AddWithValue("@type", operation);
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    public string? GetSecurityRuleType(string serverName, string instanceName, string databaseName, string operation)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT RuleType FROM SecurityRules
                            WHERE ServerName = @server AND InstanceName = @instance
                            AND DatabaseName = @database
                            AND (RuleType = @type OR RuleType = 'Exclusão e Restauração')
                            LIMIT 1";
        cmd.Parameters.AddWithValue("@server", serverName);
        cmd.Parameters.AddWithValue("@instance", instanceName);
        cmd.Parameters.AddWithValue("@database", databaseName);
        cmd.Parameters.AddWithValue("@type", operation);
        return cmd.ExecuteScalar()?.ToString();
    }

    public DashboardResponse GetDashboardMetrics(string serverName, string instanceName)
    {
        var metrics = new DashboardMetrics();
        var backupStatus = new List<BackupStatusItem>();
        var timeline = new List<TimelineItem>();

        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT Status, COUNT(*) FROM RestoreHistory 
                           WHERE ServerName = @server AND InstanceName = @instance 
                           GROUP BY Status";
        cmd.Parameters.AddWithValue("@server", serverName);
        cmd.Parameters.AddWithValue("@instance", instanceName);
        using var reader = cmd.ExecuteReader();

        int total = 0, success = 0, error = 0;
        DateTime? lastFinished = null;

        while (reader.Read())
        {
            var status = reader.GetString(0);
            var count = reader.GetInt32(1);
            total += count;
            if (status == "Sucesso") success = count;
            else if (status == "Erro") error = count;
        }

        metrics.TotalRestores = total;
        metrics.SuccessCount = success;
        metrics.ErrorCount = error;
        metrics.SuccessRate = total > 0 ? $"{(success * 100.0 / total):F1}%" : "N/A";

        using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = @"SELECT Duration, FinishedAt, DatabaseName, Status, StartedAt FROM RestoreHistory 
                            WHERE ServerName = @server2 AND InstanceName = @instance2 
                            ORDER BY Id DESC LIMIT 50";
        cmd2.Parameters.AddWithValue("@server2", serverName);
        cmd2.Parameters.AddWithValue("@instance2", instanceName);
        using var reader2 = cmd2.ExecuteReader();

        var allDurations = new List<double>();
        while (reader2.Read())
        {
            var duration = reader2.IsDBNull(0) ? null : reader2.GetString(0);
            if (!string.IsNullOrEmpty(duration) && TimeSpan.TryParse(duration, out var ts))
                allDurations.Add(ts.TotalSeconds);

            if (reader2.IsDBNull(1) == false)
            {
                if (DateTime.TryParse(reader2.GetString(1), out var dt))
                {
                    if (lastFinished == null || dt > lastFinished.Value)
                        lastFinished = dt;
                }
            }

            var dbName = reader2.GetString(2);
            var status = reader2.GetString(3);
            var startedAt = reader2.IsDBNull(4) ? null : reader2.GetString(4);
            var finishedAt = reader2.IsDBNull(1) ? null : reader2.GetString(1);

            DateTime? start = null, finish = null;
            if (startedAt != null && DateTime.TryParse(startedAt, out var sd)) start = sd;
            if (finishedAt != null && DateTime.TryParse(finishedAt, out var fd)) finish = fd;

            var diff = (finish ?? DateTime.Now) - (start ?? DateTime.Now);
            var durStr = diff.TotalMinutes > 1 ? $"{diff.TotalMinutes:F1} min" : $"{diff.TotalSeconds:F0}s";

            timeline.Add(new TimelineItem
            {
                Time = finish?.ToString("HH:mm:ss") ?? "N/A",
                DatabaseName = dbName,
                Duration = durStr,
                Status = status,
                StatusColor = status == "Sucesso" ? "#4CAF50" : status == "Erro" ? "#F44336" : "#FFC107"
            });
        }

        if (allDurations.Any())
        {
            var avgSec = allDurations.Average();
            metrics.AverageDuration = avgSec > 60 ? $"{avgSec / 60:F1} min" : $"{avgSec:F0}s";
        }

        metrics.LastRestoreDate = lastFinished?.ToString("dd/MM/yyyy HH:mm") ?? string.Empty;

        // Daily activity: success/error counts per day (last 14 days)
        var daily = new Dictionary<string, DayMetric>();
        using (var cmd3 = conn.CreateCommand())
        {
            cmd3.CommandText = @"SELECT substr(StartedAt, 1, 10) AS Day, Status, COUNT(*)
                                FROM RestoreHistory
                                WHERE ServerName = @server3 AND InstanceName = @instance3 AND StartedAt IS NOT NULL
                                GROUP BY substr(StartedAt, 1, 10), Status";
            cmd3.Parameters.AddWithValue("@server3", serverName);
            cmd3.Parameters.AddWithValue("@instance3", instanceName);
            using var reader3 = cmd3.ExecuteReader();
            while (reader3.Read())
            {
                var day = reader3.GetString(0);
                var status = reader3.GetString(1);
                var count = reader3.GetInt32(2);
                if (!daily.TryGetValue(day, out var dm))
                {
                    dm = new DayMetric { Date = day };
                    daily[day] = dm;
                }
                if (status == "Sucesso") dm.SuccessCount += count;
                else if (status == "Erro") dm.ErrorCount += count;
            }
        }

        var dailyActivity = new List<DayMetric>();
        for (int i = 13; i >= 0; i--)
        {
            var dayKey = DateTime.Today.AddDays(-i).ToString("yyyy-MM-dd");
            dailyActivity.Add(daily.TryGetValue(dayKey, out var existing) ? existing : new DayMetric { Date = dayKey });
        }

        // Duration by database: average restore duration per database (successful restores)
        var durationByDb = new Dictionary<string, (double TotalSeconds, int Count)>();
        using (var cmd4 = conn.CreateCommand())
        {
            cmd4.CommandText = @"SELECT DatabaseName, Duration FROM RestoreHistory
                                WHERE ServerName = @server4 AND InstanceName = @instance4 AND Status = 'Sucesso' AND Duration IS NOT NULL";
            cmd4.Parameters.AddWithValue("@server4", serverName);
            cmd4.Parameters.AddWithValue("@instance4", instanceName);
            using var reader4 = cmd4.ExecuteReader();
            while (reader4.Read())
            {
                var dbName = reader4.GetString(0);
                var duration = reader4.GetString(1);
                if (!TimeSpan.TryParse(duration, out var ts)) continue;
                var cur = durationByDb.TryGetValue(dbName, out var existing) ? existing : (0d, 0);
                durationByDb[dbName] = (cur.Item1 + ts.TotalSeconds, cur.Item2 + 1);
            }
        }

        var durationByDatabase = durationByDb
            .Select(kv => new DbDurationMetric
            {
                DatabaseName = kv.Key,
                AverageDuration = kv.Value.Item2 > 0
                    ? (kv.Value.Item1 / kv.Value.Item2) >= 60
                        ? $"{kv.Value.Item1 / kv.Value.Item2 / 60:F1} min"
                        : $"{kv.Value.Item1 / kv.Value.Item2:F0}s"
                    : "N/A"
            })
            .OrderByDescending(m =>
            {
                if (m.AverageDuration.EndsWith("min")) return double.TryParse(m.AverageDuration.Replace(" min", "").Replace(',', '.'), System.Globalization.CultureInfo.InvariantCulture, out var sec) ? sec * 60 : 0;
                if (m.AverageDuration.EndsWith("s")) return double.TryParse(m.AverageDuration.Replace("s", "").Replace(',', '.'), System.Globalization.CultureInfo.InvariantCulture, out var sec) ? sec : 0;
                return 0;
            })
            .Take(8)
            .ToList();

        return new DashboardResponse
        {
            Metrics = metrics,
            BackupStatus = backupStatus,
            Timeline = timeline.Take(20).ToList(),
            DailyActivity = dailyActivity,
            DurationByDatabase = durationByDatabase
        };
    }

    public int CreateUser(string username, string passwordHash, string role)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO Users (Username, PasswordHash, Role, IsActive, CreatedAt) VALUES (@u, @p, @r, 1, @c)";
        cmd.Parameters.AddWithValue("@u", username);
        cmd.Parameters.AddWithValue("@p", passwordHash);
        cmd.Parameters.AddWithValue("@r", role);
        cmd.Parameters.AddWithValue("@c", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        cmd.ExecuteNonQuery();

        using var idCmd = conn.CreateCommand();
        idCmd.CommandText = "SELECT last_insert_rowid()";
        return Convert.ToInt32(idCmd.ExecuteScalar());
    }

    public bool HasUsers()
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT EXISTS(SELECT 1 FROM Users LIMIT 1)";
        return Convert.ToInt32(cmd.ExecuteScalar()) == 1;
    }

    public UserModel? GetUserByUsername(string username)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, Username, PasswordHash, Role, IsActive, CreatedAt FROM Users WHERE Username = @u";
        cmd.Parameters.AddWithValue("@u", username);
        using var reader = cmd.ExecuteReader();
        if (reader.Read())
        {
            var user = new UserModel
            {
                Id = reader.GetInt32(0),
                Username = reader.GetString(1),
                PasswordHash = reader.GetString(2),
                Role = reader.GetString(3),
                IsActive = reader.GetInt32(4) == 1,
                CreatedAt = DateTime.Parse(reader.GetString(5))
            };
            user.Permissions = GetUserPermissions(user.Id);
            return user;
        }
        return null;
    }

    public List<UserModel> GetUsers()
    {
        var users = new List<UserModel>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, Username, PasswordHash, Role, IsActive, CreatedAt FROM Users ORDER BY Username";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            users.Add(new UserModel
            {
                Id = reader.GetInt32(0),
                Username = reader.GetString(1),
                PasswordHash = reader.GetString(2),
                Role = reader.GetString(3),
                IsActive = reader.GetInt32(4) == 1,
                CreatedAt = DateTime.Parse(reader.GetString(5))
            });
        }
        foreach (var user in users)
            user.Permissions = GetUserPermissions(user.Id);
        return users;
    }

    public void UpdateUser(int id, string? passwordHash, string? role, bool? isActive)
    {
        using var conn = CreateConnection();
        var updates = new List<string>();
        if (passwordHash != null) updates.Add("PasswordHash = @p");
        if (role != null) updates.Add("Role = @r");
        if (isActive.HasValue) updates.Add("IsActive = @a");
        if (updates.Count == 0) return;

        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE Users SET {string.Join(", ", updates)} WHERE Id = @id";
        if (passwordHash != null) cmd.Parameters.AddWithValue("@p", passwordHash);
        if (role != null) cmd.Parameters.AddWithValue("@r", role);
        if (isActive.HasValue) cmd.Parameters.AddWithValue("@a", isActive.Value ? 1 : 0);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }

    public void DeleteUser(int id)
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM UserPermissions WHERE UserId = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
        cmd.CommandText = "DELETE FROM Users WHERE Id = @id";
        cmd.ExecuteNonQuery();
    }

    public void SetUserPermissions(int userId, List<string> permissions)
    {
        using var conn = CreateConnection();
        using var del = conn.CreateCommand();
        del.CommandText = "DELETE FROM UserPermissions WHERE UserId = @id";
        del.Parameters.AddWithValue("@id", userId);
        del.ExecuteNonQuery();

        foreach (var perm in permissions)
        {
            using var ins = conn.CreateCommand();
            ins.CommandText = "INSERT INTO UserPermissions (UserId, Permission) VALUES (@uid, @p)";
            ins.Parameters.AddWithValue("@uid", userId);
            ins.Parameters.AddWithValue("@p", perm);
            ins.ExecuteNonQuery();
        }
    }

    public List<string> GetUserPermissions(int userId)
    {
        var permissions = new List<string>();
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Permission FROM UserPermissions WHERE UserId = @id ORDER BY Permission";
        cmd.Parameters.AddWithValue("@id", userId);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
            permissions.Add(reader.GetString(0));
        return permissions;
    }

    public static string HashPassword(string password)
    {
        return BCrypt.Net.BCrypt.HashPassword(password, workFactor: 12);
    }

    public static bool VerifyPassword(string password, string storedHash)
    {
        if (string.IsNullOrEmpty(storedHash)) return false;

        if (storedHash.StartsWith("$2"))
            return BCrypt.Net.BCrypt.Verify(password, storedHash);

        try
        {
            var bytes = Convert.FromBase64String(storedHash);
            if (bytes.Length != 64) return false;
            var salt = new byte[32];
            var hash = new byte[32];
            Buffer.BlockCopy(bytes, 0, salt, 0, 32);
            Buffer.BlockCopy(bytes, 32, hash, 0, 32);
            var newHash = System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(
                password, salt, 100000, System.Security.Cryptography.HashAlgorithmName.SHA256, 32);
            return Convert.ToBase64String(hash) == Convert.ToBase64String(newHash);
        }
        catch { return false; }
    }

    public static bool IsBcryptHash(string hash) => hash.StartsWith("$2");
}
