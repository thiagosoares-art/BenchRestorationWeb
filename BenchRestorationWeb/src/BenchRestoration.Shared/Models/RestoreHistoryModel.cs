namespace BenchRestoration.Shared.Models;

public enum RestoreStatus
{
    EmAndamento,
    Sucesso,
    Erro,
    Cancelado
}

public class RestoreHistoryModel
{
    public int Id { get; set; }
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string? BackupFile { get; set; }
    public string? RestorePath { get; set; }
    public RestoreStatus Status { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? Duration { get; set; }
    public string? ErrorMessage { get; set; }
    public bool TriggeredAzure { get; set; }
    public string? AzureReleaseId { get; set; }
    public string? AzureStatus { get; set; }
    public string? PostCheck { get; set; }
    public int? UserId { get; set; }
    public string? UserName { get; set; }
}
