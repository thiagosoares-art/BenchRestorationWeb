namespace BenchRestoration.Shared.Models;

public class ServerModel
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? BackupPath { get; set; }
    public string? RestorePath { get; set; }
}
