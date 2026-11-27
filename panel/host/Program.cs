using Microsoft.Web.WebView2.Core;

namespace PcOperatorPanel;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var host = "127.0.0.1";
        var port = 3333;
        string? explicitUrl = null;
        string? backdrop = null;

        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (a == "--host" && i + 1 < args.Length) host = args[++i];
            else if (a == "--port" && i + 1 < args.Length && int.TryParse(args[++i], out var p) && p > 0) port = p;
            else if (a == "--url" && i + 1 < args.Length) explicitUrl = args[++i];
            else if (a == "--backdrop" && i + 1 < args.Length) backdrop = args[++i];
        }

        Uri targetUri;
        if (!string.IsNullOrWhiteSpace(explicitUrl) && Uri.TryCreate(explicitUrl, UriKind.Absolute, out var parsedUri))
        {
            targetUri = parsedUri;
            port = parsedUri.Port > 0 ? parsedUri.Port : port;
        }
        else
        {
            targetUri = new Uri($"http://{host}:{port}/admin");
        }

        // Verify WebView2 Runtime availability before creating any window so callers can fall back cleanly.
        try
        {
            var runtimeVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrWhiteSpace(runtimeVersion))
            {
                return 42;
            }
        }
        catch
        {
            return 42;
        }

        var mutexName = $"Local\\PcOperatorMcpPanel_{port}";
        var activateName = $"Local\\PcOperatorMcpPanelActivate_{port}";

        using var activateEvent = new EventWaitHandle(false, EventResetMode.AutoReset, activateName);
        using var mutex = new Mutex(true, mutexName, out var createdNew);
        if (!createdNew)
        {
            try { activateEvent.Set(); } catch { }
            return 0;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new PanelForm(targetUri, port, activateEvent, backdrop));
        return 0;
    }
}
