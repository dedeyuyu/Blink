param(
    [string]$Token = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pkgJson = Get-Content (Join-Path $rootDir "package.json") -Raw | ConvertFrom-Json
$pkgVer = $pkgJson.version
$tagName = "v$pkgVer"
$exeFileName = "Blink-Setup-$pkgVer.exe"
$setupExe = Join-Path $rootDir "release\$exeFileName"

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

Write-Host "[1/4] Pushing latest code and tag $tagName to GitHub (dedeyuyu/Blink)..."
$pair = "x-access-token:" + $Token
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$authHeader = "Authorization: Basic " + $b64

Push-Location $rootDir
try {
    git add -A
    $status = git status --porcelain
    if ($status) {
        git commit -m "feat(release): $tagName category & bookmark drag sorting, version badge, and GitHub auto-update"
    }
    git tag -f $tagName
    git -c "http.extraHeader=$authHeader" push origin main
    git -c "http.extraHeader=$authHeader" push -f origin $tagName
} finally {
    Pop-Location
}

$fileInfo = Get-Item $setupExe
$sha256 = (Get-FileHash -Path $setupExe -Algorithm SHA256).Hash
$sizeMb = [math]::Round($fileInfo.Length / 1MB, 2)

$releaseNotes = @"
## ✨ Blink · 灵动书签 $tagName 正式版 (Windows x64)

### 🆕 $tagName 更新内容
1. **↔️ 分类标签随时左右拖动排序**：顶部各个分类夹支持随时按住鼠标左右拖动调整顺序，松手自动保存，同时在「分类管理」弹窗中也支持一键上移/下移调整顺序。
2. **↕️ 开启「整理」后书签上下拖拽挪动**：开启「整理」模式后，按住任意书签卡片即可直接上下流畅拖拽调整顺序（或拖入上方分类夹归类），且整理模式下点击书签不会误打开网页；日常未开启「整理」时禁止拖拽，彻底防止日常点击时误拖或误触。
3. **🏷️ 顶部版本号标识 (`$tagName`)**：软件标题栏新增显眼版本号徽章，点击即可检测新版本。
4. **🔄 GitHub 在线检测更新与无损一键升级**：内置与 GitHub Releases 对接的在线检测与一键下载更新功能，更新前执行多重加密书签库自动备份与跨目录同步，**100% 确保升级后原有书签与密码零丢失**。

### 📦 安装包信息
- **安装包文件名**：``$exeFileName``
- **文件大小**：``$sizeMb MB``
- **SHA-256 校验值**：``$sha256``
"@

Write-Host "[2/4] Creating or updating GitHub Release $tagName..."
$releaseObj = $null
try {
    $releaseObj = Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases/tags/$tagName" -Headers $headers -Method Get -ErrorAction Stop
    $updatePayload = @{
        tag_name   = $tagName
        name       = "Blink · 灵动书签 $tagName 正式版"
        body       = $releaseNotes
        draft      = $false
        prerelease = $false
    } | ConvertTo-Json -Compress
    $releaseObj = Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases/$($releaseObj.id)" -Headers $headers -Method Patch -Body ([System.Text.Encoding]::UTF8.GetBytes($updatePayload)) -ContentType "application/json; charset=utf-8"
} catch {
    $createPayload = @{
        tag_name         = $tagName
        target_commitish = "main"
        name             = "Blink · 灵动书签 $tagName 正式版"
        body             = $releaseNotes
        draft            = $false
        prerelease       = $false
    } | ConvertTo-Json -Compress
    $releaseObj = Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases" -Headers $headers -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($createPayload)) -ContentType "application/json; charset=utf-8"
}

Write-Host "[3/4] Uploading $exeFileName ($sizeMb MB) to GitHub Release assets..."
if ($releaseObj.assets) {
    foreach ($asset in $releaseObj.assets) {
        if ($asset.name -eq $exeFileName) {
            Invoke-RestMethod -Uri "https://api.github.com/repos/dedeyuyu/Blink/releases/assets/$($asset.id)" -Headers $headers -Method Delete | Out-Null
        }
    }
}

$uploadBaseUrl = ($releaseObj.upload_url -replace "\{\?name,label\}$", "")
$uploadUri = "${uploadBaseUrl}?name=$exeFileName"
$uploadHeaders = @{
    Authorization  = "Bearer $Token"
    Accept         = "application/vnd.github+json"
    "User-Agent"   = "Blink-Release-Publisher"
}

$uploadedAsset = Invoke-RestMethod -Uri $uploadUri -Headers $uploadHeaders -Method Post -InFile $setupExe -ContentType "application/octet-stream"

Write-Host "[4/4] Release published successfully!"
Write-Host "Release URL: $($releaseObj.html_url)"
Write-Host "Download URL: $($uploadedAsset.browser_download_url)"
