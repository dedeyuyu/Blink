param(
    [string]$Token = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$setupExe = Join-Path $rootDir "release\Blink-Setup-1.0.0.exe"

if (-not (Test-Path $setupExe)) {
    throw "Installer not found at $setupExe. Run scripts/build-installer.ps1 first."
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    if ($env:GITHUB_TOKEN) {
        $Token = $env:GITHUB_TOKEN.Trim()
    } else {
        $clip = Get-Clipboard -Raw -ErrorAction SilentlyContinue
        if ($clip -and $clip.Trim() -match "^(gh[pousr]_|github_pat_)") {
            $Token = $clip.Trim()
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Output "NO_GITHUB_TOKEN_AVAILABLE"
    exit 2
}

$headers = @{
    Authorization = "Bearer $Token"
    Accept        = "application/vnd.github+json"
    "User-Agent"  = "Blink-Release-Publisher"
}

Write-Host "[1/4] Pushing latest code and tag v1.0.0 to GitHub (dedeyuyu/Blink)..."
$pair = "x-access-token:" + $Token
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$authHeader = "Authorization: Basic " + $b64

Push-Location $rootDir
try {
    git add -A
    $status = git status --porcelain
    if ($status) {
        git commit -m "chore(release): v1.0.0 security hardening, Windows installer & security assessment report"
    }
    git tag -f v1.0.0
    git -c "http.extraHeader=$authHeader" push origin main
    git -c "http.extraHeader=$authHeader" push -f origin v1.0.0
} finally {
    Pop-Location
}

$fileInfo = Get-Item $setupExe
$sha256 = (Get-FileHash -Path $setupExe -Algorithm SHA256).Hash
$sizeMb = [math]::Round($fileInfo.Length / 1MB, 2)

$releaseNotes = @"
## ✨ Blink · 灵动书签 v1.0.0 正式版 (Windows x64)

一款高颜值、支持桌面置顶与迷你悬浮球缩放、多开浏览器分身精准投递的本地加密书签管家。

### 📦 安装包信息
- **安装包文件名**：``Blink-Setup-1.0.0.exe``（支持自定义安装路径、自动创建桌面与开始菜单快捷方式、自带卸载向导，也支持 ``/S`` 静默安装）
- **文件大小**：``$sizeMb MB``
- **SHA-256 校验值**：``$sha256``

### 🚀 核心特性
1. **🎯 多开浏览器分身精准直达**：基于 Windows 原生 ``IPropertyStore`` (``PKEY_AppUserModel_RelaunchCommand``) 识别 Chrome / Edge / Brave 多开分身窗口，点击书签直接在最近激活或指定的浏览器分身中新建标签页打开。
2. **🔐 全量本地加密（Scrypt + AES-256-GCM）**：主密码认证与书签库密钥分离派生，禁用 Chromium 磁盘缓存，上锁/退出时自动执行内存明文 Buffer 清零，并内置连续输错 5 次防暴破锁定机制。
3. **✨ 灵动悬浮球与置顶面板**：支持一键收缩为 76×76 桌面置顶悬浮球，随用随点展开。
4. **🎨 多彩分类归档与拖拽排序**：支持 8 色高亮标签、书签置顶、自由拖拽排序、分类夹删除（可选保留书签至全部未分类或连同书签一并删除）及 HTML 书签增量导入。
5. **🛡️ 应用层纵深安全加固**：开启 ``sandbox: true`` 渲染进程沙箱、严格 CSP 策略、预绑定并冻结 ``contextBridge`` 通信桥、严格校验 ``http/https`` 协议白名单与浏览器启动参数消毒。
"@

Write-Host "[2/4] Creating or updating GitHub Release v1.0.0..."
$releaseObj = $null
try {
    $releaseObj = Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases/tags/v1.0.0" -Headers $headers -Method Get -ErrorAction Stop
    $updatePayload = @{
        tag_name   = "v1.0.0"
        name       = "Blink · 灵动书签 v1.0.0 正式版"
        body       = $releaseNotes
        draft      = $false
        prerelease = $false
    } | ConvertTo-Json -Compress
    $releaseObj = Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases/$($releaseObj.id)" -Headers $headers -Method Patch -Body ([System.Text.Encoding]::UTF8.GetBytes($updatePayload)) -ContentType "application/json; charset=utf-8"
} catch {
    $createPayload = @{
        tag_name         = "v1.0.0"
        target_commitish = "main"
        name             = "Blink · 灵动书签 v1.0.0 正式版"
        body             = $releaseNotes
        draft            = $false
        prerelease       = $false
    } | ConvertTo-Json -Compress
    $releaseObj = Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases" -Headers $headers -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($createPayload)) -ContentType "application/json; charset=utf-8"
}

Write-Host "[3/4] Uploading Blink-Setup-1.0.0.exe ($sizeMb MB) to GitHub Release assets..."
if ($releaseObj.assets) {
    foreach ($asset in $releaseObj.assets) {
        if ($asset.name -eq "Blink-Setup-1.0.0.exe") {
            Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases/assets/$($asset.id)" -Headers $headers -Method Delete | Out-Null
        }
    }
}

$uploadBaseUrl = ($releaseObj.upload_url -replace "\{\?name,label\}$", "")
$uploadUri = "${uploadBaseUrl}?name=Blink-Setup-1.0.0.exe"
$uploadHeaders = @{
    Authorization  = "Bearer $Token"
    Accept         = "application/vnd.github+json"
    "User-Agent"   = "Blink-Release-Publisher"
}

$uploadedAsset = Invoke-RestMethod -Uri $uploadUri -Headers $uploadHeaders -Method Post -InFile $setupExe -ContentType "application/octet-stream"

Write-Host "[4/4] Release published successfully!"
Write-Host "Release URL: $($releaseObj.html_url)"
Write-Host "Download URL: $($uploadedAsset.browser_download_url)"
