namespace BenchRestoration.Shared.Models;

public class DatabaseModel
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? BackupFilePath { get; set; }
    public long SizeKB { get; set; }
    public DateTime? LastBackupDate { get; set; }
    public string? BackupType { get; set; }
    public bool IsSelected { get; set; }
    public bool IsDifferential => Name.Contains("_DIFF_", StringComparison.OrdinalIgnoreCase);
}
