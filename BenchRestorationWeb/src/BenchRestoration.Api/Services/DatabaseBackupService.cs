namespace BenchRestoration.Api.Services;

public class DatabaseBackupService : BackgroundService
{
    private static readonly string DbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data", "BenchRestoration.db");
    private static readonly string BackupDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data", "Backups");
    private static readonly TimeSpan Interval = TimeSpan.FromHours(12);
    private const int MaxBackups = 48;

    public DatabaseBackupService()
    {
        try { Directory.CreateDirectory(BackupDir); } catch { }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { DoBackup(); CleanOldBackups(); } catch { }
            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    public static string DoBackup()
    {
        if (!File.Exists(DbPath)) throw new FileNotFoundException("Banco de dados não encontrado.", DbPath);
        var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var backupPath = Path.Combine(BackupDir, $"BenchRestoration_{timestamp}.db");
        File.Copy(DbPath, backupPath, overwrite: false);
        return backupPath;
    }

    public static void CleanOldBackups()
    {
        var files = Directory.GetFiles(BackupDir, "BenchRestoration_*.db").OrderByDescending(f => f).Skip(MaxBackups);
        foreach (var file in files) try { File.Delete(file); } catch { }
    }
}
