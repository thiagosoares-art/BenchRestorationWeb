namespace BenchRestoration.Shared.Models;

public class InstanceModel
{
    public int Id { get; set; }
    public int ServerId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string AuthType { get; set; } = "Windows";
    public string? Username { get; set; }
    public string? PasswordEnc { get; set; }
    public string? RestorePath { get; set; }
    public int AzureReleaseDefinitionId { get; set; }
}
