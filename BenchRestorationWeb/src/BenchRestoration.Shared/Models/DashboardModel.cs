namespace BenchRestoration.Shared.Models;

public class DashboardMetrics
{
    public int TotalRestores { get; set; }
    public int SuccessCount { get; set; }
    public int ErrorCount { get; set; }
    public string SuccessRate { get; set; } = "N/A";
    public string AverageDuration { get; set; } = "N/A";
    public string LastRestoreDate { get; set; } = string.Empty;
}

public class BackupStatusItem
{
    public string DatabaseName { get; set; } = string.Empty;
    public string Size { get; set; } = string.Empty;
    public string LastBackupDate { get; set; } = string.Empty;
    public string Age { get; set; } = string.Empty;
    public string ChainStatus { get; set; } = string.Empty;
}

public class TimelineItem
{
    public string Time { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string Duration { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string StatusColor { get; set; } = "#4CAF50";
}

public class DayMetric
{
    public string Date { get; set; } = string.Empty;
    public int SuccessCount { get; set; }
    public int ErrorCount { get; set; }
}

public class DbDurationMetric
{
    public string DatabaseName { get; set; } = string.Empty;
    public string AverageDuration { get; set; } = string.Empty;
}

public class DashboardResponse
{
    public DashboardMetrics Metrics { get; set; } = new();
    public List<BackupStatusItem> BackupStatus { get; set; } = new();
    public List<TimelineItem> Timeline { get; set; } = new();
    public List<DayMetric> DailyActivity { get; set; } = new();
    public List<DbDurationMetric> DurationByDatabase { get; set; } = new();
}