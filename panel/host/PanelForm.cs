using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PcOperatorPanel;

internal sealed class PanelForm : Form
{
    private readonly Uri _adminUri;
    private readonly int _port;
    private readonly string _hostVersion;
    private readonly WindowPrefs _prefs;
    private readonly WebView2 _webView;
    private readonly EventWaitHandle _activateEvent;
    private readonly CancellationTokenSource _cts = new();

    private string _themePreference = "system";
    private bool _effectiveDark;
    private string _backdrop;
    private bool _webViewReady;
    private Rectangle _normalBounds;

    public PanelForm(Uri adminUri, int port, EventWaitHandle activateEvent, string? backdropOverride = null)
    {
        _adminUri = adminUri;
        _port = port;
        _activateEvent = activateEvent;
        _hostVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.6.0";
        _prefs = WindowStateStore.Load();
        _backdrop = !string.IsNullOrWhiteSpace(backdropOverride)
            ? NativeMethods.NormalizeBackdropName(backdropOverride)
            : _prefs.Backdrop;
        _effectiveDark = NativeMethods.IsWindowsDarkTheme();

        Text = "PC-Operator-MCP — Panel de control";
        MinimumSize = new Size(760, 540);
        Size = new Size(_prefs.Width, _prefs.Height);
        BackColor = Color.Black;
        DoubleBuffered = true;
        FormBorderStyle = FormBorderStyle.Sizable;
        KeyPreview = false;

        TryLoadIcon();
        RestoreWindowBounds();

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.Transparent
        };
        Controls.Add(_webView);

        Load += async (_, _) => await InitializeWebViewAsync();
        Activated += (_, _) => PostHostStateToWeb();
        Deactivate += (_, _) => PostHostStateToWeb();
        SizeChanged += (_, _) =>
        {
            if (WindowState == FormWindowState.Normal)
            {
                _normalBounds = Bounds;
            }
            PostHostStateToWeb();
        };
        LocationChanged += (_, _) =>
        {
            if (WindowState == FormWindowState.Normal)
            {
                _normalBounds = Bounds;
            }
        };
        FormClosing += (_, _) =>
        {
            _cts.Cancel();
            PersistWindowState();
        };

        StartActivationListener();
    }

    private void TryLoadIcon()
    {
        try
        {
            var exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (exeIcon != null)
            {
                Icon = exeIcon;
            }
        }
        catch
        {
            // Keep default icon if extraction fails.
        }
    }

    private void RestoreWindowBounds()
    {
        if (_prefs.Left.HasValue && _prefs.Top.HasValue)
        {
            var candidate = new Rectangle(_prefs.Left.Value, _prefs.Top.Value, _prefs.Width, _prefs.Height);
            var screen = Screen.FromRectangle(candidate);
            var area = screen.WorkingArea;
            if (candidate.Right > area.Left + 100 && candidate.Left < area.Right - 100 &&
                candidate.Bottom > area.Top + 80 && candidate.Top < area.Bottom - 80)
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = candidate;
                _normalBounds = candidate;
            }
            else
            {
                StartPosition = FormStartPosition.CenterScreen;
            }
        }
        else
        {
            StartPosition = FormStartPosition.CenterScreen;
        }

        if (_prefs.Maximized)
        {
            WindowState = FormWindowState.Maximized;
        }
    }

    private void PersistWindowState()
    {
        var rect = WindowState == FormWindowState.Normal ? Bounds : _normalBounds;
        if (rect.Width >= 760 && rect.Height >= 540)
        {
            _prefs.Width = rect.Width;
            _prefs.Height = rect.Height;
            _prefs.Left = rect.Left;
            _prefs.Top = rect.Top;
        }
        _prefs.Maximized = WindowState == FormWindowState.Maximized;
        _prefs.Backdrop = _backdrop;
        WindowStateStore.Save(_prefs);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyDwmChrome();
        NativeMethods.SetWindowPos(
            Handle,
            IntPtr.Zero,
            0, 0, 0, 0,
            NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOZORDER |
            NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_FRAMECHANGED);
    }

    private void ApplyDwmChrome()
    {
        if (!IsHandleCreated) return;

        var margins = new NativeMethods.MARGINS { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        NativeMethods.DwmExtendFrameIntoClientArea(Handle, ref margins);

        var dark = _effectiveDark ? 1 : 0;
        NativeMethods.DwmSetWindowAttribute(Handle, NativeMethods.DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));

        var corner = NativeMethods.DWMWCP_ROUND;
        NativeMethods.DwmSetWindowAttribute(Handle, NativeMethods.DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));

        var backdropVal = NativeMethods.BackdropNameToDwmValue(_backdrop);
        var hr = NativeMethods.DwmSetWindowAttribute(Handle, NativeMethods.DWMWA_SYSTEMBACKDROP_TYPE, ref backdropVal, sizeof(int));
        if (hr != 0 && backdropVal != NativeMethods.DWMSBT_NONE)
        {
            var legacyMica = 1;
            NativeMethods.DwmSetWindowAttribute(Handle, NativeMethods.DWMWA_MICA_EFFECT_LEGACY, ref legacyMica, sizeof(int));
        }
    }

    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case NativeMethods.WM_ERASEBKGND:
                if (IsHandleCreated && m.WParam != IntPtr.Zero)
                {
                    NativeMethods.GetClientRect(Handle, out var rect);
                    NativeMethods.FillRect(m.WParam, ref rect, NativeMethods.GetStockObject(NativeMethods.BLACK_BRUSH));
                    m.Result = (IntPtr)1;
                    return;
                }
                break;

            case NativeMethods.WM_NCCALCSIZE:
                if (m.WParam != IntPtr.Zero)
                {
                    var ncc = Marshal.PtrToStructure<NativeMethods.NCCALCSIZE_PARAMS>(m.LParam);
                    var dpi = NativeMethods.GetDpiForWindow(Handle);
                    if (dpi == 0) dpi = 96;
                    var borderX = NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CXFRAME, dpi)
                                  + NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CXPADDEDBORDER, dpi);
                    var borderY = NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CYFRAME, dpi)
                                  + NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CXPADDEDBORDER, dpi);

                    ncc.Rgrc0.Left += borderX;
                    ncc.Rgrc0.Right -= borderX;
                    ncc.Rgrc0.Bottom -= borderY;
                    if (NativeMethods.IsZoomed(Handle))
                    {
                        ncc.Rgrc0.Top += borderY;
                    }

                    Marshal.StructureToPtr(ncc, m.LParam, false);
                    m.Result = IntPtr.Zero;
                    return;
                }
                break;

            case NativeMethods.WM_NCHITTEST:
                base.WndProc(ref m);
                if (m.Result.ToInt32() == NativeMethods.HTCLIENT)
                {
                    var lParam = m.LParam.ToInt64();
                    var screenX = (short)(lParam & 0xFFFF);
                    var screenY = (short)((lParam >> 16) & 0xFFFF);
                    var pt = PointToClient(new Point(screenX, screenY));
                    var dpi = NativeMethods.GetDpiForWindow(Handle);
                    if (dpi == 0) dpi = 96;
                    var scale = dpi / 96.0;
                    var resizeEdge = (int)Math.Round(6 * scale);
                    var titleHeight = (int)Math.Round(40 * scale);

                    if (!NativeMethods.IsZoomed(Handle) && pt.Y < resizeEdge)
                    {
                        if (pt.X < resizeEdge * 2) m.Result = (IntPtr)NativeMethods.HTTOPLEFT;
                        else if (pt.X > ClientSize.Width - resizeEdge * 2) m.Result = (IntPtr)NativeMethods.HTTOPRIGHT;
                        else m.Result = (IntPtr)NativeMethods.HTTOP;
                        return;
                    }

                    if (pt.Y < titleHeight)
                    {
                        m.Result = (IntPtr)NativeMethods.HTCAPTION;
                        return;
                    }
                }
                return;

            case NativeMethods.WM_SETTINGCHANGE:
            case NativeMethods.WM_DWMCOMPOSITIONCHANGED:
                if (_themePreference == "system")
                {
                    var sysDark = NativeMethods.IsWindowsDarkTheme();
                    if (sysDark != _effectiveDark)
                    {
                        _effectiveDark = sysDark;
                        ApplyDwmChrome();
                        PostHostStateToWeb();
                    }
                }
                else
                {
                    ApplyDwmChrome();
                }
                break;
        }

        base.WndProc(ref m);
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var userDataDir = WindowStateStore.GetWebViewUserDataDir();
            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
            await _webView.EnsureCoreWebView2Async(env);

            var core = _webView.CoreWebView2;
            _webView.DefaultBackgroundColor = Color.Transparent;

            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsSwipeNavigationEnabled = false;
            core.Settings.IsNonClientRegionSupportEnabled = true;

            var initPayload = JsonSerializer.Serialize(new
            {
                host = "webview2",
                version = _hostVersion,
                backdrop = _backdrop,
                maximized = WindowState == FormWindowState.Maximized,
                focused = ContainsFocus
            });

            var bootstrapScript = $@"
(function () {{
  window.__PCOP_NATIVE_HOST__ = {initPayload};
  document.documentElement.dataset.nativeHost = 'webview2';
  document.documentElement.dataset.backdrop = {JsonSerializer.Serialize(_backdrop)};
}})();
";
            await core.AddScriptToExecuteOnDocumentCreatedAsync(bootstrapScript);

            core.WebMessageReceived += OnWebMessageReceived;
            core.NewWindowRequested += OnNewWindowRequested;
            core.NavigationStarting += OnNavigationStarting;
            core.DocumentTitleChanged += (_, _) =>
            {
                if (!string.IsNullOrWhiteSpace(core.DocumentTitle))
                {
                    Text = core.DocumentTitle;
                }
            };
            core.NavigationCompleted += (_, _) =>
            {
                _webViewReady = true;
                PostHostStateToWeb();
            };

            core.Navigate(_adminUri.ToString());
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"No se pudo iniciar WebView2 para el panel nativo:\n{ex.Message}",
                "PC-Operator-MCP",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private bool IsLocalAdminUri(string rawUri)
    {
        if (!Uri.TryCreate(rawUri, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttp) return false;
        var host = uri.Host.ToLowerInvariant();
        return (host == "127.0.0.1" || host == "localhost") && uri.Port == _port;
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(e.Uri)) return;
        if (IsLocalAdminUri(e.Uri)) return;

        e.Cancel = true;
        OpenExternalUrl(e.Uri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (!string.IsNullOrWhiteSpace(e.Uri))
        {
            OpenExternalUrl(e.Uri);
        }
    }

    private static void OpenExternalUrl(string rawUrl)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = uri.ToString(),
                UseShellExecute = true
            });
        }
        catch
        {
            // Ignore shell launch error.
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return;
            var type = typeProp.GetString() ?? "";

            switch (type)
            {
                case "window:minimize":
                    WindowState = FormWindowState.Minimized;
                    break;

                case "window:toggleMaximize":
                    WindowState = WindowState == FormWindowState.Maximized
                        ? FormWindowState.Normal
                        : FormWindowState.Maximized;
                    PostHostStateToWeb();
                    break;

                case "window:close":
                    Close();
                    break;

                case "window:drag":
                    NativeMethods.ReleaseCapture();
                    NativeMethods.SendMessage(Handle, NativeMethods.WM_NCLBUTTONDOWN, (IntPtr)NativeMethods.HTCAPTION, IntPtr.Zero);
                    break;

                case "theme:sync":
                    if (root.TryGetProperty("theme", out var prefProp))
                    {
                        _themePreference = (prefProp.GetString() ?? "system").Trim().ToLowerInvariant();
                    }
                    if (root.TryGetProperty("isDark", out var darkProp) &&
                        (darkProp.ValueKind == JsonValueKind.True || darkProp.ValueKind == JsonValueKind.False))
                    {
                        _effectiveDark = darkProp.GetBoolean();
                    }
                    else
                    {
                        _effectiveDark = _themePreference switch
                        {
                            "dark" => true,
                            "light" => false,
                            _ => NativeMethods.IsWindowsDarkTheme()
                        };
                    }
                    ApplyDwmChrome();
                    PostHostStateToWeb();
                    break;

                case "backdrop:set":
                    if (root.TryGetProperty("backdrop", out var bdProp))
                    {
                        _backdrop = NativeMethods.NormalizeBackdropName(bdProp.GetString());
                        _prefs.Backdrop = _backdrop;
                        WindowStateStore.Save(_prefs);
                        ApplyDwmChrome();
                        PostHostStateToWeb();
                    }
                    break;

                case "host:ready":
                    PostHostStateToWeb();
                    break;
            }
        }
        catch
        {
            // Ignore malformed messages from web layer.
        }
    }

    private void PostHostStateToWeb()
    {
        if (!_webViewReady || _webView.CoreWebView2 == null) return;
        try
        {
            var msg = JsonSerializer.Serialize(new
            {
                type = "host:state",
                host = "webview2",
                version = _hostVersion,
                backdrop = _backdrop,
                maximized = WindowState == FormWindowState.Maximized,
                focused = Form.ActiveForm == this,
                isDark = _effectiveDark
            });
            _webView.CoreWebView2.PostWebMessageAsJson(msg);
        }
        catch
        {
            // Ignore races during close.
        }
    }

    private void StartActivationListener()
    {
        var token = _cts.Token;
        Task.Run(() =>
        {
            var handles = new WaitHandle[] { _activateEvent, token.WaitHandle };
            while (!token.IsCancellationRequested)
            {
                var idx = WaitHandle.WaitAny(handles);
                if (idx != 0 || token.IsCancellationRequested) break;
                try
                {
                    if (IsHandleCreated && !IsDisposed)
                    {
                        BeginInvoke(BringToFrontCleanly);
                    }
                }
                catch
                {
                    // Ignore handle disposal races.
                }
            }
        }, token);
    }

    private void BringToFrontCleanly()
    {
        if (WindowState == FormWindowState.Minimized || NativeMethods.IsIconic(Handle))
        {
            NativeMethods.ShowWindow(Handle, NativeMethods.SW_RESTORE);
        }
        else
        {
            NativeMethods.ShowWindow(Handle, NativeMethods.SW_SHOW);
        }
        TopMost = true;
        TopMost = false;
        Activate();
        NativeMethods.SetForegroundWindow(Handle);
    }
}
