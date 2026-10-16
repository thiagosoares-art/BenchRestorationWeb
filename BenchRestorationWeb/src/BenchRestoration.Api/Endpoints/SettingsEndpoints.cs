using System.Security.Claims;
using System.Text.Json;
using BenchRestoration.Api.Data;
using BenchRestoration.Api.Security;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class SettingsEndpoints
{
    private static readonly string[] SensitiveKeys = ["AzureDevOpsToken", "SqlPassword", "NetworkPassword"];

    private static int GetUserId(HttpContext ctx)
    {
        var claim = ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(claim, out var id) ? id : 0;
    }

    public static void MapSettingsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/settings")
            .WithTags("Settings");

        group.MapGet("/", (HttpContext httpContext, AppDbContext db) =>
        {
            var userId = GetUserId(httpContext);
            if (userId == 0) return Results.Unauthorized();

            var settings = db.GetUserSettingsModel(userId);
            settings.SqlPassword = PasswordEncryption.Decrypt(settings.SqlPassword ?? string.Empty);
            settings.NetworkPassword = PasswordEncryption.Decrypt(settings.NetworkPassword ?? string.Empty);
            settings.AzureDevOpsToken = PasswordEncryption.Decrypt(settings.AzureDevOpsToken ?? string.Empty);
            return Results.Ok(settings);
        });

        group.MapPut("/", async (HttpContext httpContext, AppDbContext db, HttpRequest request) =>
        {
            var userId = GetUserId(httpContext);
            if (userId == 0) return Results.Unauthorized();

            try
            {
                var body = await request.ReadFromJsonAsync<Dictionary<string, object?>>();
                if (body == null)
                    return Results.BadRequest(new { message = "Dados inválidos" });

                foreach (var kvp in body)
                {
                    var key = char.ToUpper(kvp.Key[0]) + kvp.Key[1..];
                    var value = kvp.Value?.ToString();
                    if (SensitiveKeys.Contains(key, StringComparer.OrdinalIgnoreCase) && !string.IsNullOrEmpty(value))
                    {
                        value = PasswordEncryption.Encrypt(value);
                    }
                    db.SetUserSetting(userId, key, value);
                }
                return Results.Ok(new { message = "Configurações salvas com sucesso" });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao salvar: {ex.Message}" });
            }
        });

        group.MapGet("/export", (HttpContext httpContext, AppDbContext db) =>
        {
            var userId = GetUserId(httpContext);
            if (userId == 0) return Results.Unauthorized();

            var settings = db.GetUserSettingsModel(userId);
            var servers = db.GetServers(userId);
            var allInstances = new List<InstanceModel>();
            foreach (var server in servers)
            {
                allInstances.AddRange(db.GetInstances(server.Id));
            }
            var backupSources = db.GetBackupSources(userId);

            return Results.Ok(new
            {
                version = "2.0.0",
                exportDate = DateTime.Now.ToString("o"),
                settings = new Dictionary<string, string?>
                {
                    ["BackupDestination"] = db.GetUserSetting(userId, "BackupDestination"),
                    ["DefaultRestoreBasePath"] = db.GetUserSetting(userId, "DefaultRestoreBasePath"),
                    ["DefaultIncludeLogDatabase"] = db.GetUserSetting(userId, "DefaultIncludeLogDatabase"),
                    ["ShowDiffDateRestore"] = db.GetUserSetting(userId, "ShowDiffDateRestore"),
                    ["ScriptsRestoreBasePath"] = db.GetUserSetting(userId, "ScriptsRestoreBasePath"),
                    ["SqlUsername"] = db.GetUserSetting(userId, "SqlUsername"),
                    ["SqlPassword"] = db.GetUserSetting(userId, "SqlPassword"),
                    ["AzureDevOpsToken"] = db.GetUserSetting(userId, "AzureDevOpsToken"),
                    ["AzureDevOpsUrl"] = db.GetUserSetting(userId, "AzureDevOpsUrl"),
                    ["AzureReleaseDefinitionId"] = db.GetUserSetting(userId, "AzureReleaseDefinitionId"),
                    ["NotificationApiUrl"] = db.GetUserSetting(userId, "NotificationApiUrl"),
                    ["NetworkUsername"] = db.GetUserSetting(userId, "NetworkUsername"),
                    ["NetworkPassword"] = db.GetUserSetting(userId, "NetworkPassword"),
                    ["HideSelectAllInDelete"] = db.GetUserSetting(userId, "HideSelectAllInDelete"),
                    ["DeleteExceptionDatabases"] = db.GetUserSetting(userId, "DeleteExceptionDatabases"),
                    ["RestoreExceptionDatabases"] = db.GetUserSetting(userId, "RestoreExceptionDatabases"),
                    ["MaxConcurrentRestores"] = db.GetUserSetting(userId, "MaxConcurrentRestores"),
                    ["Theme"] = db.GetUserSetting(userId, "Theme")
                },
                servers,
                instances = allInstances,
                backupSources
            });
        });

        group.MapPost("/import", async (HttpContext httpContext, AppDbContext db, HttpRequest request) =>
        {
            var userId = GetUserId(httpContext);
            if (userId == 0) return Results.Unauthorized();

            var errors = new List<string>();
            int settingsCount = 0, serversCount = 0, instancesCount = 0, sourcesCount = 0;

            try
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var body = await request.ReadFromJsonAsync<ConfigImportRequest>(options);
                if (body == null)
                    return Results.BadRequest(new { message = "Dados inválidos" });

                // Apply settings per user
                if (body.Settings != null)
                {
                    foreach (var kvp in body.Settings)
                    {
                        try
                        {
                            var value = kvp.Value;
                            if (SensitiveKeys.Contains(kvp.Key, StringComparer.OrdinalIgnoreCase) && !string.IsNullOrEmpty(value))
                            {
                                value = PasswordEncryption.Encrypt(value);
                            }
                            db.SetUserSetting(userId, kvp.Key, value);
                            settingsCount++;
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"Setting '{kvp.Key}': {ex.Message}");
                        }
                    }
                }

                // Apply servers and build name->id mapping
                var serverNameToId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                if (body.Servers != null)
                {
                    foreach (var server in body.Servers)
                    {
                        try
                        {
                            var existing = db.GetServers(userId).FirstOrDefault(s => s.Name == server.Name);
                            if (existing != null)
                            {
                                serverNameToId[server.Name] = existing.Id;
                            }
                            else
                            {
                                db.AddServer(server.Name, userId, server.Description, server.BackupPath, server.RestorePath);
                                var refreshed = db.GetServers(userId).FirstOrDefault(s => s.Name == server.Name);
                                if (refreshed != null)
                                    serverNameToId[server.Name] = refreshed.Id;
                            }
                            serversCount++;
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"Server '{server.Name}': {ex.Message}");
                        }
                    }
                }

                // Apply instances using the name->id mapping
                if (body.Instances != null)
                {
                    foreach (var instance in body.Instances)
                    {
                        try
                        {
                            var serverName = instance.DisplayName?.Split('\\')[0];
                            if (string.IsNullOrEmpty(serverName) && body.Servers != null)
                            {
                                var sourceServer = body.Servers.FirstOrDefault(s => s.Id == instance.ServerId);
                                serverName = sourceServer?.Name;
                            }

                            if (!string.IsNullOrEmpty(serverName) && serverNameToId.TryGetValue(serverName, out var localServerId))
                            {
                                db.AddInstance(new InstanceModel
                                {
                                    ServerId = localServerId,
                                    Name = instance.Name,
                                    DisplayName = instance.DisplayName,
                                    AuthType = instance.AuthType,
                                    Username = instance.Username,
                                    PasswordEnc = instance.PasswordEnc,
                                    RestorePath = instance.RestorePath,
                                    AzureReleaseDefinitionId = instance.AzureReleaseDefinitionId
                                });
                                instancesCount++;
                            }
                            else
                            {
                                errors.Add($"Instance '{instance.DisplayName}': servidor '{serverName}' não encontrado");
                            }
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"Instance '{instance.DisplayName}': {ex.Message}");
                        }
                    }
                }

                // Apply backup sources
                if (body.BackupSources != null)
                {
                    foreach (var source in body.BackupSources)
                    {
                        try
                        {
                            db.AddBackupSource(source.SharePath, userId, source.Description);
                            sourcesCount++;
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"BackupSource '{source.SharePath}': {ex.Message}");
                        }
                    }
                }

                var summary = $"Configurações: {settingsCount}, Servidores: {serversCount}, Instâncias: {instancesCount}, Fontes: {sourcesCount}";
                if (errors.Count > 0)
                {
                    return Results.Ok(new { message = $"Importação parcial. {summary}", errors });
                }
                return Results.Ok(new { message = $"Importação concluída. {summary}" });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao importar: {ex.Message}", errors });
            }
        });
    }
}

public class ConfigImportRequest
{
    public string? Version { get; set; }
    public DateTime ExportDate { get; set; }
    public Dictionary<string, string?>? Settings { get; set; }
    public List<ServerModel>? Servers { get; set; }
    public List<InstanceModel>? Instances { get; set; }
    public List<BackupSourceModel>? BackupSources { get; set; }
}
