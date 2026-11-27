using System.Text.Json;

namespace PcOperatorPanel;

internal sealed class WindowPrefs
{
    public int Width { get; set; } = 1180;
    public int Height { get; set; } = 780;
    public int? Left { get; set; }
    public int? Top { get; set; }
    public bool Maximized { get; set; }
    public string Backdrop { get; set; } = "mica";
}

internal static class WindowStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string GetAppDataDir()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PC-Operator-MCP");
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static string GetPrefsFilePath() => Path.Combine(GetAppDataDir(), "panel-window.json");

    public static string GetWebViewUserDataDir()
    {
        var dir = Path.Combine(GetAppDataDir(), "WebView2Profile");
        Directory.CreateDirectory(dir);
        return dir;
    }

    public static WindowPrefs Load()
    {
        try
        {
            var file = GetPrefsFilePath();
            if (File.Exists(file))
            {
                var raw = File.ReadAllText(file);
                var parsed = JsonSerializer.Deserialize<WindowPrefs>(raw, JsonOptions);
                if (parsed != null)
                {
                    parsed.Width = Math.Clamp(parsed.Width, 760, 3840);
                    parsed.Height = Math.Clamp(parsed.Height, 540, 2160);
                    parsed.Backdrop = NativeMethods.NormalizeBackdropName(parsed.Backdrop);
                    return parsed;
                }
            }
        }
        catch
        {
            // Ignore malformed prefs file.
        }
        return new WindowPrefs();
    }

    public static void Save(WindowPrefs prefs)
    {
        try
        {
            var file = GetPrefsFilePath();
            var tmp = file + ".tmp";
            var json = JsonSerializer.Serialize(prefs, JsonOptions);
            File.WriteAllText(tmp, json);
            File.Move(tmp, file, overwrite: true);
        }
        catch
        {
            // Best-effort persistence.
        }
    }
}
