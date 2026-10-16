namespace BenchRestoration.Shared.Models;

public class DeleteHistoryModel
{
    public int Id { get; set; }
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Message { get; set; }
    public DateTime? DeletedAt { get; set; }
    public int? UserId { get; set; }
    public string? UserName { get; set; }
}
