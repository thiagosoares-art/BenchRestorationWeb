using BenchRestoration.Api.Data;

namespace BenchRestoration.Api.Endpoints;

public static class PostRestoreScriptsEndpoints
{
    public static void MapPostRestoreScriptsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/post-restore-scripts")
            .WithTags("Post-Restore Scripts");

        group.MapGet("/", (AppDbContext db) =>
        {
            try
            {
                return Results.Ok(db.GetPostRestoreScripts());
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao listar scripts: {ex.Message}" });
            }
        });

        group.MapPost("/", (PostRestoreScriptRequest request, AppDbContext db) =>
        {
            try
            {
                db.AddPostRestoreScript(request.DatabaseName, request.ScriptPath, request.SortOrder);
                return Results.Ok(new { message = "Script adicionado com sucesso" });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao adicionar script: {ex.Message}" });
            }
        });

        group.MapDelete("/{id}", (int id, AppDbContext db) =>
        {
            try
            {
                db.RemovePostRestoreScript(id);
                return Results.Ok(new { message = "Script removido com sucesso" });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao remover script: {ex.Message}" });
            }
        });
    }
}

public class PostRestoreScriptRequest
{
    public string DatabaseName { get; set; } = string.Empty;
    public string ScriptPath { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}