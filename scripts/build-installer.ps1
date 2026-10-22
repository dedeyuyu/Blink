$ErrorActionPreference = "Stop"

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$iconPath = Join-Path $rootDir "logo.ico"
$distRoot = Join-Path $rootDir "dist"
$appDistDir = Join-Path $distRoot "Blink-win32-x64"
$releaseDir = Join-Path $rootDir "release"

Write-Host "[1/6] Compiling native binaries (BrowserBridge, Uninstaller, Installer stub)..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-native.ps1")

if (Test-Path $distRoot) {
    Remove-Item $distRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $appDistDir -Force | Out-Null
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$uninstallerSrc = Join-Path $rootDir "src\native\BlinkUninstaller.cs"
$uninstallerExe = Join-Path $appDistDir "Uninstall-Blink.exe"
& $csc /nologo /optimize+ /target:winexe "/win32icon:$iconPath" "/out:$uninstallerExe" /r:System.Windows.Forms.dll /r:System.Drawing.dll $uninstallerSrc

$installerSrc = Join-Path $rootDir "src\native\BlinkInstaller.cs"
$installerStubExe = Join-Path $distRoot "Blink-Setup-Stub.exe"
& $csc /nologo /optimize+ /target:winexe "/win32icon:$iconPath" "/out:$installerStubExe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll $installerSrc

Write-Host "[2/6] Assembling Electron runtime in $appDistDir..."
$electronDist = Join-Path $rootDir "node_modules\electron\dist"
Get-ChildItem -Path $electronDist | ForEach-Object {
    if ($_.Name -eq "locales") {
        $locDest = Join-Path $appDistDir "locales"
        New-Item -ItemType Directory -Path $locDest -Force | Out-Null
        foreach ($lang in @("zh-CN.pak", "en-US.pak")) {
            $lp = Join-Path $_.FullName $lang
            if (Test-Path $lp) {
                Copy-Item $lp -Destination (Join-Path $locDest $lang) -Force
            }
        }
    } elseif ($_.Name -eq "resources") {
        $resDest = Join-Path $appDistDir "resources"
        New-Item -ItemType Directory -Path $resDest -Force | Out-Null
    } else {
        Copy-Item $_.FullName -Destination (Join-Path $appDistDir $_.Name) -Recurse -Force
    }
}

$electronExe = Join-Path $appDistDir "electron.exe"
$blinkExe = Join-Path $appDistDir "Blink.exe"
if (Test-Path $electronExe) {
    Move-Item -Path $electronExe -Destination $blinkExe -Force
}

Write-Host "[3/6] Injecting logo.ico into Blink.exe PE resources..."
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class PeIconUpdater
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr BeginUpdateResourceW(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool UpdateResourceW(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool UpdateResourceW(IntPtr hUpdate, IntPtr lpType, string lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResourceW(IntPtr hUpdate, bool fDiscard);

    public static void ApplyIcon(string exePath, string icoPath)
    {
        byte[] icoBytes = File.ReadAllBytes(icoPath);
        if (icoBytes.Length < 6) return;
        ushort count = BitConverter.ToUInt16(icoBytes, 4);
        if (count == 0) return;

        IntPtr hUpdate = BeginUpdateResourceW(exePath, false);
        if (hUpdate == IntPtr.Zero) return;

        using (MemoryStream grpStream = new MemoryStream())
        using (BinaryWriter bw = new BinaryWriter(grpStream))
        {
            bw.Write((ushort)0);
            bw.Write((ushort)1);
            bw.Write(count);

            for (int i = 0; i < count; i++)
            {
                int entryOffset = 6 + i * 16;
                int size = BitConverter.ToInt32(icoBytes, entryOffset + 8);
                int dataOffset = BitConverter.ToInt32(icoBytes, entryOffset + 12);

                byte[] imgData = new byte[size];
                Buffer.BlockCopy(icoBytes, dataOffset, imgData, 0, size);

                ushort iconId = (ushort)(i + 1);
                UpdateResourceW(hUpdate, (IntPtr)3, (IntPtr)iconId, 1033, imgData, (uint)imgData.Length);
                UpdateResourceW(hUpdate, (IntPtr)3, (IntPtr)iconId, 0, imgData, (uint)imgData.Length);

                bw.Write(icoBytes, entryOffset, 12);
                bw.Write(iconId);
            }

            byte[] grpData = grpStream.ToArray();
            UpdateResourceW(hUpdate, (IntPtr)14, "IDR_MAINFRAME", 1033, grpData, (uint)grpData.Length);
            UpdateResourceW(hUpdate, (IntPtr)14, (IntPtr)1, 1033, grpData, (uint)grpData.Length);
            UpdateResourceW(hUpdate, (IntPtr)14, (IntPtr)1, 0, grpData, (uint)grpData.Length);
        }

        EndUpdateResourceW(hUpdate, false);
    }
}
"@

if (Test-Path $iconPath) {
    [PeIconUpdater]::ApplyIcon($blinkExe, $iconPath)
}

Write-Host "[4/6] Copying application bundle into resources/app..."
$appResDir = Join-Path $appDistDir "resources\app"
New-Item -ItemType Directory -Path $appResDir -Force | Out-Null

Copy-Item (Join-Path $rootDir "package.json") -Destination (Join-Path $appResDir "package.json") -Force
Copy-Item $iconPath -Destination (Join-Path $appResDir "logo.ico") -Force

$srcMainDest = Join-Path $appResDir "src\main"
$srcRendererDest = Join-Path $appResDir "src\renderer"
$srcNativeDest = Join-Path $appResDir "src\native"

New-Item -ItemType Directory -Path $srcMainDest -Force | Out-Null
New-Item -ItemType Directory -Path $srcRendererDest -Force | Out-Null
New-Item -ItemType Directory -Path $srcNativeDest -Force | Out-Null

Copy-Item (Join-Path $rootDir "src\main\*") -Destination $srcMainDest -Recurse -Force
Copy-Item (Join-Path $rootDir "src\renderer\*") -Destination $srcRendererDest -Recurse -Force
Copy-Item (Join-Path $rootDir "src\native\BrowserBridge.exe") -Destination (Join-Path $srcNativeDest "BrowserBridge.exe") -Force
Copy-Item (Join-Path $rootDir "src\native\BrowserBridge.cs") -Destination (Join-Path $srcNativeDest "BrowserBridge.cs") -Force

Write-Host "[5/6] Compressing application payload into payload.zip..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadZip = Join-Path $distRoot "payload.zip"
if (Test-Path $payloadZip) {
    Remove-Item $payloadZip -Force
}
[System.IO.Compression.ZipFile]::CreateFromDirectory($appDistDir, $payloadZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$pkgJson = Get-Content (Join-Path $rootDir "package.json") -Raw | ConvertFrom-Json
$pkgVer = $pkgJson.version
Write-Host "[6/6] Building self-extracting Windows installer Blink-Setup-$pkgVer.exe..."
$setupExe = Join-Path $releaseDir "Blink-Setup-$pkgVer.exe"
if (Test-Path $setupExe) {
    Remove-Item $setupExe -Force
}

$outStream = [System.IO.File]::Open($setupExe, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
    $stubBytes = [System.IO.File]::ReadAllBytes($installerStubExe)
    $outStream.Write($stubBytes, 0, $stubBytes.Length)
    $zipStartOffset = [int64]$outStream.Position

    $zipStream = [System.IO.File]::OpenRead($payloadZip)
    try {
        $zipStream.CopyTo($outStream)
    } finally {
        $zipStream.Dispose()
    }

    $offsetBytes = [System.BitConverter]::GetBytes($zipStartOffset)
    $magicBytes = [System.Text.Encoding]::ASCII.GetBytes("BLINKSFX")
    $outStream.Write($offsetBytes, 0, 8)
    $outStream.Write($magicBytes, 0, 8)
} finally {
    $outStream.Dispose()
}

$fileInfo = Get-Item $setupExe
$hash = (Get-FileHash -Path $setupExe -Algorithm SHA256).Hash
$mb = [math]::Round($fileInfo.Length / 1MB, 2)
Write-Host "====================================================="
Write-Host "Built installer successfully: $setupExe"
Write-Host "Size: $mb MB ($($fileInfo.Length) bytes)"
Write-Host "SHA256: $hash"
Write-Host "====================================================="
