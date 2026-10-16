using System.Security.Claims;
using BenchRestoration.Api.Data;
using BenchRestoration.Api.Security;
using BenchRestoration.Shared.Models;
using BenchRestoration.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace BenchRestoration.Api.Endpoints;

public static class HistoryEndpoints
{
    private static int GetUserId(HttpContext ctx)
    {
        var claim = ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(claim, out var id) ? id : 0;
    }

    public static void MapHistoryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/history")
            .WithTags("History");

        group.MapGet("/", (AppDbContext db, int? limit) =>
        {
            return Results.Ok(db.GetRestoreHistory(limit ?? 100));
        });

        group.MapDelete("/", (AppDbContext db) =>
        {
            db.ClearRestoreHistory();
            return Results.Ok(new { message = "Histórico limpo com sucesso" });
        });

        group.MapGet("/delete", (AppDbContext db, int? limit) =>
        {
            return Results.Ok(db.GetDeleteHistory(limit ?? 100));
        });

        group.MapDelete("/delete", (AppDbContext db) =>
        {
            db.ClearDeleteHistory();
            return Results.Ok(new { message = "Histórico de exclusão limpo com sucesso" });
        });

        group.MapPost("/azure", (AzureStatusUpdateRequest request, AppDbContext db) =>
        {
            if (request.HistoryIds == null || request.HistoryIds.Count == 0)
                return Results.BadRequest(new { message = "Nenhum registro de histórico informado" });

            db.UpdateAzureStatus(request.HistoryIds, request.AzureReleaseId);
            var hasRelease = !string.IsNullOrEmpty(request.AzureReleaseId);
            return Results.Ok(new { message = $"Azure atualizado em {request.HistoryIds.Count} registro(s)" });
        });

        group.MapPost("/refresh-azure-status", async (HttpContext httpContext, AppDbContext db, IHubContext<RestoreHub> hubContext) =>
        {
            var userId = GetUserId(httpContext);
            if (userId == 0) return Results.Unauthorized();

            var azureTokenRaw = db.GetUserSetting(userId, "AzureDevOpsToken");
            var azureUrl = db.GetUserSetting(userId, "AzureDevOpsUrl");
            var azureToken = PasswordEncryption.Decrypt(azureTokenRaw ?? string.Empty);

            if (string.IsNullOrEmpty(azureToken) || string.IsNullOrEmpty(azureUrl))
                return Results.BadRequest(new { message = "Token ou URL do Azure DevOps não configurados" });

            var pendingRecords = db.GetNonTerminalAzureHistory();
            if (pendingRecords.Count == 0)
                return Results.Ok(new { message = "Nenhum registro pendente encontrado", checked_ = 0, updated = 0 });

            var uniqueReleaseIds = pendingRecords.Select(r => r.AzureReleaseId).Distinct().ToList();
            var updatedCount = 0;

            foreach (var releaseId in uniqueReleaseIds)
            {
                try
                {
                    var statusUrl = await RestoreEndpoints.GetAzureStatusUrlAsync(azureUrl, azureToken, releaseId, CancellationToken.None);
                    if (statusUrl == null) continue;

                    var rawStatus = await RestoreEndpoints.GetAzureStatusValueAsync(statusUrl, azureToken, CancellationToken.None);
                    if (rawStatus == null) continue;

                    var label = RestoreEndpoints.MapAzureStatus(rawStatus);

                    var affectedIds = pendingRecords.Where(r => r.AzureReleaseId == releaseId).Select(r => r.Id).ToList();
                    foreach (var historyId in affectedIds)
                    {
                        db.UpdateAzureReleaseStatus(historyId, label);
                        updatedCount++;
                    }

                    await hubContext.Clients.All.SendAsync("AzureStatusUpdate",
                        new { historyIds = affectedIds, releaseId, status = label, rawStatus, color = RestoreEndpoints.MapAzureStatus(rawStatus) });
                }
                catch { }
            }

            return Results.Ok(new
            {
                message = updatedCount > 0
                    ? $"{updatedCount} registro(s) atualizado(s) ({uniqueReleaseIds.Count} pipeline(s) verificada(s))"
                    : $"Nenhuma alteração ({uniqueReleaseIds.Count} pipeline(s) verificada(s))",
                checked_ = uniqueReleaseIds.Count,
                updated = updatedCount
            });
        });
    }
}

public class AzureStatusUpdateRequest
{
    public List<int> HistoryIds { get; set; } = new();
    public string AzureReleaseId { get; set; } = string.Empty;
}
