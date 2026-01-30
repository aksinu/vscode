param(
    [switch]$Force
)

# ================= CONFIGURATION =================
$RepoPath = "D:\_______________Kent\vscode_build\vscode"
$BuildTargetDir = "D:\_______________Kent\vscode_build\builds"
$MaxBuildCount = 10
$BuildCommand = "npm run gulp vscode-win32-x64"
# =================================================

# 1. Start
Write-Host "[$(Get-Date)] Build process starting..." -ForegroundColor Cyan
if ($Force) { Write-Host ">>> Force build mode (-Force)" -ForegroundColor Magenta }

# 2. Git Pull
Set-Location $RepoPath
Write-Host ">>> Checking for updates (Git Pull)..." -ForegroundColor Yellow

$pullResult = git pull origin main
$isUpToDate = $pullResult -match "Already up to date"
if ($isUpToDate -and -not $Force) {
    Write-Host "[$(Get-Date)] No new changes. Skipping build." -ForegroundColor Green
    exit
}

# Clean Build
Write-Host ">>> Cleaning up workspace (git clean -fdx)..." -ForegroundColor Red
git clean -fdx

# 3. Install & Build
Write-Host ">>> New changes detected! Starting build..." -ForegroundColor Magenta
$CurrentTime = Get-Date -Format "yyyyMMdd_HHmm"
$NewBuildFolder = Join-Path $BuildTargetDir "Build_$CurrentTime"

# NPM Clean Install
Write-Host ">>> Installing dependencies (npm ci)..." -ForegroundColor Yellow
npm ci

# 4. Package build
Write-Host ">>> Packaging build (gulp vscode-win32-x64)..." -ForegroundColor Yellow

# Minification OFF (안전모드)
$Env:NODE_ENV = "development"
$Env:NODE_OPTIONS = "--max_old_space_size=8192"

Invoke-Expression $BuildCommand

# ==============================================================================
# 5. [추가된 부분] Resource Rescue (CSS/아이콘 강제 복사)
# ==============================================================================
Write-Host ">>> 🚑 Copying missing CSS/Assets..." -ForegroundColor Cyan

$RepoParentDir = Split-Path $RepoPath -Parent
$GeneratedFolder = Join-Path $RepoParentDir "VSCode-win32-x64"
$OutDir = Join-Path $GeneratedFolder "resources\app\out"

# 소스 위치: src/vs/workbench/contrib/kent/browser/media
$SrcKentPath = Join-Path $RepoPath "src\vs\workbench\contrib\kent"
$SrcMedia = Join-Path $SrcKentPath "browser\media"

# 목적지 위치: out/vs/workbench/contrib/kent/browser/media
$DestKentPath = Join-Path $OutDir "vs\workbench\contrib\kent"
$DestBrowserDir = Join-Path $DestKentPath "browser"
$DestMedia = Join-Path $DestBrowserDir "media"

if (Test-Path $SrcMedia) {
    # 폴더 구조가 없으면 생성
    if (-not (Test-Path $DestBrowserDir)) { New-Item -ItemType Directory -Force -Path $DestBrowserDir | Out-Null }

    # 복사 실행
    Copy-Item -Path "$SrcMedia" -Destination $DestBrowserDir -Recurse -Force
    Write-Host "   ✅ CSS Copied Successfully!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️ Warning: Media folder not found at $SrcMedia" -ForegroundColor Yellow
}
# ==============================================================================


# 6. Move output
if (Test-Path $GeneratedFolder) {
    Write-Host ">>> Build successful. Moving to target directory..." -ForegroundColor Green
    Move-Item -Path $GeneratedFolder -Destination $NewBuildFolder -Force
} else {
    Write-Host "!!! Error: Build failed. Output folder not found." -ForegroundColor Red
    exit
}

# 7. Cleanup old builds
$OldBuilds = @(Get-ChildItem -Path $BuildTargetDir -Directory | Sort-Object CreationTime)
$CurrentCount = $OldBuilds.Count

if ($CurrentCount -gt $MaxBuildCount) {
    $DeleteCount = $CurrentCount - $MaxBuildCount
    for ($i = 0; $i -lt $DeleteCount; $i++) {
        $ItemToDelete = $OldBuilds[$i]
        Remove-Item -Path $ItemToDelete.FullName -Recurse -Force
    }
}

Write-Host "[$(Get-Date)] All tasks completed successfully." -ForegroundColor Green
