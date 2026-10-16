namespace BenchRestoration.Api.Security;

public static class ConnectionStringBuilder
{
    public static string Build(string serverName, string instanceName, string? username, string? password)
    {
        var server = instanceName == "MSSQLSERVER" || string.IsNullOrEmpty(instanceName)
            ? serverName
            : $"{serverName}\\{instanceName}";

        var connStr = $"Server={server};Encrypt=False;TrustServerCertificate=True;Connection Timeout=5;";

        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            connStr += "Integrated Security=True;";
        }
        else
        {
            connStr += $"User Id={username};Password={password};";
        }

        return connStr;
    }
}
