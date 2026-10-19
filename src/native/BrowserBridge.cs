using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace BlinkNative
{
    public class BrowserInfo
    {
        public long Hwnd;
        public uint Pid;
        public string ProcessName;
        public string FriendlyName;
        public string Title;
        public string RawTitle;
        public string ExePath;
        public string CommandLine;
        public string ProfileDir;
        public string UserDataDir;
        public DateTime LastActive;
    }

    class Program
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern IntPtr GetDesktopWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        private const int GWL_STYLE = -16;
        private const int GWL_EXSTYLE = -20;
        private const int WS_CHILD = 0x40000000;
        private const int WS_THICKFRAME = 0x00040000;
        private const int WS_EX_TOOLWINDOW = 0x00000080;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        private const int SW_RESTORE = 9;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const byte VK_CONTROL = 0x11; // Ctrl
        private const byte VK_RETURN = 0x0D;  // Enter
        private const byte VK_T = 0x54;       // T
        private const byte VK_L = 0x4C;       // L
        private const byte VK_V = 0x56;       // V

        // COM PropertyStore definitions for reading Chromium per-window RelaunchCommand (--profile-directory)
        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        public struct PROPERTYKEY
        {
            public Guid fmtid;
            public uint pid;
        }

        [StructLayout(LayoutKind.Explicit, Size = 24)]
        public struct PROPVARIANT
        {
            [FieldOffset(0)] public ushort vt;
            [FieldOffset(8)] public IntPtr pwszVal;
        }

        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IPropertyStore
        {
            [PreserveSig] int GetCount(out uint cProps);
            [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
            [PreserveSig] int GetValue([In] ref PROPERTYKEY key, out PROPVARIANT pv);
        }

        [DllImport("shell32.dll")]
        public static extern int SHGetPropertyStoreForWindow(
            IntPtr hwnd,
            ref Guid iid,
            [Out, MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore);

        [DllImport("ole32.dll")]
        public static extern int PropVariantClear(ref PROPVARIANT pvar);

        // CreateProcessW for launching browser command line on Winsta0\Default without disturbing windows
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool CreateProcessW(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        private static readonly HashSet<string> KnownBrowserProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "chrome", "brave", "msedge", "firefox", "opera", "vivaldi", "arc",
            "chromium", "waterfox", "zen", "floorp", "librewolf", "tor",
            "centbrowser", "360chrome", "360se", "qqbrowser", "sogouexplorer",
            "maxthon", "twinkstar", "liebao", "2345explorer",
            "bitbrowser", "adspower", "adspower_global", "sunbrowser", "ixbrowser",
            "morelogin", "hubstudio", "lalicat", "vmlogin", "dolphin", "gologin",
            "multilogin", "dicloak", "roxybrowser", "nstbrowser", "catsxp",
            "thorium", "supermium", "whale", "iron"
        };

        private static readonly HashSet<string> ExcludedProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "electron", "code", "antigravity", "cursor", "windsurf", "wechat", "weixin",
            "ms-teams", "teams", "slack", "discord", "notion", "obsidian", "spotify",
            "postman", "apifox", "feishu", "lark", "dingtalk", "qq", "tim",
            "cloudmusic", "clash", "flclash", "v2rayn", "steamwebhelper", "msedgewebview2",
            "searchhost", "widgets", "applicationframehost", "explorer"
        };

        private static readonly object StateLock = new object();
        private static BrowserInfo LastActiveBrowser = null;
        private static long ManuallySelectedHwnd = 0;
        private static readonly Dictionary<long, BrowserInfo> BrowserCache = new Dictionary<long, BrowserInfo>();
        private static uint SelfPid = (uint)Process.GetCurrentProcess().Id;
        private static uint ParentPid = 0;

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        private const uint GENERIC_ALL = 0x10000000;

        private static void AttachToInteractiveDesktop()
        {
            try
            {
                IntPtr hDesk = OpenDesktop("Default", 0, false, GENERIC_ALL);
                if (hDesk == IntPtr.Zero)
                {
                    hDesk = OpenInputDesktop(0, false, GENERIC_ALL);
                }
                if (hDesk != IntPtr.Zero)
                {
                    SetThreadDesktop(hDesk);
                    CloseDesktop(hDesk);
                }
            }
            catch { }
        }

        static void Main(string[] args)
        {
            Console.InputEncoding = Encoding.UTF8;
            Console.OutputEncoding = Encoding.UTF8;

            Thread worker = new Thread(() => RunMain(args));
            worker.IsBackground = false;
            worker.Start();
            worker.Join();
        }

        static void RunMain(string[] args)
        {
            AttachToInteractiveDesktop();

            if (args.Length > 0)
            {
                uint.TryParse(args[0], out ParentPid);
            }

            // Initial scan in Z-order to immediately find the most recently active non-minimized browser window
            ScanZOrderForTopBrowser();

            // Background polling thread for GetForegroundWindow()
            Thread pollThread = new Thread(PollForegroundLoop);
            pollThread.IsBackground = true;
            pollThread.Start();

            // Read JSON commands line-by-line from stdin
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                try
                {
                    string cmd = ExtractJsonString(line, "cmd");
                    if (cmd == "open")
                    {
                        string url = ExtractJsonString(line, "url");
                        string mode = ExtractJsonString(line, "mode"); // "auto", "hotkey", or "cmdline"
                        string targetHwndStr = ExtractJsonString(line, "hwnd");
                        long explicitHwnd = 0;
                        long.TryParse(targetHwndStr, out explicitHwnd);

                        bool ok = OpenUrlInTargetBrowser(url, mode, explicitHwnd);
                        EmitCurrentTarget(ok ? "opened" : "fallback");
                    }
                    else if (cmd == "status" || cmd == "list")
                    {
                        EmitBrowserList();
                    }
                    else if (cmd == "select")
                    {
                        string hwndStr = ExtractJsonString(line, "hwnd");
                        long hwndVal = 0;
                        if (long.TryParse(hwndStr, out hwndVal) && hwndVal != 0)
                        {
                            IntPtr ptr = new IntPtr(hwndVal);
                            BrowserInfo info = InspectBrowserWindow(ptr, true);
                            if (info != null)
                            {
                                lock (StateLock)
                                {
                                    ManuallySelectedHwnd = hwndVal;
                                    LastActiveBrowser = info;
                                }
                                EmitCurrentTarget("selected");
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("{\"type\":\"error\",\"message\":\"" + EscapeJson(ex.Message) + "\"}");
                }
            }
        }

        private static void PollForegroundLoop()
        {
            AttachToInteractiveDesktop();
            long prevHwnd = 0;
            while (true)
            {
                try
                {
                    IntPtr fg = GetForegroundWindow();
                    if (fg != IntPtr.Zero)
                    {
                        long hwndLong = fg.ToInt64();
                        // Only accept non-minimized visible main browser windows as active foreground targets
                        BrowserInfo info = InspectBrowserWindow(fg, false);
                        if (info != null)
                        {
                            bool changed = false;
                            lock (StateLock)
                            {
                                ManuallySelectedHwnd = 0;
                                if (LastActiveBrowser == null ||
                                    LastActiveBrowser.Hwnd != info.Hwnd ||
                                    LastActiveBrowser.Title != info.Title)
                                {
                                    changed = true;
                                }
                                LastActiveBrowser = info;
                                BrowserCache[info.Hwnd] = info;
                            }
                            if (changed || prevHwnd != hwndLong)
                            {
                                prevHwnd = hwndLong;
                                EmitCurrentTarget("active");
                            }
                        }
                        else
                        {
                            // Check if our LastActiveBrowser window was closed or minimized
                            bool needRescan = false;
                            lock (StateLock)
                            {
                                if (LastActiveBrowser != null)
                                {
                                    IntPtr lastPtr = new IntPtr(LastActiveBrowser.Hwnd);
                                    if (!IsWindow(lastPtr) || !IsWindowVisible(lastPtr) || (ManuallySelectedHwnd == 0 && IsIconic(lastPtr)))
                                    {
                                        if (!IsWindow(lastPtr))
                                        {
                                            BrowserCache.Remove(LastActiveBrowser.Hwnd);
                                        }
                                        LastActiveBrowser = null;
                                        needRescan = true;
                                    }
                                }
                            }
                            if (needRescan)
                            {
                                ScanZOrderForTopBrowser();
                            }
                        }
                    }
                }
                catch { }
                Thread.Sleep(120);
            }
        }

        private static void ScanZOrderForTopBrowser()
        {
            BrowserInfo foundVisibleTop = null;
            BrowserInfo foundMinimizedFallback = null;

            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;

                bool iconic = IsIconic(hWnd);
                BrowserInfo info = InspectBrowserWindow(hWnd, true);
                if (info != null)
                {
                    if (!iconic && foundVisibleTop == null)
                    {
                        foundVisibleTop = info;
                    }
                    else if (iconic && foundMinimizedFallback == null)
                    {
                        foundMinimizedFallback = info;
                    }

                    lock (StateLock)
                    {
                        BrowserCache[info.Hwnd] = info;
                    }
                }
                return true;
            }, IntPtr.Zero);

            BrowserInfo chosen = foundVisibleTop ?? foundMinimizedFallback;
            if (chosen != null)
            {
                lock (StateLock)
                {
                    LastActiveBrowser = chosen;
                }
                EmitCurrentTarget("scan");
            }
            else
            {
                EmitCurrentTarget("none");
            }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        private static bool GetProcessPathAndName(uint pid, out string exePath, out string procName)
        {
            exePath = "";
            procName = "";
            IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc == IntPtr.Zero) return false;
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (QueryFullProcessImageName(hProc, 0, sb, ref size))
                {
                    exePath = sb.ToString();
                    procName = Path.GetFileNameWithoutExtension(exePath);
                    return true;
                }
            }
            finally
            {
                CloseHandle(hProc);
            }
            return false;
        }

        private static bool TryExtractProfileFromWindowPropertyStore(IntPtr hWnd, out string relaunchCmd, out string profileDir, out string userDataDir)
        {
            relaunchCmd = "";
            profileDir = "";
            userDataDir = "";
            try
            {
                Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
                IPropertyStore store;
                int hr = SHGetPropertyStoreForWindow(hWnd, ref iid, out store);
                if (hr == 0 && store != null)
                {
                    // PKEY_AppUserModel_RelaunchCommand = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 2
                    PROPERTYKEY pkRelaunch = new PROPERTYKEY
                    {
                        fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                        pid = 2
                    };
                    PROPVARIANT pv;
                    int hrVal = store.GetValue(ref pkRelaunch, out pv);
                    if (hrVal == 0)
                    {
                        try
                        {
                            if (pv.vt == 31 && pv.pwszVal != IntPtr.Zero)
                            {
                                relaunchCmd = Marshal.PtrToStringUni(pv.pwszVal) ?? "";
                            }
                        }
                        finally
                        {
                            PropVariantClear(ref pv);
                        }
                    }
                }

                if (!string.IsNullOrEmpty(relaunchCmd))
                {
                    Match mProf = Regex.Match(relaunchCmd, @"--profile-directory=(?:""([^""]+)""|([^\s""]+))", RegexOptions.IgnoreCase);
                    if (mProf.Success)
                    {
                        profileDir = SanitizeSafeProfileDir(mProf.Groups[1].Success ? mProf.Groups[1].Value : mProf.Groups[2].Value);
                    }

                    Match mData = Regex.Match(relaunchCmd, @"--user-data-dir=(?:""([^""]+)""|([^\s""]+))", RegexOptions.IgnoreCase);
                    if (mData.Success)
                    {
                        userDataDir = SanitizeSafeUserDataDir(mData.Groups[1].Success ? mData.Groups[1].Value : mData.Groups[2].Value);
                    }
                    return !string.IsNullOrEmpty(profileDir) || !string.IsNullOrEmpty(userDataDir);
                }
            }
            catch { }
            return false;
        }

        private static BrowserInfo InspectBrowserWindow(IntPtr hWnd, bool allowMinimized = false)
        {
            if (hWnd == IntPtr.Zero || !IsWindow(hWnd) || !IsWindowVisible(hWnd)) return null;

            bool iconic = IsIconic(hWnd);
            if (iconic && !allowMinimized) return null;

            int style = GetWindowLong(hWnd, GWL_STYLE);
            int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);

            // Reject child windows, tool windows, and popup bubbles (like Chrome's translate bubble)
            if ((style & WS_CHILD) != 0) return null;
            if ((exStyle & WS_EX_TOOLWINDOW) != 0) return null;
            if ((style & WS_THICKFRAME) == 0) return null;

            if (!iconic)
            {
                RECT r;
                if (GetWindowRect(hWnd, out r))
                {
                    int w = r.Right - r.Left;
                    int h = r.Bottom - r.Top;
                    if (w < 200 || h < 150) return null;
                }
            }

            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == 0 || pid == SelfPid || (ParentPid != 0 && pid == ParentPid)) return null;

            StringBuilder sbClass = new StringBuilder(256);
            GetClassName(hWnd, sbClass, 256);
            string className = sbClass.ToString();

            bool isChromiumOrMozClass = (className == "Chrome_WidgetWin_1" || className == "MozillaWindowClass");
            if (!isChromiumOrMozClass) return null;

            StringBuilder sbTitle = new StringBuilder(512);
            GetWindowText(hWnd, sbTitle, 512);
            string title = sbTitle.ToString().Trim();
            if (string.IsNullOrEmpty(title)) return null;

            string procName;
            string exePath;
            if (!GetProcessPathAndName(pid, out exePath, out procName)) return null;

            if (ExcludedProcesses.Contains(procName)) return null;

            bool isBrowser = KnownBrowserProcesses.Contains(procName);
            if (!isBrowser)
            {
                if (title.EndsWith("- Google Chrome", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Brave", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Microsoft\u200b Edge", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Microsoft Edge", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Mozilla Firefox", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Vivaldi", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Opera", StringComparison.OrdinalIgnoreCase) ||
                    title.EndsWith("- Chromium", StringComparison.OrdinalIgnoreCase))
                {
                    isBrowser = true;
                }
            }

            if (!isBrowser) return null;

            long hwndLong = hWnd.ToInt64();
            string cachedCmdLine = "";
            string cachedProfileDir = "";
            string cachedUserDataDir = "";

            lock (StateLock)
            {
                BrowserInfo existing;
                if (BrowserCache.TryGetValue(hwndLong, out existing))
                {
                    cachedCmdLine = existing.CommandLine ?? "";
                    cachedProfileDir = existing.ProfileDir ?? "";
                    cachedUserDataDir = existing.UserDataDir ?? "";
                }
            }

            // 1. Extract per-window ProfileDir & UserDataDir from Windows PropertyStore (PKEY_AppUserModel_RelaunchCommand)
            if (string.IsNullOrEmpty(cachedProfileDir))
            {
                string relaunchCmd, propProfile, propUserData;
                if (TryExtractProfileFromWindowPropertyStore(hWnd, out relaunchCmd, out propProfile, out propUserData))
                {
                    if (!string.IsNullOrEmpty(propProfile)) cachedProfileDir = propProfile;
                    if (!string.IsNullOrEmpty(propUserData)) cachedUserDataDir = propUserData;
                }
            }

            // 2. Also check raw window title (e.g. Chrome_Profile 429_C:|Users|...)
            string titleProfile, titleUserData;
            if (TryExtractProfileFromRawTitle(title, out titleProfile, out titleUserData))
            {
                if (string.IsNullOrEmpty(cachedProfileDir) && !string.IsNullOrEmpty(titleProfile))
                    cachedProfileDir = titleProfile;
                if (string.IsNullOrEmpty(cachedUserDataDir) && !string.IsNullOrEmpty(titleUserData))
                    cachedUserDataDir = titleUserData;
            }

            return new BrowserInfo
            {
                Hwnd = hwndLong,
                Pid = pid,
                ProcessName = procName,
                FriendlyName = GetFriendlyBrowserName(procName, title),
                Title = FormatDisplayTitle(title, cachedProfileDir),
                RawTitle = title,
                ExePath = exePath,
                CommandLine = cachedCmdLine,
                ProfileDir = cachedProfileDir,
                UserDataDir = cachedUserDataDir,
                LastActive = DateTime.UtcNow
            };
        }

        private static string FormatDisplayTitle(string rawTitle, string profileDir)
        {
            if (string.IsNullOrEmpty(rawTitle)) return "";
            Match m = Regex.Match(rawTitle, @"^([A-Za-z0-9]+)_([^_]+)_[A-Za-z]:\|");
            if (m.Success)
            {
                return m.Groups[1].Value + " · " + m.Groups[2].Value;
            }
            if (!string.IsNullOrEmpty(profileDir) && !rawTitle.Contains(profileDir))
            {
                return "[" + profileDir + "] " + rawTitle;
            }
            return rawTitle;
        }

        private static string SanitizeSafeProfileDir(string candidate)
        {
            if (string.IsNullOrWhiteSpace(candidate)) return "";
            string trimmed = candidate.Trim();
            if (trimmed.Length > 64 || trimmed.StartsWith("-")) return "";
            if (!Regex.IsMatch(trimmed, @"^[A-Za-z0-9 _.\-]+$")) return "";
            if (trimmed.Contains("..")) return "";
            return trimmed;
        }

        private static string SanitizeSafeUserDataDir(string candidate)
        {
            if (string.IsNullOrWhiteSpace(candidate)) return "";
            string trimmed = candidate.Trim();
            if (trimmed.Length > 260 || trimmed.StartsWith("-")) return "";
            if (trimmed.IndexOfAny(new char[] { '"', '\'', '\r', '\n', '\0', '|', '<', '>' }) >= 0) return "";
            if (trimmed.Contains("..")) return "";
            try
            {
                if (!Path.IsPathRooted(trimmed) || !Directory.Exists(trimmed)) return "";
                return Path.GetFullPath(trimmed);
            }
            catch
            {
                return "";
            }
        }

        private static bool IsSafeHttpUrl(string rawUrl, out string safeAbsoluteUri)
        {
            safeAbsoluteUri = "";
            if (string.IsNullOrWhiteSpace(rawUrl)) return false;
            string trimmed = rawUrl.Trim();
            if (trimmed.StartsWith("-")) return false;
            if (trimmed.IndexOfAny(new char[] { '"', '\r', '\n', '\0' }) >= 0) return false;
            Uri parsed;
            if (!Uri.TryCreate(trimmed, UriKind.Absolute, out parsed)) return false;
            if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return false;
            safeAbsoluteUri = parsed.AbsoluteUri;
            return true;
        }

        private static bool TryExtractProfileFromRawTitle(string rawTitle, out string profileDir, out string userDataDir)
        {
            profileDir = "";
            userDataDir = "";
            if (string.IsNullOrEmpty(rawTitle)) return false;

            Match m = Regex.Match(rawTitle, @"^[A-Za-z0-9]+_([^_]+)_([A-Za-z]:\|.+)$");
            if (m.Success)
            {
                profileDir = SanitizeSafeProfileDir(m.Groups[1].Value);
                userDataDir = SanitizeSafeUserDataDir(m.Groups[2].Value.Trim().Replace('|', '\\'));
                return !string.IsNullOrEmpty(profileDir) || !string.IsNullOrEmpty(userDataDir);
            }
            return false;
        }

        private static string GetFriendlyBrowserName(string procName, string title)
        {
            string lower = (procName ?? "").ToLowerInvariant();
            if (lower.Contains("chrome") && !lower.Contains("360")) return "Google Chrome";
            if (lower.Contains("brave")) return "Brave";
            if (lower.Contains("msedge")) return "Microsoft Edge";
            if (lower.Contains("firefox")) return "Firefox";
            if (lower.Contains("vivaldi")) return "Vivaldi";
            if (lower.Contains("opera")) return "Opera";
            if (lower.Contains("arc")) return "Arc";
            if (lower.Contains("bitbrowser")) return "比特浏览器 (BitBrowser)";
            if (lower.Contains("adspower") || lower.Contains("sunbrowser")) return "AdsPower";
            if (lower.Contains("morelogin")) return "MoreLogin";
            if (lower.Contains("ixbrowser")) return "ixBrowser";
            if (lower.Contains("hubstudio")) return "Hubstudio";
            if (lower.Contains("360chrome") || lower.Contains("360se")) return "360浏览器";
            if (lower.Contains("qqbrowser")) return "QQ浏览器";
            if (lower.Contains("centbrowser")) return "CentBrowser";
            return procName;
        }

        private static void LogBridge(string msg)
        {
            // Security hardened: never write opened URLs or browser window titles to plaintext log files on disk
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool OpenClipboard(IntPtr hWndNewOwner);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool EmptyClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GlobalUnlock(IntPtr hMem);

        private const uint CF_UNICODETEXT = 13;
        private const uint GMEM_MOVEABLE = 0x0002;

        private static bool SetNativeClipboardText(string text)
        {
            if (text == null) return false;
            for (int retry = 0; retry < 5; retry++)
            {
                if (OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        EmptyClipboard();
                        int bytes = (text.Length + 1) * 2;
                        IntPtr hGlobal = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes);
                        if (hGlobal == IntPtr.Zero) return false;
                        IntPtr target = GlobalLock(hGlobal);
                        if (target == IntPtr.Zero) return false;
                        try
                        {
                            Marshal.Copy(text.ToCharArray(), 0, target, text.Length);
                            Marshal.WriteInt16(target, text.Length * 2, 0);
                        }
                        finally
                        {
                            GlobalUnlock(hGlobal);
                        }
                        if (SetClipboardData(CF_UNICODETEXT, hGlobal) != IntPtr.Zero)
                        {
                            return true;
                        }
                    }
                    finally
                    {
                        CloseClipboard();
                    }
                }
                Thread.Sleep(15);
            }
            return false;
        }

        /// <summary>
        /// Cleanly brings the target browser window to the foreground WITHOUT sending synthetic VK_MENU (Alt)
        /// keystrokes, WITHOUT calling ShowWindow(SW_SHOW) on already-visible windows, and WITHOUT calling
        /// SwitchToThisWindow loops that could disturb or close maximized/multi-profile windows.
        /// </summary>
        private static bool FocusBrowserWindowCleanly(IntPtr hWnd, bool allowRestoreIfMinimized)
        {
            if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;

            if (IsIconic(hWnd))
            {
                if (allowRestoreIfMinimized)
                {
                    ShowWindow(hWnd, SW_RESTORE);
                }
                else
                {
                    return false;
                }
            }

            IntPtr fg = GetForegroundWindow();
            if (fg == hWnd) return true;

            uint fgPid = 0;
            uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out fgPid) : 0;
            uint targetPid = 0;
            uint targetThread = GetWindowThreadProcessId(hWnd, out targetPid);
            uint currentThread = GetCurrentThreadId();

            bool attachedFg = false;
            bool attachedTarget = false;
            try
            {
                if (fgThread != 0 && fgThread != currentThread)
                    attachedFg = AttachThreadInput(currentThread, fgThread, true);
                if (targetThread != 0 && targetThread != currentThread)
                    attachedTarget = AttachThreadInput(currentThread, targetThread, true);

                BringWindowToTop(hWnd);
                SetForegroundWindow(hWnd);
            }
            catch { }
            finally
            {
                if (attachedFg) AttachThreadInput(currentThread, fgThread, false);
                if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            }

            return GetForegroundWindow() == hWnd;
        }

        private static bool OpenUrlInTargetBrowser(string url, string mode, long explicitHwnd)
        {
            string safeUrl;
            if (!IsSafeHttpUrl(url, out safeUrl)) return false;

            BrowserInfo target = null;
            bool isExplicitOrManual = false;

            if (explicitHwnd != 0 && IsWindow(new IntPtr(explicitHwnd)))
            {
                target = InspectBrowserWindow(new IntPtr(explicitHwnd), true);
                isExplicitOrManual = true;
            }

            if (target == null)
            {
                long manualHwnd = 0;
                lock (StateLock)
                {
                    manualHwnd = ManuallySelectedHwnd;
                }
                if (manualHwnd != 0 && IsWindow(new IntPtr(manualHwnd)))
                {
                    target = InspectBrowserWindow(new IntPtr(manualHwnd), true);
                    isExplicitOrManual = true;
                }
            }

            // Always refresh Z-order scan for automatic mode so we are 100% guaranteed to target
            // the topmost visible, non-minimized browser clone window currently on the user's screen
            if (target == null)
            {
                ScanZOrderForTopBrowser();
                lock (StateLock)
                {
                    if (LastActiveBrowser != null && IsWindow(new IntPtr(LastActiveBrowser.Hwnd)))
                    {
                        target = InspectBrowserWindow(new IntPtr(LastActiveBrowser.Hwnd), false) ?? LastActiveBrowser;
                    }
                }
            }

            if (target != null && IsWindow(new IntPtr(target.Hwnd)))
            {
                IntPtr hWnd = new IntPtr(target.Hwnd);

                // 1. Primary Safe & Universal Method ("auto" or "cmdline"):
                // Use Chromium / Browser native command-line IPC with exact --profile-directory and --user-data-dir
                // extracted from SHGetPropertyStoreForWindow / Window Title / Process CommandLine.
                // This opens the new tab directly inside the target browser clone with ZERO synthetic keystrokes!
                if (mode != "hotkey")
                {
                    FocusBrowserWindowCleanly(hWnd, isExplicitOrManual);
                    if (OpenViaNativeBrowserCommandLine(target, safeUrl))
                    {
                        return true;
                    }
                }

                // 2. Fallback / Explicit Hotkey mode ("hotkey"):
                bool activated = FocusBrowserWindowCleanly(hWnd, true);
                if (activated && OpenViaWindowNewTabShortcut(hWnd, safeUrl))
                {
                    return true;
                }

                // 3. Final attempt via native command line
                if (OpenViaNativeBrowserCommandLine(target, safeUrl))
                {
                    return true;
                }
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = safeUrl,
                    UseShellExecute = true
                });
                return false;
            }
            catch
            {
                return false;
            }
        }

        private static bool OpenViaNativeBrowserCommandLine(BrowserInfo target, string url)
        {
            try
            {
                string safeUrl;
                if (!IsSafeHttpUrl(url, out safeUrl)) return false;

                IntPtr hWnd = new IntPtr(target.Hwnd);
                string exePath = target.ExePath;
                string profileDir = target.ProfileDir;
                string userDataDir = target.UserDataDir;

                // Ensure we have fresh PropertyStore profile info for this HWND
                if (string.IsNullOrEmpty(profileDir))
                {
                    string relaunchCmd, propProfile, propUserData;
                    if (TryExtractProfileFromWindowPropertyStore(hWnd, out relaunchCmd, out propProfile, out propUserData))
                    {
                        if (!string.IsNullOrEmpty(propProfile)) profileDir = propProfile;
                        if (string.IsNullOrEmpty(userDataDir) && !string.IsNullOrEmpty(propUserData)) userDataDir = propUserData;
                    }
                }

                // Check RawTitle (e.g. Chrome_Profile 429_C:|Users|...)
                if (string.IsNullOrEmpty(profileDir) || string.IsNullOrEmpty(userDataDir))
                {
                    string currentRawTitle = GetWindowTitleFast(hWnd);
                    string tProf, tData;
                    if (TryExtractProfileFromRawTitle(currentRawTitle, out tProf, out tData) ||
                        TryExtractProfileFromRawTitle(target.RawTitle, out tProf, out tData))
                    {
                        if (string.IsNullOrEmpty(profileDir) && !string.IsNullOrEmpty(tProf)) profileDir = tProf;
                        if (string.IsNullOrEmpty(userDataDir) && !string.IsNullOrEmpty(tData)) userDataDir = tData;
                    }
                }

                // Also inspect process command line for custom --user-data-dir or --profile-directory
                string cmdLine = target.CommandLine;
                if (string.IsNullOrEmpty(cmdLine) || string.IsNullOrEmpty(exePath))
                {
                    string qExe, qCmd;
                    QueryProcessCommandLine(target.Pid, out qExe, out qCmd);
                    if (string.IsNullOrEmpty(exePath) && !string.IsNullOrEmpty(qExe)) exePath = qExe;
                    if (!string.IsNullOrEmpty(qCmd)) cmdLine = qCmd;
                    target.CommandLine = cmdLine;
                }

                if (!string.IsNullOrEmpty(cmdLine))
                {
                    if (string.IsNullOrEmpty(userDataDir))
                    {
                        Match mUserData = Regex.Match(cmdLine, @"--user-data-dir=(?:""([^""]+)""|([^\s""]+))", RegexOptions.IgnoreCase);
                        if (mUserData.Success)
                        {
                            userDataDir = (mUserData.Groups[1].Success ? mUserData.Groups[1].Value : mUserData.Groups[2].Value).Trim();
                        }
                    }
                    if (string.IsNullOrEmpty(profileDir))
                    {
                        Match mProf = Regex.Match(cmdLine, @"--profile-directory=(?:""([^""]+)""|([^\s""]+))", RegexOptions.IgnoreCase);
                        if (mProf.Success)
                        {
                            profileDir = (mProf.Groups[1].Success ? mProf.Groups[1].Value : mProf.Groups[2].Value).Trim();
                        }
                    }
                }

                profileDir = SanitizeSafeProfileDir(profileDir);
                userDataDir = SanitizeSafeUserDataDir(userDataDir);

                target.ProfileDir = profileDir;
                target.UserDataDir = userDataDir;

                if (string.IsNullOrEmpty(exePath) || !File.Exists(exePath)) return false;

                List<string> argsList = new List<string>();
                string lowerProc = (target.ProcessName ?? "").ToLowerInvariant();
                bool isFirefox = lowerProc.Contains("firefox") || lowerProc.Contains("waterfox") || lowerProc.Contains("zen") || lowerProc.Contains("floorp") || lowerProc.Contains("librewolf");

                if (isFirefox)
                {
                    argsList.Add("-new-tab");
                    argsList.Add("\"" + safeUrl.Replace("\"", "%22") + "\"");
                }
                else
                {
                    if (!string.IsNullOrEmpty(profileDir))
                    {
                        argsList.Add("--profile-directory=\"" + profileDir + "\"");
                    }
                    if (!string.IsNullOrEmpty(userDataDir))
                    {
                        argsList.Add("--user-data-dir=\"" + userDataDir + "\"");
                    }
                    argsList.Add("--new-tab");
                    argsList.Add("\"" + safeUrl.Replace("\"", "%22") + "\"");
                }

                string fullArgs = string.Join(" ", argsList.ToArray());

                // Launch directly on Winsta0\Default so Chromium ProcessSingleton IPC always reaches the active window
                if (StartProcessOnInteractiveDesktop(exePath, fullArgs))
                {
                    return true;
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    Arguments = fullArgs,
                    UseShellExecute = false
                });
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool StartProcessOnInteractiveDesktop(string exePath, string arguments)
        {
            try
            {
                STARTUPINFO si = new STARTUPINFO();
                si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                si.lpDesktop = "Winsta0\\Default";

                PROCESS_INFORMATION pi;
                StringBuilder cmdLine = new StringBuilder("\"" + exePath + "\" " + arguments);

                bool created = CreateProcessW(
                    null,
                    cmdLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    0,
                    IntPtr.Zero,
                    Path.GetDirectoryName(exePath),
                    ref si,
                    out pi);

                if (created)
                {
                    if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
                    if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
                    return true;
                }
            }
            catch { }
            return false;
        }

        private static void PressKey(byte vk)
        {
            keybd_event(vk, 0, 0, UIntPtr.Zero);
            Thread.Sleep(15);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        private static void PressCtrlCombo(byte vk)
        {
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
            Thread.Sleep(15);
            keybd_event(vk, 0, 0, UIntPtr.Zero);
            Thread.Sleep(15);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(10);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        private static string GetWindowTitleFast(IntPtr hWnd)
        {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            return sb.ToString();
        }

        private static bool OpenViaWindowNewTabShortcut(IntPtr hWnd, string url)
        {
            try
            {
                if (GetForegroundWindow() != hWnd) return false;

                bool clipOk = SetNativeClipboardText(url);
                if (!clipOk) return false;

                string titleBefore = GetWindowTitleFast(hWnd);

                // Always send Ctrl+T to open a clean new tab with Omnibox focused
                PressCtrlCombo(VK_T);

                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 500)
                {
                    Thread.Sleep(25);
                    string curTitle = GetWindowTitleFast(hWnd);
                    if (curTitle != titleBefore)
                    {
                        break;
                    }
                }
                Thread.Sleep(80);

                PressCtrlCombo(VK_L);
                Thread.Sleep(60);

                SetNativeClipboardText(url);
                Thread.Sleep(20);

                PressCtrlCombo(VK_V);
                Thread.Sleep(60);

                PressKey(VK_RETURN);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static void QueryProcessCommandLine(uint pid, out string exePath, out string cmdLine)
        {
            exePath = "";
            cmdLine = "";
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId = " + pid))
                {
                    foreach (ManagementObject obj in searcher.Get())
                    {
                        exePath = Convert.ToString(obj["ExecutablePath"]) ?? "";
                        cmdLine = Convert.ToString(obj["CommandLine"]) ?? "";
                        break;
                    }
                }
            }
            catch { }
        }

        private static void EmitCurrentTarget(string reason)
        {
            BrowserInfo info = null;
            lock (StateLock)
            {
                info = LastActiveBrowser;
            }

            if (info == null)
            {
                Console.WriteLine("{\"type\":\"target\",\"reason\":\"" + EscapeJson(reason) + "\",\"hasTarget\":false}");
            }
            else
            {
                Console.WriteLine(string.Format(
                    "{{\"type\":\"target\",\"reason\":\"{0}\",\"hasTarget\":true,\"hwnd\":\"{1}\",\"pid\":{2},\"processName\":\"{3}\",\"friendlyName\":\"{4}\",\"title\":\"{5}\"}}",
                    EscapeJson(reason),
                    info.Hwnd,
                    info.Pid,
                    EscapeJson(info.ProcessName),
                    EscapeJson(info.FriendlyName),
                    EscapeJson(info.Title)
                ));
            }
        }

        private static void EmitBrowserList()
        {
            List<BrowserInfo> visibleList = new List<BrowserInfo>();
            List<BrowserInfo> minimizedList = new List<BrowserInfo>();

            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                bool iconic = IsIconic(hWnd);
                BrowserInfo info = InspectBrowserWindow(hWnd, true);
                if (info != null)
                {
                    if (!iconic)
                        visibleList.Add(info);
                    else
                        minimizedList.Add(info);
                }
                return true;
            }, IntPtr.Zero);

            List<BrowserInfo> list = new List<BrowserInfo>(visibleList.Count + minimizedList.Count);
            list.AddRange(visibleList);
            list.AddRange(minimizedList);

            StringBuilder sb = new StringBuilder();
            sb.Append("{\"type\":\"browsers\",\"items\":[");
            for (int i = 0; i < list.Count; i++)
            {
                var b = list[i];
                if (i > 0) sb.Append(",");
                sb.AppendFormat(
                    "{{\"hwnd\":\"{0}\",\"pid\":{1},\"processName\":\"{2}\",\"friendlyName\":\"{3}\",\"title\":\"{4}\"}}",
                    b.Hwnd,
                    b.Pid,
                    EscapeJson(b.ProcessName),
                    EscapeJson(b.FriendlyName),
                    EscapeJson(b.Title)
                );
            }
            sb.Append("]}");
            Console.WriteLine(sb.ToString());
        }

        private static string ExtractJsonString(string json, string key)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return "";
            string token = "\"" + key + "\"";
            int idx = json.IndexOf(token, StringComparison.Ordinal);
            if (idx < 0) return "";
            int colon = json.IndexOf(':', idx + token.Length);
            if (colon < 0) return "";
            int startQuote = json.IndexOf('"', colon + 1);
            if (startQuote < 0) return "";

            StringBuilder sb = new StringBuilder();
            for (int i = startQuote + 1; i < json.Length; i++)
            {
                char c = json[i];
                if (c == '\\' && i + 1 < json.Length)
                {
                    char next = json[++i];
                    if (next == 'n') sb.Append('\n');
                    else if (next == 'r') sb.Append('\r');
                    else if (next == 't') sb.Append('\t');
                    else sb.Append(next);
                }
                else if (c == '"')
                {
                    break;
                }
                else
                {
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\r", "\\r")
                    .Replace("\n", "\\n")
                    .Replace("\t", "\\t");
        }
    }
}
