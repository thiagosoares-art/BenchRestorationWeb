using System.Collections.Concurrent;

namespace BenchRestoration.Api.Data;

public class FailedLoginTracker
{
    private record FailedAttempts(int Count, DateTime FirstFailure);

    private static readonly ConcurrentDictionary<string, FailedAttempts> _attempts = new();

    private const int MaxAttempts = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan BlockDuration = TimeSpan.FromMinutes(15);

    public bool IsBlocked(string username)
    {
        if (_attempts.TryGetValue(username, out var entry))
        {
            if (entry.Count >= MaxAttempts)
            {
                if (DateTime.UtcNow - entry.FirstFailure < BlockDuration + Window)
                    return true;
                _attempts.TryRemove(username, out _);
            }
            else if (DateTime.UtcNow - entry.FirstFailure > Window)
            {
                _attempts.TryRemove(username, out _);
            }
        }
        return false;
    }

    public void RecordFailure(string username)
    {
        _attempts.AddOrUpdate(username,
            _ => new FailedAttempts(1, DateTime.UtcNow),
            (_, existing) =>
            {
                if (DateTime.UtcNow - existing.FirstFailure > Window)
                    return new FailedAttempts(1, DateTime.UtcNow);
                return new FailedAttempts(existing.Count + 1, existing.FirstFailure);
            });
    }

    public void Reset(string username)
    {
        _attempts.TryRemove(username, out _);
    }
}
