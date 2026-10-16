using System.Text.Json;
using System.Text.Json.Serialization;
using FluentValidation;
using BenchRestoration.Api.Data;
using BenchRestoration.Api.Hubs;
using BenchRestoration.Api.Endpoints;
using BenchRestoration.Api.Services;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Logs", "api-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 30)
    .CreateLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Host.UseSerilog();
    builder.Host.UseWindowsService(options =>
    {
        options.ServiceName = "BenchRestorationApi";
    });
    builder.Services.Configure<HostOptions>(options =>
    {
        options.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore;
    });

    builder.Services.AddSignalR();
    builder.Services.AddSingleton<AppDbContext>();
    builder.Services.AddSingleton<FailedLoginTracker>();
    builder.Services.AddHostedService<DatabaseBackupService>();
    builder.Services.AddValidatorsFromAssemblyContaining<Program>();

    builder.Services.AddAuthentication(Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationDefaults.AuthenticationScheme)
        .AddCookie(options =>
        {
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = 401;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = 403;
                return Task.CompletedTask;
            };
        });

    builder.Services.AddAuthorization();

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("LocalNetwork", policy =>
        {
            policy.SetIsOriginAllowed(origin =>
                {
                    if (Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                    {
                        return uri.Host == "localhost" ||
                               uri.Host == "127.0.0.1" ||
                               uri.Host.StartsWith("192.168.") ||
                               uri.Host.StartsWith("10.") ||
                               uri.Host.StartsWith("172.16.");
                    }
                    return false;
                })
                .AllowAnyMethod()
                .AllowAnyHeader()
                .AllowCredentials();
        });
    });

    builder.Services.AddResponseCompression();

    builder.Services.ConfigureHttpJsonOptions(options =>
    {
        options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

    var app = builder.Build();

    app.UseExceptionHandler(exceptionHandlerApp =>
    {
        exceptionHandlerApp.Run(async context =>
        {
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json";
            var error = new { message = "Erro interno do servidor. Tente novamente mais tarde." };
            await context.Response.WriteAsJsonAsync(error);
        });
    });

    app.UseSerilogRequestLogging();
    app.UseResponseCompression();
    app.UseCors("LocalNetwork");
    app.UseAuthentication();
    app.UseAuthorization();

    app.MapHub<RestoreHub>("/hubs/restore");

    app.MapServerEndpoints();
    app.MapInstanceEndpoints();
    app.MapSettingsEndpoints();
    app.MapBackupEndpoints();
    app.MapHistoryEndpoints();
    app.MapDeleteEndpoints();
    app.MapRestoreEndpoints();
    app.MapTestEndpoints();
    app.MapServerSizeEndpoints();
    app.MapQueueEndpoints();
    app.MapDashboardEndpoints();
    app.MapSecurityRulesEndpoints();
    app.MapPostRestoreScriptsEndpoints();
    app.MapAuthEndpoints();

    using (var scope = app.Services.CreateScope())
    {
        scope.ServiceProvider.GetRequiredService<AppDbContext>();
    }

    app.MapGet("/health", () => Results.Ok(new
    {
        status = "healthy",
        timestamp = DateTime.UtcNow,
        version = "2.0.0"
    }));

    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");

    Log.Information("Server starting on http://0.0.0.0:5263");
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}
