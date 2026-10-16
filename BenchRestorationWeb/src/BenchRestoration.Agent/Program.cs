using BenchRestoration.Agent;
using BenchRestoration.Agent.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddSingleton<SqlAgentService>();
builder.Services.AddSingleton<FileAgentService>();
builder.Services.AddSingleton<NetworkAgentService>();
builder.Services.AddHostedService<Worker>();

builder.Services.AddGrpc();

var app = builder.Build();

// Configure gRPC
app.MapGrpcService<AgentGrpcService>();

// Health check endpoint
app.MapGet("/health", () => Results.Ok(new { status = "healthy", timestamp = DateTime.UtcNow }));

app.Run();
