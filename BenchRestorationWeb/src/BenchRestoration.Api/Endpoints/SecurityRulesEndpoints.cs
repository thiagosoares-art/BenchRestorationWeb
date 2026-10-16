using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class SecurityRulesEndpoints
{
    public static void MapSecurityRulesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/security-rules")
            .WithTags("Security Rules");

        group.MapGet("/", (AppDbContext db) =>
        {
            try
            {
                return Results.Ok(db.GetSecurityRules());
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao listar regras: {ex.Message}" });
            }
        });

        group.MapPost("/", (SecurityRuleModel rule, AppDbContext db) =>
        {
            try
            {
                db.AddSecurityRule(rule.ServerName, rule.InstanceName, rule.DatabaseName, rule.RuleType);
                return Results.Ok(new { message = "Regra adicionada com sucesso" });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao adicionar regra: {ex.Message}" });
            }
        });

        group.MapDelete("/{id}", (int id, AppDbContext db) =>
        {
            try
            {
                db.RemoveSecurityRule(id);
                return Results.Ok(new { message = "Regra removida com sucesso" });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao remover regra: {ex.Message}" });
            }
        });

        group.MapPost("/check", (SecurityRuleCheckRequest request, AppDbContext db) =>
        {
            try
            {
                var hasRule = db.HasSecurityRule(request.ServerName, request.InstanceName, request.DatabaseName, request.Operation);
                var ruleType = hasRule ? db.GetSecurityRuleType(request.ServerName, request.InstanceName, request.DatabaseName, request.Operation) : null;
                return Results.Ok(new { hasRule, ruleType });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao verificar regra: {ex.Message}" });
            }
        });
    }
}

public class SecurityRuleCheckRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string Operation { get; set; } = string.Empty; // "Exclusão" or "Restauração"
}