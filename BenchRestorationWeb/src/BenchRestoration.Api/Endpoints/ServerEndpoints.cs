using System.Security.Claims;
using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class ServerEndpoints
{
    public static void MapServerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/servers")
            .WithTags("Servers");

        group.MapGet("/", (HttpContext httpContext, AppDbContext db) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            return Results.Ok(db.GetServers(userId));
        });

        group.MapPost("/", (HttpContext httpContext, AppDbContext db, ServerModel server) =>
        {
            var userId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            db.AddServer(server.Name, userId, server.Description, server.BackupPath, server.RestorePath);
            return Results.Ok(new { message = "Servidor adicionado com sucesso" });
        });

        group.MapPut("/{id}", (AppDbContext db, int id, ServerModel server) =>
        {
            server.Id = id;
            db.UpdateServer(server);
            return Results.Ok(new { message = "Servidor atualizado com sucesso" });
        });

        group.MapDelete("/{id}", (AppDbContext db, int id) =>
        {
            db.RemoveServer(id);
            return Results.Ok(new { message = "Servidor removido com sucesso" });
        });
    }
}
