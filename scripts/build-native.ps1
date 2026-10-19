$ErrorActionPreference = "Stop"
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$src = Join-Path $rootDir "src\native\BrowserBridge.cs"
$out = Join-Path $rootDir "src\native\BrowserBridge.exe"

& $csc /nologo /optimize+ /target:exe /out:$out /r:System.Management.dll /r:System.Windows.Forms.dll $src
Write-Host "Compiled BrowserBridge.exe successfully -> $out"

$launcherSrc = Join-Path $rootDir "src\native\BlinkLauncher.cs"
$exeName = "$([char]0x542F)$([char]0x52A8)Blink$([char]0x4E66)$([char]0x7B7E).exe"
$launcherOut = Join-Path $rootDir $exeName
$iconPath = Join-Path $rootDir "logo.ico"

if (Test-Path $iconPath) {
    & $csc /nologo /optimize+ /target:winexe "/win32icon:$iconPath" "/out:$launcherOut" $launcherSrc
} else {
    & $csc /nologo /optimize+ /target:winexe "/out:$launcherOut" $launcherSrc
}
Write-Host "Compiled launcher successfully -> $launcherOut"
