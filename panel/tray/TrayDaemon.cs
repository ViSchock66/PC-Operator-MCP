using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PcOperatorTray
{
    internal static class NativeMethods
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool DestroyIcon(IntPtr hIcon);

        public const int SW_RESTORE = 9;
        public const int SW_SHOW = 5;
    }

    internal sealed class DarkColorTable : ProfessionalColorTable
    {
        private static readonly Color Bg = Color.FromArgb(18, 21, 28);
        private static readonly Color Border = Color.FromArgb(42, 50, 68);
        private static readonly Color Hover = Color.FromArgb(30, 36, 48);

        public override Color MenuBorder { get { return Border; } }
        public override Color MenuItemBorder { get { return Border; } }
        public override Color MenuItemSelected { get { return Hover; } }
        public override Color MenuStripGradientBegin { get { return Bg; } }
        public override Color MenuStripGradientEnd { get { return Bg; } }
        public override Color ToolStripDropDownBackground { get { return Bg; } }
        public override Color ImageMarginGradientBegin { get { return Bg; } }
        public override Color ImageMarginGradientMiddle { get { return Bg; } }
        public override Color ImageMarginGradientEnd { get { return Bg; } }
        public override Color SeparatorDark { get { return Border; } }
        public override Color SeparatorLight { get { return Border; } }
    }

    internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColorTable())
        {
            this.RoundedEdges = false;
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (e.Item is ToolStripSeparator)
            {
                base.OnRenderItemText(e);
                return;
            }
            if (!e.Item.Enabled)
            {
                e.TextColor = Color.FromArgb(148, 163, 184);
            }
            else if (e.Item.Tag as string == "danger")
            {
                e.TextColor = Color.FromArgb(252, 165, 165);
            }
            else if (e.Item.Selected)
            {
                e.TextColor = Color.FromArgb(255, 255, 255);
            }
            else
            {
                e.TextColor = Color.FromArgb(228, 228, 231);
            }
            base.OnRenderItemText(e);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            int y = e.Item.Height / 2;
            using (Pen pen = new Pen(Color.FromArgb(35, 40, 52)))
            {
                e.Graphics.DrawLine(pen, 8, y, e.Item.Width - 8, y);
            }
        }
    }

    internal sealed class TraySnapshot
    {
        public string Status = "starting";
        public string Mode = "tailscale";
        public string McpUrl = "";
        public string GeminiMcpUrl = "";
        public string AdminUrl = "";
        public string Pin = "";
        public int ActiveSessions = 0;
        public int RunningDaemons = 0;
        public string OperatorStatus = "standby";
        public string LastError = "";
        public bool Connected = false;
    }

    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly string _host;
        private readonly int _port;
        private readonly int _parentPid;
        private readonly string _token;
        private readonly NotifyIcon _notifyIcon;
        private readonly ContextMenuStrip _menu;
        private readonly ToolStripMenuItem _headerItem;
        private readonly ToolStripMenuItem _openItem;
        private readonly ToolStripMenuItem _copyMcpItem;
        private readonly ToolStripMenuItem _copyGeminiItem;
        private readonly ToolStripMenuItem _copyPinItem;
        private readonly ToolStripMenuItem _restartTunnelItem;
        private readonly ToolStripMenuItem _toggleTunnelItem;
        private readonly ToolStripMenuItem _shutdownItem;
        private readonly System.Windows.Forms.Timer _pollTimer;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();

        private TraySnapshot _current = new TraySnapshot();
        private string _lastVisualKey = "";
        private IntPtr _currentHIcon = IntPtr.Zero;
        private int _polling = 0;
        private bool _exiting = false;

        public TrayApplicationContext(string host, int port, int parentPid, string token)
        {
            _host = host;
            _port = port;
            _parentPid = parentPid;
            _token = token;

            _menu = new ContextMenuStrip();
            _menu.Renderer = new DarkMenuRenderer();
            _menu.ShowImageMargin = false;
            _menu.BackColor = Color.FromArgb(18, 21, 28);
            _menu.ForeColor = Color.FromArgb(244, 244, 245);
            _menu.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            _headerItem = new ToolStripMenuItem("PC Operator MCP — Iniciando...");
            _headerItem.Enabled = false;

            _openItem = new ToolStripMenuItem("Abrir Panel de Control");
            _openItem.Font = new Font(_menu.Font, FontStyle.Bold);
            _openItem.Click += delegate { OpenOrFocusPanel(); };

            _copyMcpItem = new ToolStripMenuItem("Copiar URL MCP");
            _copyMcpItem.Click += delegate { CopyToClipboard(_current.McpUrl); };

            _copyGeminiItem = new ToolStripMenuItem("Copiar URL Gemini (/mcp/gemini)");
            _copyGeminiItem.Click += delegate { CopyToClipboard(_current.GeminiMcpUrl); };

            _copyPinItem = new ToolStripMenuItem("Copiar PIN OAuth");
            _copyPinItem.Click += delegate { CopyToClipboard(_current.Pin); };

            _restartTunnelItem = new ToolStripMenuItem("Reiniciar Túnel");
            _restartTunnelItem.Click += delegate { TriggerTunnelAction("/internal/tray/tunnel/restart"); };

            _toggleTunnelItem = new ToolStripMenuItem("Detener Túnel");
            _toggleTunnelItem.Click += delegate
            {
                string ep = string.Equals(_current.Status, "stopped", StringComparison.OrdinalIgnoreCase)
                    ? "/internal/tray/tunnel/start"
                    : "/internal/tray/tunnel/stop";
                TriggerTunnelAction(ep);
            };

            _shutdownItem = new ToolStripMenuItem("Apagar Daemon y Salir");
            _shutdownItem.Tag = "danger";
            _shutdownItem.Click += delegate { ShutdownDaemonAndExit(); };

            _menu.Items.AddRange(new ToolStripItem[]
            {
                _headerItem,
                new ToolStripSeparator(),
                _openItem,
                new ToolStripSeparator(),
                _copyMcpItem,
                _copyGeminiItem,
                _copyPinItem,
                new ToolStripSeparator(),
                _restartTunnelItem,
                _toggleTunnelItem,
                new ToolStripSeparator(),
                _shutdownItem
            });

            _notifyIcon = new NotifyIcon();
            _notifyIcon.ContextMenuStrip = _menu;
            _notifyIcon.Text = "PC Operator MCP — Iniciando...";
            _notifyIcon.MouseClick += delegate(object sender, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left)
                {
                    OpenOrFocusPanel();
                }
            };
            _notifyIcon.DoubleClick += delegate { OpenOrFocusPanel(); };

            ApplySnapshot(_current);
            _notifyIcon.Visible = true;

            _pollTimer = new System.Windows.Forms.Timer();
            _pollTimer.Interval = 2000;
            _pollTimer.Tick += delegate { OnTick(); };
            _pollTimer.Start();

            OnTick();
        }

        private void OnTick()
        {
            if (_exiting) return;

            if (_parentPid > 0 && !IsProcessAlive(_parentPid))
            {
                CleanExit();
                return;
            }

            if (Interlocked.CompareExchange(ref _polling, 1, 0) != 0)
            {
                return;
            }

            ThreadPool.QueueUserWorkItem(delegate
            {
                TraySnapshot next = FetchSnapshot();
                try
                {
                    if (!_exiting)
                    {
                        _menu.BeginInvoke((MethodInvoker)delegate
                        {
                            if (!_exiting) ApplySnapshot(next);
                        });
                    }
                }
                catch
                {
                    // Ignore handle race during shutdown.
                }
                finally
                {
                    Interlocked.Exchange(ref _polling, 0);
                }
            });
        }

        private static bool IsProcessAlive(int pid)
        {
            try
            {
                using (Process p = Process.GetProcessById(pid))
                {
                    return !p.HasExited;
                }
            }
            catch
            {
                return false;
            }
        }

        private TraySnapshot FetchSnapshot()
        {
            TraySnapshot snap = new TraySnapshot();
            string url = string.Format("http://{0}:{1}/internal/tray/status", _host, _port);
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 1500;
                req.ReadWriteTimeout = 1500;
                if (!string.IsNullOrEmpty(_token))
                {
                    req.Headers["x-tray-token"] = _token;
                }
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (Stream stream = res.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    string raw = reader.ReadToEnd();
                    Dictionary<string, object> obj = _json.Deserialize<Dictionary<string, object>>(raw);
                    if (obj != null)
                    {
                        snap.Connected = true;
                        snap.Status = GetStr(obj, "status", "stopped");
                        snap.Mode = GetStr(obj, "mode", "tailscale");
                        snap.McpUrl = GetStr(obj, "mcpUrl", "");
                        snap.GeminiMcpUrl = GetStr(obj, "geminiMcpUrl", "");
                        snap.AdminUrl = GetStr(obj, "adminUrl", string.Format("http://{0}:{1}/admin", _host, _port));
                        snap.Pin = GetStr(obj, "pin", "");
                        snap.OperatorStatus = GetStr(obj, "operatorStatus", "standby");
                        snap.LastError = GetStr(obj, "lastError", "");
                        snap.ActiveSessions = GetInt(obj, "activeSessions", 0);
                        snap.RunningDaemons = GetInt(obj, "runningDaemons", 0);
                    }
                }
            }
            catch
            {
                snap.Connected = false;
                snap.Status = "error";
                snap.AdminUrl = string.Format("http://{0}:{1}/admin", _host, _port);
            }
            return snap;
        }

        private static string GetStr(Dictionary<string, object> d, string key, string fallback)
        {
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToString(val);
            }
            return fallback;
        }

        private static int GetInt(Dictionary<string, object> d, string key, int fallback)
        {
            object val;
            if (d.TryGetValue(key, out val) && val != null)
            {
                int parsed;
                if (int.TryParse(Convert.ToString(val), out parsed)) return parsed;
            }
            return fallback;
        }

        private void ApplySnapshot(TraySnapshot s)
        {
            _current = s;

            string visualState = "amber";
            string statusLabel = "INICIANDO";
            if (!s.Connected)
            {
                visualState = "amber";
                statusLabel = "CONECTANDO";
            }
            else if (string.Equals(s.Status, "running", StringComparison.OrdinalIgnoreCase))
            {
                visualState = string.Equals(s.Mode, "local", StringComparison.OrdinalIgnoreCase) ? "amber" : "green";
                statusLabel = string.Equals(s.Mode, "local", StringComparison.OrdinalIgnoreCase) ? "LOCAL" : "ACTIVO";
            }
            else if (string.Equals(s.Status, "error", StringComparison.OrdinalIgnoreCase))
            {
                visualState = "red";
                statusLabel = "ERROR";
            }
            else if (string.Equals(s.Status, "needs_action", StringComparison.OrdinalIgnoreCase))
            {
                visualState = "amber";
                statusLabel = "ACCIÓN";
            }
            else if (string.Equals(s.Status, "stopped", StringComparison.OrdinalIgnoreCase))
            {
                visualState = "amber";
                statusLabel = "SIN TÚNEL";
            }

            if (_lastVisualKey != visualState)
            {
                _lastVisualKey = visualState;
                UpdateTrayIcon(visualState);
            }

            string modeName = FormatMode(s.Mode);
            _headerItem.Text = string.Format("PC Operator MCP · {0} ({1})", statusLabel, modeName);

            _copyMcpItem.Enabled = !string.IsNullOrEmpty(s.McpUrl);
            _copyGeminiItem.Enabled = !string.IsNullOrEmpty(s.GeminiMcpUrl);
            _copyPinItem.Enabled = !string.IsNullOrEmpty(s.Pin);
            _toggleTunnelItem.Text = string.Equals(s.Status, "stopped", StringComparison.OrdinalIgnoreCase)
                ? "Iniciar Túnel"
                : "Detener Túnel";

            string tip = string.Format(
                "PC Operator MCP · {0}\n{1} · Sesiones: {2} · Demonios: {3}",
                statusLabel,
                modeName,
                s.ActiveSessions,
                s.RunningDaemons
            );
            if (tip.Length > 63)
            {
                tip = tip.Substring(0, 63);
            }
            _notifyIcon.Text = tip;
        }

        private static string FormatMode(string mode)
        {
            if (string.Equals(mode, "tailscale", StringComparison.OrdinalIgnoreCase)) return "Tailscale";
            if (string.Equals(mode, "cloudflare-named", StringComparison.OrdinalIgnoreCase)) return "CF Fijo";
            if (string.Equals(mode, "cloudflare-quick", StringComparison.OrdinalIgnoreCase)) return "CF Rápido";
            if (string.Equals(mode, "local", StringComparison.OrdinalIgnoreCase)) return "Local";
            return mode ?? "MCP";
        }

        private void UpdateTrayIcon(string visualState)
        {
            int size = Math.Max(16, SystemInformation.SmallIconSize.Width);
            Color dotColor = Color.FromArgb(34, 197, 94);
            if (visualState == "amber") dotColor = Color.FromArgb(234, 179, 8);
            else if (visualState == "red") dotColor = Color.FromArgb(239, 68, 68);

            using (Bitmap bmp = RenderStatusBitmap(size, dotColor))
            {
                IntPtr newHIcon = bmp.GetHicon();
                Icon icon = Icon.FromHandle(newHIcon);
                _notifyIcon.Icon = (Icon)icon.Clone();
                icon.Dispose();
                if (_currentHIcon != IntPtr.Zero)
                {
                    NativeMethods.DestroyIcon(_currentHIcon);
                }
                _currentHIcon = newHIcon;
            }
        }

        private static Bitmap RenderStatusBitmap(int size, Color statusColor)
        {
            Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);

                float s = size / 32.0f;
                using (GraphicsPath bg = RoundedRect(1.5f * s, 1.5f * s, 29.0f * s, 29.0f * s, 7.5f * s))
                using (SolidBrush bgBrush = new SolidBrush(Color.FromArgb(13, 16, 23)))
                using (Pen borderPen = new Pen(Color.FromArgb(46, 56, 76), Math.Max(1.0f, 1.4f * s)))
                {
                    g.FillPath(bgBrush, bg);
                    g.DrawPath(borderPen, bg);
                }

                using (Pen topPen = new Pen(Color.FromArgb(244, 244, 245), Math.Max(1.4f, 2.2f * s)))
                {
                    topPen.StartCap = LineCap.Round;
                    topPen.EndCap = LineCap.Round;
                    topPen.LineJoin = LineJoin.Round;
                    using (GraphicsPath topPath = new GraphicsPath())
                    {
                        topPath.AddLine(8.5f * s, 13.5f * s, 8.5f * s, 8.5f * s);
                        topPath.AddLine(8.5f * s, 8.5f * s, 23.5f * s, 8.5f * s);
                        topPath.AddLine(23.5f * s, 8.5f * s, 23.5f * s, 13.5f * s);
                        g.DrawPath(topPen, topPath);
                    }
                }

                using (Pen botPen = new Pen(Color.FromArgb(100, 116, 139), Math.Max(1.2f, 1.8f * s)))
                {
                    botPen.StartCap = LineCap.Round;
                    botPen.EndCap = LineCap.Round;
                    botPen.LineJoin = LineJoin.Round;
                    using (GraphicsPath botPath = new GraphicsPath())
                    {
                        botPath.AddLine(8.5f * s, 18.5f * s, 8.5f * s, 23.5f * s);
                        botPath.AddLine(8.5f * s, 23.5f * s, 23.5f * s, 23.5f * s);
                        botPath.AddLine(23.5f * s, 23.5f * s, 23.5f * s, 18.5f * s);
                        g.DrawPath(botPen, botPath);
                    }
                }

                using (Pen midPen = new Pen(Color.FromArgb(148, 163, 184), Math.Max(1.1f, 1.7f * s)))
                {
                    g.DrawLine(midPen, 10.8f * s, 16.0f * s, 21.2f * s, 16.0f * s);
                }

                using (SolidBrush nodeFill = new SolidBrush(Color.FromArgb(24, 28, 36)))
                using (Pen nodePen = new Pen(Color.FromArgb(244, 244, 245), Math.Max(1.2f, 1.7f * s)))
                {
                    float r = 2.3f * s;
                    g.FillEllipse(nodeFill, 8.5f * s - r, 16.0f * s - r, r * 2, r * 2);
                    g.DrawEllipse(nodePen, 8.5f * s - r, 16.0f * s - r, r * 2, r * 2);
                    g.FillEllipse(nodeFill, 23.5f * s - r, 16.0f * s - r, r * 2, r * 2);
                    g.DrawEllipse(nodePen, 23.5f * s - r, 16.0f * s - r, r * 2, r * 2);
                }

                // Live status badge dot in bottom-right corner
                float dotRadius = Math.Max(3.2f, 5.2f * s);
                float cx = size - dotRadius - 0.8f;
                float cy = size - dotRadius - 0.8f;
                using (SolidBrush ringBrush = new SolidBrush(Color.FromArgb(13, 16, 23)))
                using (SolidBrush dotBrush = new SolidBrush(statusColor))
                {
                    float cut = dotRadius + Math.Max(1.3f, 1.8f * s);
                    g.FillEllipse(ringBrush, cx - cut, cy - cut, cut * 2, cut * 2);
                    g.FillEllipse(dotBrush, cx - dotRadius, cy - dotRadius, dotRadius * 2, dotRadius * 2);
                }
            }
            return bmp;
        }

        private static GraphicsPath RoundedRect(float x, float y, float w, float h, float r)
        {
            GraphicsPath path = new GraphicsPath();
            float d = r * 2;
            path.AddArc(x, y, d, d, 180, 90);
            path.AddArc(x + w - d, y, d, d, 270, 90);
            path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
            path.AddArc(x, y + h - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private void CopyToClipboard(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            try
            {
                Clipboard.SetText(text);
            }
            catch
            {
                // Ignore transient clipboard lock.
            }
        }

        private void TriggerTunnelAction(string endpoint)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                PostInternal(endpoint);
                OnTick();
            });
        }

        private void PostInternal(string endpoint)
        {
            string url = string.Format("http://{0}:{1}{2}", _host, _port, endpoint);
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentLength = 0;
                req.Timeout = 4000;
                if (!string.IsNullOrEmpty(_token))
                {
                    req.Headers["x-tray-token"] = _token;
                }
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    // Ok
                }
            }
            catch
            {
                // Best-effort.
            }
        }

        private void OpenOrFocusPanel()
        {
            IntPtr found = FindPanelWindow();
            if (found != IntPtr.Zero)
            {
                if (NativeMethods.IsIconic(found))
                {
                    NativeMethods.ShowWindow(found, NativeMethods.SW_RESTORE);
                }
                else
                {
                    NativeMethods.ShowWindow(found, NativeMethods.SW_SHOW);
                }
                NativeMethods.SetForegroundWindow(found);
                return;
            }

            string adminUrl = string.IsNullOrEmpty(_current.AdminUrl)
                ? string.Format("http://{0}:{1}/admin", _host, _port)
                : _current.AdminUrl;

            string[] candidates = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe"
            };

            foreach (string exe in candidates)
            {
                if (File.Exists(exe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exe,
                        Arguments = "--app=" + adminUrl,
                        UseShellExecute = false
                    });
                    return;
                }
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = adminUrl,
                UseShellExecute = true
            });
        }

        private static IntPtr FindPanelWindow()
        {
            IntPtr match = IntPtr.Zero;
            NativeMethods.EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (!NativeMethods.IsWindowVisible(hWnd)) return true;
                int len = NativeMethods.GetWindowTextLength(hWnd);
                if (len <= 0) return true;
                StringBuilder sb = new StringBuilder(len + 1);
                NativeMethods.GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString();
                if (title.IndexOf("PC Operator MCP", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("Panel Local Gemini MCP", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    match = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return match;
        }

        private void ShutdownDaemonAndExit()
        {
            _exiting = true;
            _pollTimer.Stop();
            _notifyIcon.Visible = false;
            ThreadPool.QueueUserWorkItem(delegate
            {
                PostInternal("/internal/tray/shutdown");
                try
                {
                    _menu.BeginInvoke((MethodInvoker)delegate { CleanExit(); });
                }
                catch
                {
                    Environment.Exit(0);
                }
            });
        }

        private void CleanExit()
        {
            _exiting = true;
            if (_pollTimer != null) _pollTimer.Stop();
            if (_notifyIcon != null)
            {
                _notifyIcon.Visible = false;
                _notifyIcon.Dispose();
            }
            if (_currentHIcon != IntPtr.Zero)
            {
                NativeMethods.DestroyIcon(_currentHIcon);
                _currentHIcon = IntPtr.Zero;
            }
            ExitThread();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            string host = "127.0.0.1";
            int port = 3333;
            int parentPid = 0;
            string token = Environment.GetEnvironmentVariable("MCP_TRAY_TOKEN") ?? "";

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--host" && i + 1 < args.Length) host = args[++i];
                else if (args[i] == "--port" && i + 1 < args.Length) int.TryParse(args[++i], out port);
                else if (args[i] == "--pid" && i + 1 < args.Length) int.TryParse(args[++i], out parentPid);
            }

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Local\\PcOperatorMcpTray_" + port, out createdNew))
            {
                if (!createdNew)
                {
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApplicationContext(host, port, parentPid, token));
            }
        }
    }
}
