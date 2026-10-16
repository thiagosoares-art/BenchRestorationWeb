using System.Runtime.InteropServices;

namespace BenchRestoration.Agent;

public class Worker(ILogger<Worker> logger) : BackgroundService
{
    private long _requestCount;
    private DateTime _startTime = DateTime.UtcNow;

    public long RequestCount => Interlocked.Read(ref _requestCount);

    public void IncrementRequestCount()
    {
        Interlocked.Increment(ref _requestCount);
    }

    public TimeSpan Uptime => DateTime.UtcNow - _startTime;

    public object GetHealthReport()
    {
        return new
        {
            uptime = Uptime.ToString(@"hh\:mm\:ss"),
            requests = RequestCount,
            startTime = _startTime,
            memoryMB = Environment.WorkingSet / 1024 / 1024,
            os = RuntimeInformation.OSDescription,
            processId = Environment.ProcessId
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Agent started at: {time}", DateTimeOffset.Now);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                logger.LogInformation(
                    "Agent health - Uptime: {uptime}, Requests: {count}, Memory: {memory}MB",
                    Uptime.ToString(@"hh\:mm\:ss"),
                    RequestCount,
                    Environment.WorkingSet / 1024 / 1024);

                await Task.Delay(30000, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error in health check loop");
                await Task.Delay(10000, stoppingToken);
            }
        }

        logger.LogInformation("Agent stopped after: {uptime}", Uptime.ToString(@"hh\:mm\:ss"));
    }
}
