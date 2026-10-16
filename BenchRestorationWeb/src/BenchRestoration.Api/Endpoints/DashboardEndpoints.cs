using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/dashboard")
            .WithTags("Dashboard");

        group.MapPost("/metrics", (DashboardRequestDto request, AppDbContext db) =>
        {
            try
            {
                var result = db.GetDashboardMetrics(request.ServerName, request.InstanceName);
                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { message = $"Erro ao carregar dashboard: {ex.Message}" });
            }
        });
    }
}

public class DashboardRequestDto
{
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
}