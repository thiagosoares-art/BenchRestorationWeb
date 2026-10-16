using BenchRestoration.Api.Security;

namespace BenchRestoration.Api.Endpoints;

public static class TestEndpoints
{
    public static void MapTestEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/test")
            .WithTags("Test");

        group.MapPost("/sql", async (TestSqlConnectionRequest request) =>
        {
            try
            {
                var connStr = ConnectionStringBuilder.Build(request.ServerName, request.InstanceName, request.Username, request.Password);
                using var conn = new Microsoft.Data.SqlClient.SqlConnection(connStr);
                await conn.OpenAsync();

                using var cmd = new Microsoft.Data.SqlClient.SqlCommand("SELECT @@SERVERNAME + ' - ' + @@VERSION", conn);
                var serverInfo = await cmd.ExecuteScalarAsync();

                return Results.Ok(new { success = true, message = $"Conexão estabelecida com sucesso!\n{serverInfo}" });
            }
            catch (Microsoft.Data.SqlClient.SqlException ex)
            {
                var message = ex.Number switch
                {
                    2 => "Servidor não encontrado ou não acessível.",
                    18 => "Timeout expirado. Verifique se o SQL Server permite conexões remotas.",
                    18456 => "Falha no login. Verifique o usuário e senha.",
                    _ => $"Erro SQL: {ex.Message}"
                };
                return Results.Ok(new { success = false, message });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Erro ao conectar: {ex.Message}" });
            }
        });

        group.MapPost("/network", async (TestNetworkRequest request) =>
        {
            try
            {
                if (!request.Path.StartsWith(@"\\"))
                    return Results.Ok(new { success = false, message = "Caminho deve ser UNC (\\\\servidor\\pasta)" });

                var dir = new DirectoryInfo(request.Path);
                if (dir.Exists)
                    return Results.Ok(new { success = true, message = "Conexão estabelecida com sucesso!" });

                return Results.Ok(new { success = false, message = "Caminho não encontrado ou inacessível." });
            }
            catch (UnauthorizedAccessException)
            {
                return Results.Ok(new { success = false, message = "Acesso negado. Verifique as credenciais." });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Erro ao conectar: {ex.Message}" });
            }
        });

        group.MapGet("/notification", async (string url) =>
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                var response = await client.GetAsync(url);
                return Results.Ok(new
                {
                    success = response.IsSuccessStatusCode,
                    message = response.IsSuccessStatusCode ? "API conectada com sucesso!" : $"Erro: {response.StatusCode}"
                });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Erro ao conectar: {ex.Message}" });
            }
        });

        group.MapPost("/azure", async (TestAzureRequest request) =>
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                var base64Token = Convert.ToBase64String(System.Text.Encoding.ASCII.GetBytes($":{request.Token}"));
                client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", base64Token);
                client.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));

                // Test with GET first (read-only)
                var getResponse = await client.GetAsync(request.Url);
                var getStatus = (int)getResponse.StatusCode;

                if (!getResponse.IsSuccessStatusCode)
                {
                    return Results.Ok(new { success = false, message = $"GET falhou: {getStatus} {getResponse.StatusCode}" });
                }

                // Test with POST (create release) - send definitionId 0 (expected 404)
                var testBody0 = new { definitionId = 0 };
                var json0 = System.Text.Json.JsonSerializer.Serialize(testBody0);
                var content0 = new StringContent(json0, System.Text.Encoding.UTF8, "application/json");

                var postResponse0 = await client.PostAsync(request.Url, content0);
                var postString0 = await postResponse0.Content.ReadAsStringAsync();
                var postStatus0 = (int)postResponse0.StatusCode;
                var isJson0 = postString0.TrimStart().StartsWith("{") || postString0.TrimStart().StartsWith("[");

                // Test with POST (create release) - send definitionId 1 (might exist)
                var testBody1 = new { definitionId = 1 };
                var json1 = System.Text.Json.JsonSerializer.Serialize(testBody1);
                var content1 = new StringContent(json1, System.Text.Encoding.UTF8, "application/json");

                var postResponse1 = await client.PostAsync(request.Url, content1);
                var postString1 = await postResponse1.Content.ReadAsStringAsync();
                var postStatus1 = (int)postResponse1.StatusCode;
                var isJson1 = postString1.TrimStart().StartsWith("{") || postString1.TrimStart().StartsWith("[");

                return Results.Ok(new
                {
                    success = isJson0,
                    message = $"GET: {getStatus} OK | POST(id=0): {postStatus0} {(isJson0 ? "JSON" : "HTML")} | POST(id=1): {postStatus1} {(isJson1 ? "JSON" : "HTML")}",
                    postPreview = postString0.Length > 200 ? postString0.Substring(0, 200) : postString0,
                    postPreview2 = postString1.Length > 200 ? postString1.Substring(0, 200) : postString1
                });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Erro: {ex.Message}" });
            }
        });
    }
}

public class TestSqlConnectionRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? Password { get; set; }
}

public class TestNetworkRequest
{
    public string Path { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class TestAzureRequest
{
    public string Token { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
}
