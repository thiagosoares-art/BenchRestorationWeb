namespace BenchRestoration.Shared.Models;

public class SecurityRuleModel
{
    public int Id { get; set; }
    public string ServerName { get; set; } = string.Empty;
    public string InstanceName { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = string.Empty;
    public string RuleType { get; set; } = string.Empty;
    public string CreatedAt { get; set; } = string.Empty;
}