using Microsoft.AspNetCore.SignalR;

namespace BenchRestoration.Api.Hubs;

public class RestoreHub : Hub
{
    public async Task SendStatusUpdate(string message, string color)
    {
        await Clients.All.SendAsync("StatusUpdate", new { message, color });
    }

    public async Task SendRestoreProgress(string databaseName, int percentage, string status)
    {
        await Clients.All.SendAsync("RestoreProgress", new { databaseName, percentage, status });
    }

    public async Task SendRestoreComplete(int historyId, bool success, string databaseName)
    {
        await Clients.All.SendAsync("RestoreComplete", new { historyId, success, databaseName });
    }
}
