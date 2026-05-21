param(
    [string]$Version = "2.0.0"
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
Assert-Contains "static/index.html" "光绘工坊"

Write-Host "[2/5] Checking Python syntax..."
python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py

Write-Host "[3/5] Checking key HTML script syntax when Node is available..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    node -e @"
const fs = require('fs');
const files = ['static/index.html', 'static/canvas.html', 'static/gpt-chat.html', 'static/assets.html', 'static/enhance.html'];
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  scripts.forEach((code, i) => {
    try { new Function(code); }
    catch (err) { throw new Error(file + ' inline script #' + (i + 1) + ': ' + err.message); }
  });
}
"@
} else {
    Write-Host "Node not found; skipped HTML script syntax check."
}

Write-Host "[4/5] Checking git diff whitespace..."
git diff --check

Write-Host "[5/5] Checking runtime data is not staged..."
Assert-NotStagedRuntimeData

Write-Host "Release check passed for LumaForge $Version."
