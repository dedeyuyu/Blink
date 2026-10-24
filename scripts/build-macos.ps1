$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $rootDir "release"
$cacheDir = Join-Path $env:LOCALAPPDATA "electron\Cache"
if (-not (Test-Path $releaseDir)) { New-Item -ItemType Directory -Path $releaseDir | Out-Null }
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }

$pkgJson = Get-Content (Join-Path $rootDir "package.json") -Raw | ConvertFrom-Json
$appVersion = $pkgJson.version
$electronVersion = "33.4.11"

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Download-ElectronMacZip {
    param([string]$Arch)
    $zipName = "electron-v$electronVersion-darwin-$Arch.zip"
    $cachedZip = Join-Path $cacheDir $zipName
    if ((Test-Path $cachedZip) -and ((Get-Item $cachedZip).Length -gt 50000000)) {
        Write-Host "Using cached $zipName ($(([math]::Round((Get-Item $cachedZip).Length / 1MB, 1))) MB)"
        return $cachedZip
    }

    $urls = @(
        "https://registry.npmmirror.com/-/binary/electron/v$electronVersion/$zipName",
        "https://github.com/electron/electron/releases/download/v$electronVersion/$zipName"
    )

    foreach ($url in $urls) {
        try {
            Write-Host "Downloading $zipName from $url ..."
            $httpClient = New-Object System.Net.Http.HttpClient
            $httpClient.Timeout = [TimeSpan]::FromMinutes(15)
            $response = $httpClient.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            if ($response.IsSuccessStatusCode) {
                $fs = [System.IO.File]::Create($cachedZip)
                try {
                    $response.Content.CopyToAsync($fs).GetAwaiter().GetResult()
                } finally {
                    $fs.Dispose()
                }
                $httpClient.Dispose()
                if ((Get-Item $cachedZip).Length -gt 50000000) {
                    Write-Host "Downloaded $zipName successfully ($(([math]::Round((Get-Item $cachedZip).Length / 1MB, 1))) MB)"
                    return $cachedZip
                }
            }
            $httpClient.Dispose()
        } catch {
            Write-Warning "Mirror failed: $($_.Exception.Message)"
        }
    }
    throw "Failed to download $zipName"
}

function Add-TextEntryUnix {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$EntryPath,
        [string]$Content,
        [int]$UnixMode = 0x81A4
    )
    $entry = $Zip.CreateEntry($EntryPath, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.ExternalAttributes = ($UnixMode -shl 16)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Content -replace "`r`n", "`n"))
    $stream = $entry.Open()
    try {
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

function Add-FileEntryUnix {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$EntryPath,
        [string]$SourceFilePath,
        [int]$UnixMode = 0x81A4
    )
    $entry = $Zip.CreateEntry($EntryPath, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.ExternalAttributes = ($UnixMode -shl 16)
    $bytes = [System.IO.File]::ReadAllBytes($SourceFilePath)
    $stream = $entry.Open()
    try {
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

$cleanStoreJson = (@(
  '{',
  '  "version": 2,',
  '  "auth": { "isInitialized": false, "salt": "", "verifier": "", "passwordHint": "" },',
  '  "settings": {',
  '    "theme": "dark",',
  '    "alwaysOnTop": true,',
  '    "autoCollapseOnBlur": true,',
  '    "keepExpanded": true,',
  '    "openMode": "auto",',
  '    "fontSize": "normal",',
  '    "cardLayout": "list",',
  '    "panelBounds": { "width": 400, "height": 650, "x": null, "y": null },',
  '    "orbPosition": { "x": null, "y": null }',
  '  },',
  '  "categories": [],',
  '  "bookmarks": [],',
  '  "encryptedVault": null',
  '}'
) -join "`n")

$installCommandScript = (@(
  '#!/bin/bash',
  'set -e',
  '',
  'DIR="$(cd "$(dirname "$0")" && pwd)"',
  'APP_SRC="$DIR/Blink.app"',
  'APP_DST="/Applications/Blink.app"',
  '',
  'echo "========================================================"',
  "echo `"  Blink v$appVersion for macOS Installer`"",
  'echo "========================================================"',
  '',
  'if [ ! -d "$APP_SRC" ]; then',
  '  echo "Error: Blink.app not found in current folder. Please extract the ZIP archive first."',
  '  read -p "Press Enter to exit..."',
  '  exit 1',
  'fi',
  '',
  'echo "[1/3] Copying Blink.app to /Applications..."',
  'rm -rf "$APP_DST" 2>/dev/null || sudo rm -rf "$APP_DST"',
  'cp -R "$APP_SRC" "$APP_DST" 2>/dev/null || sudo cp -R "$APP_SRC" "$APP_DST"',
  '',
  'echo "[2/3] Removing macOS Gatekeeper quarantine & signing app bundle..."',
  'xattr -cr "$APP_DST" 2>/dev/null || sudo xattr -cr "$APP_DST" 2>/dev/null || true',
  'codesign --force --deep --sign - "$APP_DST" 2>/dev/null || sudo codesign --force --deep --sign - "$APP_DST" 2>/dev/null || true',
  '',
  'echo "[3/3] Done! Launching Blink..."',
  'open "$APP_DST"',
  'exit 0'
) -join "`n")

$macReadme = (@(
  '============================================================',
  "  Blink v$appVersion for macOS - Installation Guide",
  '============================================================',
  '',
  '[Option 1: One-Click Install (Recommended)]',
  '1. Extract this ZIP archive on your Mac.',
  '2. Double-click "Install-Blink-Mac.command" (or right-click -> Open).',
  '   It automatically copies Blink.app to /Applications, clears macOS',
  '   Gatekeeper quarantine (xattr -cr), applies local ad-hoc signature',
  '   (codesign --force --deep --sign -), and launches Blink!',
  '',
  '[Option 2: Manual Drag-and-Drop to /Applications]',
  '1. Drag Blink.app into your /Applications folder.',
  '2. If macOS Gatekeeper prompts that the developer cannot be verified:',
  '   Open Terminal and run:',
  '   xattr -cr /Applications/Blink.app && codesign --force --deep --sign - /Applications/Blink.app && open /Applications/Blink.app',
  '',
  '[Encrypted Bookmark Vault Location on macOS]',
  '~/Library/Application Support/blink-bookmarks/data/blink-store.json'
) -join "`n")

function Build-MacBundleZip {
    param(
        [string]$Arch,
        [string]$Label
    )
    $srcElectronZipPath = Download-ElectronMacZip -Arch $Arch
    $outZipName = "Blink-MacOS-$Label-$Arch-$appVersion.zip"
    $outZipPath = Join-Path $releaseDir $outZipName
    if (Test-Path $outZipPath) { Remove-Item $outZipPath -Force }

    Write-Host "Building $outZipName ..."
    $srcFs = [System.IO.File]::OpenRead($srcElectronZipPath)
    $outFs = [System.IO.File]::Create($outZipPath)
    try {
        $srcZip = New-Object System.IO.Compression.ZipArchive($srcFs, [System.IO.Compression.ZipArchiveMode]::Read)
        $outZip = New-Object System.IO.Compression.ZipArchive($outFs, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($entry in $srcZip.Entries) {
                $fullName = $entry.FullName
                if (-not $fullName.StartsWith("Electron.app/")) {
                    continue
                }
                if ($fullName.StartsWith("Electron.app/Contents/Resources/default_app.asar")) {
                    continue
                }

                $targetEntryName = "Blink.app/" + $fullName.Substring("Electron.app/".Length)

                if ($fullName -eq "Electron.app/Contents/Resources/electron.icns") {
                    Add-FileEntryUnix -Zip $outZip -EntryPath $targetEntryName -SourceFilePath (Join-Path $rootDir "logo.icns") -UnixMode 0x81A4
                    continue
                }

                if ($fullName -eq "Electron.app/Contents/Info.plist") {
                    $sr = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
                    $plist = $sr.ReadToEnd()
                    $sr.Dispose()

                    $plist = $plist -replace '<key>CFBundleDisplayName</key>\s*<string>[^<]*</string>', "<key>CFBundleDisplayName</key>`n`t<string>Blink</string>"
                    $plist = $plist -replace '<key>CFBundleName</key>\s*<string>[^<]*</string>', "<key>CFBundleName</key>`n`t<string>Blink</string>"
                    $plist = $plist -replace '<key>CFBundleIdentifier</key>\s*<string>[^<]*</string>', "<key>CFBundleIdentifier</key>`n`t<string>com.blink.bookmark.manager</string>"
                    $plist = $plist -replace '<key>CFBundleShortVersionString</key>\s*<string>[^<]*</string>', "<key>CFBundleShortVersionString</key>`n`t<string>$appVersion</string>"
                    $plist = $plist -replace '<key>CFBundleVersion</key>\s*<string>[^<]*</string>', "<key>CFBundleVersion</key>`n`t<string>$appVersion</string>"

                    Add-TextEntryUnix -Zip $outZip -EntryPath $targetEntryName -Content $plist -UnixMode 0x81A4
                    continue
                }

                # Copy entry preserving exact ExternalAttributes (Unix symlinks 0120777 & executables 0100755!)
                $newEntry = $outZip.CreateEntry($targetEntryName, [System.IO.Compression.CompressionLevel]::Optimal)
                $newEntry.ExternalAttributes = $entry.ExternalAttributes
                $newEntry.LastWriteTime = $entry.LastWriteTime
                if (-not $fullName.EndsWith("/")) {
                    $inStream = $entry.Open()
                    $outStream = $newEntry.Open()
                    try {
                        $inStream.CopyTo($outStream)
                    } finally {
                        $outStream.Dispose()
                        $inStream.Dispose()
                    }
                }
            }

            # Inject Blink application files into Blink.app/Contents/Resources/app/
            $appPrefix = "Blink.app/Contents/Resources/app/"
            Add-FileEntryUnix -Zip $outZip -EntryPath ($appPrefix + "package.json") -SourceFilePath (Join-Path $rootDir "package.json")
            Add-FileEntryUnix -Zip $outZip -EntryPath ($appPrefix + "logo.ico") -SourceFilePath (Join-Path $rootDir "logo.ico")
            Add-FileEntryUnix -Zip $outZip -EntryPath ($appPrefix + "logo.png") -SourceFilePath (Join-Path $rootDir "logo.png")
            Add-FileEntryUnix -Zip $outZip -EntryPath ($appPrefix + "logo.icns") -SourceFilePath (Join-Path $rootDir "logo.icns")

            Get-ChildItem (Join-Path $rootDir "src\main") -File | ForEach-Object {
                Add-FileEntryUnix -Zip $outZip -EntryPath ($appPrefix + "src/main/" + $_.Name) -SourceFilePath $_.FullName
            }
            Get-ChildItem (Join-Path $rootDir "src\renderer") -File | ForEach-Object {
                Add-FileEntryUnix -Zip $outZip -EntryPath ($appPrefix + "src/renderer/" + $_.Name) -SourceFilePath $_.FullName
            }
            Add-TextEntryUnix -Zip $outZip -EntryPath ($appPrefix + "data/blink-store.json") -Content $cleanStoreJson

            # Add one-click macOS installer script (mode 0100755 = 0x81ED) & README
            Add-TextEntryUnix -Zip $outZip -EntryPath "Install-Blink-Mac.command" -Content $installCommandScript -UnixMode 0x81ED
            Add-TextEntryUnix -Zip $outZip -EntryPath "README-MacOS.txt" -Content $macReadme -UnixMode 0x81A4
        } finally {
            $outZip.Dispose()
            $srcZip.Dispose()
        }
    } finally {
        $outFs.Dispose()
        $srcFs.Dispose()
    }

    $hash = (Get-FileHash $outZipPath -Algorithm SHA256).Hash
    $sizeMb = [math]::Round((Get-Item $outZipPath).Length / 1MB, 2)
    Write-Host "Built $outZipName ($sizeMb MB) SHA256: $hash"
}

Build-MacBundleZip -Arch "arm64" -Label "AppleSilicon"
Build-MacBundleZip -Arch "x64"   -Label "Intel"
Write-Host "ALL_MAC_BUNDLES_BUILT_SUCCESSFULLY"
