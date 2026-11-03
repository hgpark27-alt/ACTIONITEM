// Action Items PC 앱: 웹 앱을 독립 창으로 띄우고, 항상 위 고정 + 전역 단축키(Ctrl+Alt+Space) 제공
// .NET Framework 4.x(윈도우 기본 내장) + WebView2(엣지 엔진, 윈도우 기본 내장) 사용 → 설치 불필요, exe 1개
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [STAThread]
    static void Main()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }   // 고해상도 화면에서 흐릿하지 않게
        AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;          // exe 안에 넣어둔 WebView2 DLL 사용
        Runner.Run();
    }

    static Assembly ResolveEmbedded(object sender, ResolveEventArgs e)
    {
        string name = new AssemblyName(e.Name).Name + ".dll";
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) return null;
            byte[] b = new byte[s.Length];
            s.Read(b, 0, b.Length);
            return Assembly.Load(b);
        }
    }
}

static class Runner
{
    public static void Run()
    {
        Application.EnableVisualStyles();
        Application.Run(new MainForm());
    }
}

class MainForm : Form
{
    const string Url = "https://hgpark27-alt.github.io/ACTIONITEM/";
    const int WM_HOTKEY = 0x0312;

    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

    readonly string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ActionItem");
    readonly string stateFile;
    readonly WebView2 web;

    public MainForm()
    {
        stateFile = Path.Combine(dataDir, "window.txt");
        Text = "Action Items";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(251, 250, 247);
        MinimumSize = new Size(320, 300);
        StartPosition = FormStartPosition.Manual;
        LoadState();

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
        Load += async (s, e) => await InitWeb();
    }

    async Task InitWeb()
    {
        try
        {
            string bin = Path.Combine(dataDir, "bin");
            Directory.CreateDirectory(bin);
            ExtractLoader(Path.Combine(bin, "WebView2Loader.dll"));
            CoreWebView2Environment.SetLoaderDllFolderPath(bin);
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "webview"));
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.WebMessageReceived += OnWebMessage;
            // 테스트용: 실행 인자로 폴더를 주면 온라인 대신 그 폴더의 화면을 띄움
            string[] args = Environment.GetCommandLineArgs();
            if (args.Length > 1 && Directory.Exists(args[1]))
            {
                web.CoreWebView2.SetVirtualHostNameToFolderMapping("actionitem.local", args[1], CoreWebView2HostResourceAccessKind.Allow);
                Text = "Action Items (테스트)";
                web.Source = new Uri("https://actionitem.local/index.html");
            }
            else web.Source = new Uri(Url);
        }
        catch (Exception ex)
        {
            MessageBox.Show("화면 엔진(WebView2)을 시작하지 못했습니다.\n\n" + ex.Message, "Action Items");
        }
    }

    static void ExtractLoader(string path)
    {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("WebView2Loader.dll"))
        {
            if (File.Exists(path) && new FileInfo(path).Length == s.Length) return;
            using (FileStream f = File.Create(path)) s.CopyTo(f);
        }
    }

    // 웹 화면의 [고정] 버튼 ↔ 실제 창 "항상 위"
    void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string msg;
        try { msg = e.TryGetWebMessageAsString(); } catch { return; }
        if (msg == "togglePin") { TopMost = !TopMost; SaveState(); }
        if (msg == "autostart:on") SetAutostart(true);
        if (msg == "autostart:off") SetAutostart(false);
        SendPinState();
    }

    void SendPinState()
    {
        web.CoreWebView2.PostWebMessageAsJson("{\"pinned\":" + (TopMost ? "true" : "false") +
            ",\"autostart\":" + (GetAutostart() ? "true" : "false") + "}");
    }

    // Windows 시작 시 자동 실행: 현재 사용자 레지스트리 Run 항목
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static bool GetAutostart()
    {
        using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey))
            return k != null && k.GetValue("ActionItem") != null;
    }
    static void SetAutostart(bool on)
    {
        using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey))
        {
            if (on) k.SetValue("ActionItem", "\"" + Application.ExecutablePath + "\"");
            else k.DeleteValue("ActionItem", false);
        }
    }

    // Ctrl+Alt+Space: 창 불러오기 / 내리기
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RegisterHotKey(Handle, 1, 0x0001 | 0x0002 | 0x4000, 0x20);   // ALT | CTRL | NOREPEAT, SPACE
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY)
        {
            if (WindowState == FormWindowState.Minimized || Form.ActiveForm != this)
            {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
                SetForegroundWindow(Handle);
                web.Focus();
                if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString("focus");
            }
            else WindowState = FormWindowState.Minimized;
        }
        base.WndProc(ref m);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        SaveState();
        UnregisterHotKey(Handle, 1);
        base.OnFormClosing(e);
    }

    // 창 위치·크기·고정 상태 기억
    void LoadState()
    {
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        Rectangle r = new Rectangle(work.Right - 440, work.Top + 40, 420, Math.Min(760, work.Height - 80));
        try
        {
            string[] p = File.ReadAllText(stateFile).Split(',');
            Rectangle saved = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            foreach (Screen sc in Screen.AllScreens)
                if (sc.WorkingArea.IntersectsWith(saved)) { r = saved; break; }
            TopMost = p[4] == "1";
        }
        catch { }
        Bounds = r;
    }

    void SaveState()
    {
        try
        {
            Directory.CreateDirectory(dataDir);
            Rectangle b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(stateFile, b.X + "," + b.Y + "," + b.Width + "," + b.Height + "," + (TopMost ? "1" : "0"));
        }
        catch { }
    }
}
