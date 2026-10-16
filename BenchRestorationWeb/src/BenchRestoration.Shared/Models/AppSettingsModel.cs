namespace BenchRestoration.Shared.Models;

public class AppSettingsModel
{
    public string? BackupDestination { get; set; }
    public string? DefaultRestoreBasePath { get; set; }
    public string? AzureDevOpsToken { get; set; }
    public string? AzureDevOpsUrl { get; set; }
    public int AzureReleaseDefinitionId { get; set; }
    public string? NotificationApiUrl { get; set; }
    public string? SqlUsername { get; set; }
    public string? SqlPassword { get; set; }
    public string? NetworkUsername { get; set; }
    public string? NetworkPassword { get; set; }
    public bool DefaultIncludeLogDatabase { get; set; }
    public bool ShowDiffDateRestore { get; set; }
    public string? ScriptsRestoreBasePath { get; set; }
    public bool HideSelectAllInDelete { get; set; }
    public string? DeleteExceptionDatabases { get; set; }
    public string? RestoreExceptionDatabases { get; set; }
    public int MaxConcurrentRestores { get; set; } = 3;
    public string? Theme { get; set; }
}
