using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace BenchRestoration.Agent.Services;

public class NetworkAgentService
{
    [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int WNetUseConnection(
        nint hwndOwner,
        ref NETRESOURCE lpNetResource,
        string lpPassword,
        string lpUserId,
        int dwFlags,
        nint lpAccessName,
        nint lpBufferSize,
        nint lpResult
    );

    [DllImport("mpr.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int WNetCancelConnection2(
        string lpName,
        int dwFlags,
        bool fForce
    );

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NETRESOURCE
    {
        public int dwScope;
        public int dwType;
        public int dwDisplayType;
        public int dwUsage;
        public string lpLocalName;
        public string lpRemoteName;
        public string lpComment;
        public string lpProvider;
    }

    private const int RESOURCETYPE_DISK = 1;
    private const int CONNECT_TEMPORARY = 4;

    public bool ConnectToUNCPath(string path, string username, string password)
    {
        if (string.IsNullOrEmpty(path))
            return false;

        try
        {
            var parts = username.Split('\\');
            var domain = parts.Length > 1 ? parts[0] : "";
            var user = parts.Length > 1 ? parts[1] : username;

            var netResource = new NETRESOURCE
            {
                dwType = RESOURCETYPE_DISK,
                lpRemoteName = path
            };

            var result = WNetUseConnection(
                nint.Zero,
                ref netResource,
                password,
                $"{domain}\\{user}",
                CONNECT_TEMPORARY,
                nint.Zero,
                nint.Zero,
                nint.Zero);

            if (result == 0)
                return true;

            var alreadyConnected = Directory.Exists(path);
            return alreadyConnected;
        }
        catch
        {
            try
            {
                return Directory.Exists(path);
            }
            catch
            {
                return false;
            }
        }
    }

    public void DisconnectUNCPath(string path)
    {
        try
        {
            WNetCancelConnection2(path, CONNECT_TEMPORARY, true);
        }
        catch { }
    }

    public List<string> GetAllUniqueRoots(List<string> paths)
    {
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var path in paths)
        {
            if (path.StartsWith(@"\\"))
            {
                var parts = path.Split('\\', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2)
                {
                    roots.Add($"\\\\{parts[0]}\\{parts[1]}");
                }
            }
        }

        return roots.ToList();
    }
}
