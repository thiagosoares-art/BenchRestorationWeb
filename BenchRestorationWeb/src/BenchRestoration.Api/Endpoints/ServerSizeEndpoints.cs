using System.Diagnostics;
using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;

namespace BenchRestoration.Api.Endpoints;

public static class ServerSizeEndpoints
{
    public static void MapServerSizeEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/server-size")
            .WithTags("Server Size");

        group.MapPost("/disks", async (ServerSizeRequest request) =>
        {
            var disks = await GetDiskInfoAsync(request.ServerName, request.Username, request.Password);
            return Results.Ok(disks);
        });

        group.MapPost("/shares", async (ServerSizeRequest request) =>
        {
            var shares = await GetShareInfoAsync(request.ServerName, request.Username, request.Password);
            return Results.Ok(shares);
        });
    }

    private static async Task<List<DiskInfoDto>> GetDiskInfoAsync(string serverName, string? username, string? password)
    {
        return await Task.Run(async () =>
        {
            var disks = new List<DiskInfoDto>();
            try
            {
                var psCommand = $"Get-WmiObject Win32_LogicalDisk -ComputerName '{serverName}' -Filter \"DriveType=3\" | Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem | ConvertTo-Json";

                if (!string.IsNullOrEmpty(username))
                {
                    psCommand = $"$pass = ConvertTo-SecureString '{password}' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('{username}', $pass); Get-WmiObject Win32_LogicalDisk -ComputerName '{serverName}' -Credential $cred -Filter \"DriveType=3\" | Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem | ConvertTo-Json";
                }

                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = $"-NoProfile -Command \"{psCommand}\"",
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }
                };

                process.Start();
                var output = await process.StandardOutput.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(output))
                {
                    output = output.Trim();
                    if (output.StartsWith("["))
                    {
                        var items = System.Text.Json.JsonSerializer.Deserialize<List<DiskJsonEntry>>(output);
                        if (items != null)
                        {
                            foreach (var item in items)
                            {
                                disks.Add(new DiskInfoDto
                                {
                                    Name = item.DeviceID ?? "",
                                    VolumeName = item.VolumeName ?? "",
                                    TotalSizeBytes = item.Size,
                                    FreeSpaceBytes = item.FreeSpace,
                                    FileSystem = item.FileSystem ?? "",
                                    DriveType = "Disco Local"
                                });
                            }
                        }
                    }
                    else
                    {
                        var item = System.Text.Json.JsonSerializer.Deserialize<DiskJsonEntry>(output);
                        if (item != null)
                        {
                            disks.Add(new DiskInfoDto
                            {
                                Name = item.DeviceID ?? "",
                                VolumeName = item.VolumeName ?? "",
                                TotalSizeBytes = item.Size,
                                FreeSpaceBytes = item.FreeSpace,
                                FileSystem = item.FileSystem ?? "",
                                DriveType = "Disco Local"
                            });
                        }
                    }
                }
            }
            catch
            {
                // PowerShell failed
            }
            return disks;
        });
    }

    private static async Task<List<ShareInfoDto>> GetShareInfoAsync(string serverName, string? username, string? password)
    {
        return await Task.Run(async () =>
        {
            var shares = new List<ShareInfoDto>();
            try
            {
                var psCommand = $"Get-WmiObject Win32_Share -ComputerName '{serverName}' -Filter \"Type=0\" | Select-Object Name, Path | ConvertTo-Json";

                if (!string.IsNullOrEmpty(username))
                {
                    psCommand = $"$pass = ConvertTo-SecureString '{password}' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('{username}', $pass); Get-WmiObject Win32_Share -ComputerName '{serverName}' -Credential $cred -Filter \"Type=0\" | Select-Object Name, Path | ConvertTo-Json";
                }

                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = $"-NoProfile -Command \"{psCommand}\"",
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }
                };

                process.Start();
                var output = await process.StandardOutput.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0 && !string.IsNullOrWhiteSpace(output))
                {
                    output = output.Trim();
                    if (output.StartsWith("["))
                    {
                        var items = System.Text.Json.JsonSerializer.Deserialize<List<ShareJsonEntry>>(output);
                        if (items != null)
                        {
                            foreach (var item in items)
                            {
                                shares.Add(new ShareInfoDto
                                {
                                    Name = item.Name ?? "",
                                    Path = item.Path ?? ""
                                });
                            }
                        }
                    }
                    else
                    {
                        var item = System.Text.Json.JsonSerializer.Deserialize<ShareJsonEntry>(output);
                        if (item != null)
                        {
                            shares.Add(new ShareInfoDto
                            {
                                Name = item.Name ?? "",
                                Path = item.Path ?? ""
                            });
                        }
                    }
                }
            }
            catch
            {
                // PowerShell failed
            }
            return shares;
        });
    }

    private class DiskJsonEntry
    {
        public string? DeviceID { get; set; }
        public string? VolumeName { get; set; }
        public long Size { get; set; }
        public long FreeSpace { get; set; }
        public string? FileSystem { get; set; }
    }

    private class ShareJsonEntry
    {
        public string? Name { get; set; }
        public string? Path { get; set; }
    }
}

public class ServerSizeRequest
{
    public string ServerName { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? Password { get; set; }
}

public class DiskInfoDto
{
    public string Name { get; set; } = string.Empty;
    public string VolumeName { get; set; } = string.Empty;
    public long TotalSizeBytes { get; set; }
    public long FreeSpaceBytes { get; set; }
    public long UsedSpaceBytes => TotalSizeBytes - FreeSpaceBytes;
    public string FileSystem { get; set; } = string.Empty;
    public string DriveType { get; set; } = string.Empty;
    public double UsedPercent => TotalSizeBytes > 0 ? (double)UsedSpaceBytes / TotalSizeBytes * 100 : 0;
    public double TotalSizeGB => TotalSizeBytes / (1024.0 * 1024 * 1024);
    public double FreeSpaceGB => FreeSpaceBytes / (1024.0 * 1024 * 1024);
    public double UsedSpaceGB => UsedSpaceBytes / (1024.0 * 1024 * 1024);
}

public class ShareInfoDto
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
}