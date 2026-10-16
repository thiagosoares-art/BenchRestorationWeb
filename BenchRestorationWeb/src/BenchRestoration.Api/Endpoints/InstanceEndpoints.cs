using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class InstanceEndpoints
{
    public static void MapInstanceEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/instances")
            .WithTags("Instances");

        group.MapGet("/by-server/{serverId}", (AppDbContext db, int serverId) =>
        {
            return Results.Ok(db.GetInstances(serverId));
        });

        group.MapPost("/", (AppDbContext db, InstanceModel instance) =>
        {
            db.AddInstance(instance);
            return Results.Ok(new { message = "Instância adicionada com sucesso" });
        });

        group.MapPut("/{id}", (AppDbContext db, int id, InstanceModel instance) =>
        {
            db.UpdateInstance(id, instance);
            return Results.Ok(new { message = "Instância atualizada com sucesso" });
        });

        group.MapDelete("/{id}", (AppDbContext db, int id) =>
        {
            db.RemoveInstance(id);
            return Results.Ok(new { message = "Instância removida com sucesso" });
        });
    }
}
