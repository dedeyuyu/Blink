using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BlinkUninstaller
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            foreach (string a in args)
            {
                if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
            }

            string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');

            if (!silent)
            {
                DialogResult dr = MessageBox.Show(
                    "确定要从电脑中卸载 Blink（灵动书签）吗？\n\n注：您的个人加密书签数据库（位于 %APPDATA%\\blink-bookmarks）将被安全保留，不会丢失。",
                    "卸载 Blink · 灵动书签",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (dr != DialogResult.Yes)
                {
                    return;
                }
            }

            try
            {
                foreach (string procName in new[] { "Blink", "BrowserBridge" })
                {
                    foreach (Process p in Process.GetProcessesByName(procName))
                    {
                        try
                        {
                            if (p.Id != Process.GetCurrentProcess().Id)
                            {
                                p.Kill();
                                p.WaitForExit(2000);
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            // Remove shortcuts
            try
            {
                string desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Blink 灵动书签.lnk");
                if (File.Exists(desktopShortcut)) File.Delete(desktopShortcut);

                string startMenuShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Blink 灵动书签.lnk");
                if (File.Exists(startMenuShortcut)) File.Delete(startMenuShortcut);
            }
            catch { }

            // Remove Uninstall Registry Key
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Blink", false);
            }
            catch { }

            if (!silent)
            {
                MessageBox.Show(
                    "Blink · 灵动书签 已成功卸载。",
                    "卸载完成",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }

            // Self-delete installation directory via background cmd
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/C timeout /t 2 /nobreak >nul & rmdir /s /q \"" + installDir + "\"",
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
            catch { }
        }
    }
}
