param(
    [string]$Version = "2.0.29",
    [string]$BuildId = "20260605-v2029-remove-comfyui-content1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Assert-Contains {
    param(
        [string]$Path,
        [string]$Needle
    )
    $content = Get-Content -LiteralPath $Path -Raw
    if (-not $content.Contains($Needle)) {
        throw "Expected '$Path' to contain '$Needle'"
    }
}

function Assert-NotContains {
    param(
        [string]$Path,
        [string]$Needle
    )
    $content = Get-Content -LiteralPath $Path -Raw
    if ($content.Contains($Needle)) {
        throw "Expected '$Path' to not contain stale marker '$Needle'"
    }
}

function Assert-NotStagedRuntimeData {
    $runtimeDirs = @("assets/", "output/", "data/", "userdata/", "cloud-data/", "cache/", "logs/", "releases/", "updates/")
    $status = git status --short
    foreach ($line in $status) {
        foreach ($dir in $runtimeDirs) {
            if ($line -match [regex]::Escape($dir)) {
                throw "Runtime data appears in git status: $line"
            }
        }
    }
}

Write-Host "[1/5] Checking versions and brand names..."
Assert-Contains "main.py" "APP_VERSION = os.getenv(`"APP_VERSION`", `"$Version`")"
Assert-Contains "Dockerfile" "APP_VERSION=$Version"
Assert-Contains "cloud_config_server.py" "CLOUD_APP_VERSION = os.getenv(`"CLOUD_APP_VERSION`", `"$Version`")"
Assert-Contains "Dockerfile.cloud" "ENV CLOUD_APP_VERSION=$Version"
Assert-Contains "docker-compose.cloud.yml" "lumaforge-cloud"
Assert-Contains "docker-compose.cloud.yml" "iguang9881/lumaforge-cloud"
Assert-Contains "desktop_canvas.spec" 'name="LumaForge"'
Assert-Contains "static/index.html" "LumaForge"
Assert-Contains "main.py" "APP_BUILD_ID = os.getenv(`"APP_BUILD_ID`", `"$BuildId`")"
Assert-Contains "static/index.html" "const APP_BUILD_ID = '$BuildId';"
Assert-Contains "static/canvas.html" "const CANVAS_BUILD_ID = '$BuildId';"
Assert-Contains "static/smart-canvas.html" "?v=$BuildId"
Assert-Contains "static/app-settings.html" "?v=$BuildId"

$staleBuildIds = @(
    "20260526-asset-reliability1",
    "20260529-v2014-canvas-polish1",
    "20260529-v2017-smart-storyboard-workbench1",
    "20260604-v2022-smart-canvas-polish1",
    "20260604-v2026-canvas-gesture-link-hotfix1",
    "20260604-v2026-wheel-link-hotfix1",
    "20260605-v2027-resolution-cache-hotfix1",
    "20260605-v2028-cache-nav-hotfix1"
)
$staticFiles = Get-ChildItem -LiteralPath "static" -Recurse -File | Where-Object { $_.Extension -in ".html", ".js", ".css" }
foreach ($file in $staticFiles) {
    $relative = Resolve-Path -LiteralPath $file.FullName -Relative
    foreach ($staleBuildId in $staleBuildIds) {
        Assert-NotContains $relative $staleBuildId
    }
}

Write-Host "[2/5] Checking Python syntax..."
python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py
if ($LASTEXITCODE -ne 0) {
    throw "Python syntax check failed."
}

Write-Host "[3/5] Checking key HTML script syntax when Node is available..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    node -e @"
const fs = require('fs');
const files = ['static/index.html', 'static/canvas.html', 'static/smart-canvas.html', 'static/gpt-chat.html', 'static/assets.html', 'static/enhance.html'];
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  scripts.forEach((code, i) => {
    try { new Function(code); }
    catch (err) { throw new Error(file + ' inline script #' + (i + 1) + ': ' + err.message); }
  });
}
"@
    if ($LASTEXITCODE -ne 0) {
        throw "Node HTML script syntax check failed."
    }
} else {
    Write-Host "Node not found; skipped HTML script syntax check."
}

Write-Host "[4/5] Checking git diff whitespace..."
git diff --check
if ($LASTEXITCODE -ne 0) {
    throw "git diff --check failed."
}

Write-Host "[5/5] Checking runtime data is not staged..."
Assert-NotStagedRuntimeData

Write-Host "Release check passed for LumaForge $Version."
