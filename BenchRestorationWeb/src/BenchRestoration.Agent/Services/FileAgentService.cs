namespace BenchRestoration.Agent.Services;

public class FileAgentService
{
    public List<string> SearchBackups(string databaseName, List<string> backupSources, string? networkUsername, string? networkPassword)
    {
        var results = new List<string>();

        foreach (var source in backupSources)
        {
            try
            {
                if (Directory.Exists(source))
                {
                    var files = SearchBackupsRecursive(source, databaseName);
                    results.AddRange(files);
                }
            }
            catch { }
        }

        return results.OrderByDescending(f => new FileInfo(f).LastWriteTime).ToList();
    }

    private List<string> SearchBackupsRecursive(string basePath, string databaseName)
    {
        var results = new List<string>();

        try
        {
            var subdirs = Directory.GetDirectories(basePath);

            foreach (var subdir in subdirs)
            {
                var dirName = Path.GetFileName(subdir);

                if (dirName.Equals(databaseName, StringComparison.OrdinalIgnoreCase))
                {
                    var bakFiles = GetBackupFiles(subdir);
                    results.AddRange(bakFiles);
                    continue;
                }

                var subSubdirs = Directory.GetDirectories(subdir);
                foreach (var subSubdir in subSubdirs)
                {
                    var subDirName = Path.GetFileName(subSubdir);
                    if (subDirName.Equals(databaseName, StringComparison.OrdinalIgnoreCase))
                    {
                        var bakFiles = GetBackupFiles(subSubdir);
                        results.AddRange(bakFiles);
                    }
                }
            }

            if (results.Count == 0)
            {
                var allBak = Directory.GetFiles(basePath, "*.bak", SearchOption.AllDirectories);
                results.AddRange(allBak.Where(f =>
                {
                    var fileName = Path.GetFileName(f);
                    return fileName.Contains(databaseName, StringComparison.OrdinalIgnoreCase)
                        && !fileName.Contains(databaseName + "_LOG", StringComparison.OrdinalIgnoreCase);
                }));
            }
        }
        catch { }

        return results;
    }

    private List<string> GetBackupFiles(string databaseFolder)
    {
        var results = new List<string>();

        var fullFolder = Path.Combine(databaseFolder, "FULL");
        if (Directory.Exists(fullFolder))
        {
            results.AddRange(Directory.GetFiles(fullFolder, "*.bak", SearchOption.TopDirectoryOnly));
        }

        var diffFolder = Path.Combine(databaseFolder, "DIFF");
        if (Directory.Exists(diffFolder))
        {
            results.AddRange(Directory.GetFiles(diffFolder, "*.bak", SearchOption.TopDirectoryOnly));
        }

        if (results.Count > 0)
            return results;

        var allBak = Directory.GetFiles(databaseFolder, "*.bak", SearchOption.AllDirectories).ToList();
        var filtered = allBak.Where(f =>
        {
            var fileName = Path.GetFileName(f);
            return fileName.Contains("_FULL_", StringComparison.OrdinalIgnoreCase)
                || fileName.Contains("_DIFF_", StringComparison.OrdinalIgnoreCase);
        }).ToList();

        return filtered.Count > 0 ? filtered : allBak;
    }

    public string ProbeServerDrive(string serverName)
    {
        string[] drives = ["D", "E", "F", "G", "H"];
        foreach (var drive in drives)
        {
            try
            {
                var backupPath = $@"\\{serverName}\{drive}$\Backups";
                if (!Directory.Exists(backupPath))
                    Directory.CreateDirectory(backupPath);
                return drive;
            }
            catch { }
        }
        return "D";
    }

    public async Task<string?> CopyFileAsync(string sourcePath, string destinationPath, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!File.Exists(sourcePath))
                return null;

            var destDir = Path.GetDirectoryName(destinationPath);
            if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
            {
                Directory.CreateDirectory(destDir);
            }

            await using var sourceStream = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
            await using var destStream = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
            await sourceStream.CopyToAsync(destStream, cancellationToken);

            return destinationPath;
        }
        catch
        {
            return null;
        }
    }

    public void DeleteFile(string filePath)
    {
        try
        {
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
        catch { }
    }
}
