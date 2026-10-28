using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BlinkInstaller
{
    public sealed class SubStream : Stream
    {
        private readonly Stream _baseStream;
        private readonly long _offset;
        private readonly long _length;
        private long _position;

        public SubStream(Stream baseStream, long offset, long length)
        {
            _baseStream = baseStream;
            _offset = offset;
            _length = length;
            _position = 0;
            _baseStream.Seek(_offset, SeekOrigin.Begin);
        }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return _length; } }

        public override long Position
        {
            get { return _position; }
            set { Seek(value, SeekOrigin.Begin); }
        }

        public override void Flush() { }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = _length - _position;
            if (remaining <= 0) return 0;
            if (count > remaining) count = (int)remaining;
            _baseStream.Seek(_offset + _position, SeekOrigin.Begin);
            int read = _baseStream.Read(buffer, offset, count);
            _position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long newPos = _position;
            switch (origin)
            {
                case SeekOrigin.Begin:
                    newPos = offset;
                    break;
                case SeekOrigin.Current:
                    newPos = _position + offset;
                    break;
                case SeekOrigin.End:
                    newPos = _length + offset;
                    break;
            }
            if (newPos < 0) newPos = 0;
            if (newPos > _length) newPos = _length;
            _position = newPos;
            _baseStream.Seek(_offset + _position, SeekOrigin.Begin);
            return _position;
        }

        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }

    public class InstallerForm : Form
    {
        private TextBox _txtPath;
        private Button _btnBrowse;
        private CheckBox _chkDesktop;
        private CheckBox _chkStartMenu;
        private CheckBox _chkLaunchNow;
        private ProgressBar _progressBar;
        private Label _lblStatus;
        private Button _btnInstall;
        private Button _btnCancel;
        private bool _isInstalling = false;

        public InstallerForm()
        {
            this.Text = "Blink · 灵动书签 v1.0.2 安装向导";
            this.Size = new Size(540, 410);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(15, 23, 42);
            this.ForeColor = Color.FromArgb(241, 245, 249);
            this.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);

            try
            {
                this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }

            Panel headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 96,
                BackColor = Color.FromArgb(30, 41, 59)
            };

            PictureBox picLogo = new PictureBox
            {
                Location = new Point(24, 20),
                Size = new Size(56, 56),
                SizeMode = PictureBoxSizeMode.StretchImage
            };
            try
            {
                Icon ico = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (ico != null) picLogo.Image = ico.ToBitmap();
            }
            catch { }

            Label lblTitle = new Label
            {
                Text = "Blink · 灵动书签 v1.0.2",
                Font = new Font("Microsoft YaHei UI", 15f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(94, 20),
                AutoSize = true
            };

            Label lblSub = new Label
            {
                Text = "AES-256-GCM 本地加密 · 桌面悬浮球置顶 · 浏览器分身精准直达",
                Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(96, 54),
                AutoSize = true
            };

            headerPanel.Controls.Add(picLogo);
            headerPanel.Controls.Add(lblTitle);
            headerPanel.Controls.Add(lblSub);
            this.Controls.Add(headerPanel);

            Label lblDir = new Label
            {
                Text = "安装目标路径：",
                Location = new Point(26, 114),
                AutoSize = true,
                ForeColor = Color.FromArgb(203, 213, 225)
            };
            this.Controls.Add(lblDir);

            string defaultDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "Blink"
            );

            _txtPath = new TextBox
            {
                Text = defaultDir,
                Location = new Point(28, 140),
                Size = new Size(382, 28),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9.5f)
            };
            this.Controls.Add(_txtPath);

            _btnBrowse = new Button
            {
                Text = "浏览...",
                Location = new Point(418, 138),
                Size = new Size(80, 28),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            _btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            _btnBrowse.Click += OnBrowseClick;
            this.Controls.Add(_btnBrowse);

            _chkDesktop = new CheckBox
            {
                Text = "创建桌面快捷方式（Blink 灵动书签）",
                Checked = true,
                Location = new Point(28, 184),
                AutoSize = true,
                ForeColor = Color.FromArgb(226, 232, 240)
            };
            this.Controls.Add(_chkDesktop);

            _chkStartMenu = new CheckBox
            {
                Text = "添加到「开始菜单」程序列表",
                Checked = true,
                Location = new Point(28, 214),
                AutoSize = true,
                ForeColor = Color.FromArgb(226, 232, 240)
            };
            this.Controls.Add(_chkStartMenu);

            _chkLaunchNow = new CheckBox
            {
                Text = "安装完成后立即启动 Blink · 灵动书签",
                Checked = true,
                Location = new Point(28, 244),
                AutoSize = true,
                ForeColor = Color.FromArgb(226, 232, 240)
            };
            this.Controls.Add(_chkLaunchNow);

            _lblStatus = new Label
            {
                Text = "准备就绪，点击「立即安装」开始部署软件。",
                Location = new Point(28, 280),
                Size = new Size(470, 22),
                ForeColor = Color.FromArgb(148, 163, 184)
            };
            this.Controls.Add(_lblStatus);

            _progressBar = new ProgressBar
            {
                Location = new Point(28, 304),
                Size = new Size(470, 14),
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Style = ProgressBarStyle.Continuous
            };
            this.Controls.Add(_progressBar);

            _btnInstall = new Button
            {
                Text = "立即安装",
                Location = new Point(284, 330),
                Size = new Size(116, 34),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(99, 102, 241),
                ForeColor = Color.White,
                Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            _btnInstall.FlatAppearance.BorderSize = 0;
            _btnInstall.Click += OnInstallClick;
            this.Controls.Add(_btnInstall);

            _btnCancel = new Button
            {
                Text = "取消",
                Location = new Point(410, 330),
                Size = new Size(88, 34),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.FromArgb(226, 232, 240),
                Cursor = Cursors.Hand
            };
            _btnCancel.FlatAppearance.BorderSize = 0;
            _btnCancel.Click += (s, e) =>
            {
                if (!_isInstalling) this.Close();
            };
            this.Controls.Add(_btnCancel);
        }

        private void OnBrowseClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog fbd = new FolderBrowserDialog())
            {
                fbd.Description = "选择 Blink · 灵动书签 的安装目录";
                fbd.SelectedPath = _txtPath.Text;
                if (fbd.ShowDialog(this) == DialogResult.OK)
                {
                    string selected = fbd.SelectedPath;
                    if (!selected.EndsWith("Blink", StringComparison.OrdinalIgnoreCase))
                    {
                        selected = Path.Combine(selected, "Blink");
                    }
                    _txtPath.Text = selected;
                }
            }
        }

        private void OnInstallClick(object sender, EventArgs e)
        {
            if (_isInstalling) return;
            string targetDir = (_txtPath.Text ?? "").Trim();
            if (string.IsNullOrEmpty(targetDir))
            {
                MessageBox.Show(this, "请选择有效的安装路径。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _isInstalling = true;
            _txtPath.Enabled = false;
            _btnBrowse.Enabled = false;
            _chkDesktop.Enabled = false;
            _chkStartMenu.Enabled = false;
            _chkLaunchNow.Enabled = false;
            _btnInstall.Enabled = false;
            _btnCancel.Enabled = false;

            bool createDesktop = _chkDesktop.Checked;
            bool createStartMenu = _chkStartMenu.Checked;
            bool launchNow = _chkLaunchNow.Checked;

            Thread worker = new Thread(() =>
            {
                try
                {
                    Program.RunInstallation(
                        targetDir,
                        createDesktop,
                        createStartMenu,
                        (percent, statusText) =>
                        {
                            try
                            {
                                this.BeginInvoke((MethodInvoker)delegate
                                {
                                    _progressBar.Value = Math.Max(0, Math.Min(100, percent));
                                    _lblStatus.Text = statusText;
                                });
                            }
                            catch { }
                        }
                    );

                    this.BeginInvoke((MethodInvoker)delegate
                    {
                        _progressBar.Value = 100;
                        _lblStatus.Text = "安装完成！";
                        if (launchNow)
                        {
                            string blinkExe = Path.Combine(targetDir, "Blink.exe");
                            if (File.Exists(blinkExe))
                            {
                                try
                                {
                                    ProcessStartInfo psi = new ProcessStartInfo
                                    {
                                        FileName = blinkExe,
                                        WorkingDirectory = targetDir,
                                        UseShellExecute = true
                                    };
                                    Process.Start(psi);
                                }
                                catch { }
                            }
                        }
                        else
                        {
                            MessageBox.Show(this, "Blink · 灵动书签 v1.0.1 已成功安装！", "安装成功", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                        this.Close();
                    });
                }
                catch (Exception ex)
                {
                    this.BeginInvoke((MethodInvoker)delegate
                    {
                        _isInstalling = false;
                        _txtPath.Enabled = true;
                        _btnBrowse.Enabled = true;
                        _chkDesktop.Enabled = true;
                        _chkStartMenu.Enabled = true;
                        _chkLaunchNow.Enabled = true;
                        _btnInstall.Enabled = true;
                        _btnCancel.Enabled = true;
                        _lblStatus.Text = "安装出错：" + ex.Message;
                        MessageBox.Show(this, "安装过程中发生错误：\n" + ex.Message, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }
    }

    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            bool launchAfter = false;
            string customDir = null;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
                else if (string.Equals(a, "/LAUNCH", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(a, "--launch", StringComparison.OrdinalIgnoreCase))
                {
                    launchAfter = true;
                }
                else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))
                {
                    customDir = a.Substring(3).Trim('"');
                }
            }

            if (silent)
            {
                string targetDir = customDir;
                if (string.IsNullOrEmpty(targetDir))
                {
                    targetDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "Programs",
                        "Blink"
                    );
                }
                try
                {
                    if (launchAfter)
                    {
                        Thread.Sleep(1200);
                    }
                    RunInstallation(targetDir, true, true, null);
                    if (launchAfter)
                    {
                        string blinkExe = Path.Combine(targetDir, "Blink.exe");
                        if (File.Exists(blinkExe))
                        {
                            try
                            {
                                ProcessStartInfo psi = new ProcessStartInfo
                                {
                                    FileName = blinkExe,
                                    WorkingDirectory = targetDir,
                                    UseShellExecute = true
                                };
                                Process.Start(psi);
                            }
                            catch { }
                        }
                    }
                    return 0;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Silent install failed: " + ex.Message);
                    return 1;
                }
            }

            Application.Run(new InstallerForm());
            return 0;
        }

        public static void RunInstallation(
            string targetDir,
            bool createDesktopShortcut,
            bool createStartMenuShortcut,
            Action<int, string> onProgress)
        {
            if (onProgress != null) onProgress(2, "正在检查运行中的进程...");

            // Stop existing Blink / BrowserBridge process trees so no files remain locked during update
            try
            {
                foreach (string img in new[] { "Blink.exe", "BrowserBridge.exe" })
                {
                    try
                    {
                        ProcessStartInfo tk = new ProcessStartInfo
                        {
                            FileName = "taskkill.exe",
                            Arguments = "/F /IM " + img + " /T",
                            CreateNoWindow = true,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            UseShellExecute = false
                        };
                        using (Process p = Process.Start(tk))
                        {
                            if (p != null) p.WaitForExit(3000);
                        }
                    }
                    catch { }
                }

                foreach (string procName in new[] { "Blink", "BrowserBridge" })
                {
                    foreach (Process p in Process.GetProcessesByName(procName))
                    {
                        try
                        {
                            if (p.Id != Process.GetCurrentProcess().Id)
                            {
                                p.Kill();
                                p.WaitForExit(3000);
                            }
                        }
                        catch { }
                    }
                }
                Thread.Sleep(400);
            }
            catch { }

            // Clean up any leftover .old_* files from previous in-place updates
            try
            {
                if (Directory.Exists(targetDir))
                {
                    foreach (string oldFile in Directory.GetFiles(targetDir, "*.old_*", SearchOption.AllDirectories))
                    {
                        try { File.Delete(oldFile); } catch { }
                    }
                }
            }
            catch { }

            Directory.CreateDirectory(targetDir);

            // Preserve any existing user bookmark vault data before extracting update files
            byte[] portableStoreBackup = null;
            string portableStorePath = Path.Combine(targetDir, "data", "blink-store.json");
            try
            {
                if (File.Exists(portableStorePath))
                {
                    portableStoreBackup = File.ReadAllBytes(portableStorePath);
                }
            }
            catch { }

            try
            {
                string appDataVaultDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "blink-bookmarks",
                    "data"
                );
                Directory.CreateDirectory(appDataVaultDir);
                string appDataStore = Path.Combine(appDataVaultDir, "blink-store.json");
                string tempPreserve = Path.Combine(Path.GetTempPath(), "blink-vault-preserve.json");
                if (File.Exists(tempPreserve))
                {
                    FileInfo tempFi = new FileInfo(tempPreserve);
                    FileInfo appFi = File.Exists(appDataStore) ? new FileInfo(appDataStore) : null;
                    if (appFi == null || (appFi.Length <= 2500 && tempFi.Length > appFi.Length))
                    {
                        File.Copy(tempPreserve, appDataStore, true);
                        File.Copy(tempPreserve, Path.Combine(appDataVaultDir, "blink-store.backup.json"), true);
                    }
                }
            }
            catch { }

            string selfExe = Application.ExecutablePath;
            using (FileStream fs = new FileStream(selfExe, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (fs.Length < 24)
                {
                    throw new InvalidOperationException("安装包载荷校验失败（文件长度异常）。");
                }

                fs.Seek(-16, SeekOrigin.End);
                byte[] footer = new byte[16];
                int readBytes = fs.Read(footer, 0, 16);
                if (readBytes != 16)
                {
                    throw new InvalidOperationException("无法读取安装包尾部校验信息。");
                }

                long zipStartOffset = BitConverter.ToInt64(footer, 0);
                string magic = Encoding.ASCII.GetString(footer, 8, 8);
                if (magic != "BLINKSFX")
                {
                    throw new InvalidOperationException("安装包签名标识不匹配（非有效 BLINKSFX 载荷）。");
                }

                long zipLength = (fs.Length - 16) - zipStartOffset;
                if (zipStartOffset <= 0 || zipLength <= 0 || zipStartOffset + zipLength > fs.Length - 16)
                {
                    throw new InvalidOperationException("安装包压缩数据偏移量无效。");
                }

                SubStream zipStream = new SubStream(fs, zipStartOffset, zipLength);
                using (ZipArchive archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
                {
                    int total = Math.Max(1, archive.Entries.Count);
                    int current = 0;

                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        current++;
                        string relPath = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        string fullDest = Path.GetFullPath(Path.Combine(targetDir, relPath));

                        // Zip-Slip path traversal protection
                        string normalizedTarget = Path.GetFullPath(targetDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                        if (!fullDest.StartsWith(normalizedTarget, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("检测到非法压缩路径: " + entry.FullName);
                        }

                        if (string.IsNullOrEmpty(entry.Name) && entry.FullName.EndsWith("/"))
                        {
                            Directory.CreateDirectory(fullDest);
                            continue;
                        }

                        string parentDir = Path.GetDirectoryName(fullDest);
                        if (!string.IsNullOrEmpty(parentDir))
                        {
                            Directory.CreateDirectory(parentDir);
                        }

                        int pct = 5 + (int)((current * 85.0) / total);
                        if (onProgress != null)
                        {
                            onProgress(pct, "正在解压: " + entry.Name);
                        }

                        using (Stream entryStream = entry.Open())
                        {
                            FileStream outStream = null;
                            for (int attempt = 0; attempt < 10; attempt++)
                            {
                                try
                                {
                                    outStream = new FileStream(fullDest, FileMode.Create, FileAccess.Write, FileShare.None);
                                    break;
                                }
                                catch (IOException)
                                {
                                    if (attempt == 5 && File.Exists(fullDest))
                                    {
                                        try
                                        {
                                            string renamedOld = fullDest + ".old_" + Guid.NewGuid().ToString("N").Substring(0, 6);
                                            File.Move(fullDest, renamedOld);
                                        }
                                        catch { }
                                    }
                                    if (attempt == 9) throw;
                                    Thread.Sleep(300);
                                }
                            }
                            using (outStream)
                            {
                                entryStream.CopyTo(outStream);
                            }
                        }
                    }
                }
            }

            if (portableStoreBackup != null && portableStoreBackup.Length > 0)
            {
                try
                {
                    Directory.CreateDirectory(Path.Combine(targetDir, "data"));
                    File.WriteAllBytes(portableStorePath, portableStoreBackup);
                }
                catch { }
            }

            string mainExe = Path.Combine(targetDir, "Blink.exe");
            string iconFile = Path.Combine(targetDir, "resources", "app", "logo.ico");
            if (!File.Exists(iconFile))
            {
                iconFile = mainExe;
            }

            if (onProgress != null) onProgress(93, "正在创建快捷方式...");

            if (createDesktopShortcut)
            {
                string desktopLnk = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "Blink 灵动书签.lnk"
                );
                CreateShortcut(desktopLnk, mainExe, targetDir, iconFile, "Blink · 灵动书签 (AES-256 加密悬浮书签管家)");
            }

            if (createStartMenuShortcut)
            {
                string startMenuLnk = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    "Blink 灵动书签.lnk"
                );
                CreateShortcut(startMenuLnk, mainExe, targetDir, iconFile, "Blink · 灵动书签 (AES-256 加密悬浮书签管家)");
            }

            if (onProgress != null) onProgress(97, "正在注册系统卸载组件...");

            RegisterUninstaller(targetDir, mainExe, iconFile);

            if (onProgress != null) onProgress(100, "安装完成！");
        }

        private static void CreateShortcut(string lnkPath, string targetExe, string workDir, string iconPath, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                if (shortcut == null) return;
                Type scType = shortcut.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            catch { }
        }

        private static void RegisterUninstaller(string targetDir, string mainExe, string iconFile)
        {
            try
            {
                string uninstallExe = Path.Combine(targetDir, "Uninstall-Blink.exe");
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Blink"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "Blink · 灵动书签");
                        key.SetValue("DisplayVersion", "1.0.2");
                        key.SetValue("Publisher", "Blink Desktop");
                        key.SetValue("DisplayIcon", iconFile);
                        key.SetValue("InstallLocation", targetDir);
                        key.SetValue("UninstallString", "\"" + uninstallExe + "\"");
                        key.SetValue("QuietUninstallString", "\"" + uninstallExe + "\" /S");
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                        key.SetValue("EstimatedSize", 195000, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }
        }
    }
}
