namespace BenchRestoration.Shared.Models;

public class PostRestoreScriptModel
{
    public int Id { get; set; }
    public string DatabaseName { get; set; } = string.Empty;
    public string ScriptPath { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}