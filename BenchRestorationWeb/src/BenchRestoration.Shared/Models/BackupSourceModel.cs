namespace BenchRestoration.Shared.Models;

public class BackupSourceModel
{
    public int Id { get; set; }
    public string SharePath { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
}
