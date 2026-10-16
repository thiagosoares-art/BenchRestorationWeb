using System.Security.Claims;
using BenchRestoration.Api.Data;
using BenchRestoration.Api.Services;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class BackupEndpoints
{
    public static void MapBackupEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/backups")
            .WithTags("Backups");

        group.MapPost("/generate", (HttpContext httpContext) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            var backupPath = DatabaseBackupService.DoBackup();
            DatabaseBackupService.CleanOldBackups();
            return Results.Ok(new { message = "Backup gerado com sucesso", backupPath });
        });

        group.MapGet("/sources", (HttpContext httpContext, AppDbContext db) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            return Results.Ok(db.GetBackupSources(userId));
        });

        group.MapPost("/sources", (HttpContext httpContext, AppDbContext db, BackupSourceModel source) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            db.AddBackupSource(source.SharePath, userId, source.Description);
            return Results.Ok(new { message = "Fonte de backup adicionada com sucesso" });
        });

        group.MapDelete("/sources/{id}", (AppDbContext db, int id) =>
        {
            db.RemoveBackupSource(id);
            return Results.Ok(new { message = "Fonte de backup removida com sucesso" });
        });

        group.MapGet("/known-databases", (AppDbContext db) =>
        {
            return Results.Ok(db.GetKnownDatabases());
        });

        group.MapPost("/known-databases", (AppDbContext db, KnownDatabaseRequest request) =>
        {
            if (!string.IsNullOrWhiteSpace(request.Name))
            {
                db.AddKnownDatabase(request.Name.Trim());
            }
            return Results.Ok(new { message = "Banco adicionado à lista" });
        });
    }
}

public class KnownDatabaseRequest
{
    public string Name { get; set; } = string.Empty;
}
