using System.Security.Cryptography;
using System.Text;

namespace BenchRestoration.Api.Security;

public static class PasswordEncryption
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("BenchRestoration_v2.0");

    public static string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText))
            return plainText;

        try
        {
            var plainBytes = Encoding.UTF8.GetBytes(plainText);
            var encryptedBytes = ProtectedData.Protect(plainBytes, Entropy, DataProtectionScope.LocalMachine);
            return Convert.ToBase64String(encryptedBytes);
        }
        catch
        {
            return plainText;
        }
    }

    public static string Decrypt(string encryptedText)
    {
        if (string.IsNullOrEmpty(encryptedText))
            return encryptedText;

        try
        {
            var encryptedBytes = Convert.FromBase64String(encryptedText);
            var plainBytes = ProtectedData.Unprotect(encryptedBytes, Entropy, DataProtectionScope.LocalMachine);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch
        {
            return encryptedText;
        }
    }
}
