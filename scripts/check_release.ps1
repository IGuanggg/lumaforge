param(
    [string]$Version = "2.1.5",
    [string]$BuildId = "20260609-v215-canvas-migration-links1",
    [string]$ToolRoot = $(Join-Path $env:LOCALAPPDATA "LumaForgeDevTools")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Assert-Contains {
    param(
        [string]$Path,
        [string]$Needle
    )
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if (-not $content.Contains($Needle)) {
        throw "Expected '$Path' to contain '$Needle'"
    }
}

function Assert-NotContains {
    param(
        [string]$Path,
        [string]$Needle
    )
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($content.Contains($Needle)) {
        throw "Expected '$Path' to not contain stale marker '$Needle'"
    }
}

function Assert-NotStagedRuntimeData {
    $runtimeDirs = @("assets/", "output/", "data/", "userdata/", "cloud-data/", "cache/", "logs/", "releases/", "updates/")
    $status = git status --short
    foreach ($line in $status) {
        if ($line.Length -lt 4) {
            continue
        }
        $path = $line.Substring(3).Trim()
        if ($path.Contains(" -> ")) {
            $path = ($path -split " -> ")[-1].Trim()
        }
        $path = $path.Replace("\", "/")
        foreach ($dir in $runtimeDirs) {
            if ($path.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Runtime data appears in git status: $line"
            }
        }
    }
}

function Resolve-DevTool {
    param(
        [string]$Name,
        [string[]]$PortableCandidates = @()
    )
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    foreach ($candidate in $PortableCandidates) {
        $path = Join-Path $ToolRoot $candidate
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }
    if ($Name -eq "go") {
        $goDir = Get-ChildItem -LiteralPath $ToolRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "go1.25.*" } |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($goDir) {
            $path = Join-Path $goDir.FullName "bin\go.exe"
            if (Test-Path -LiteralPath $path) {
                return $path
            }
        }
    }
    return $null
}

$GoExe = Resolve-DevTool "go"
$BunExe = Resolve-DevTool "bun" @("bun-v1.3.13\bun.exe")

Write-Host "[1/5] Checking versions and brand names..."
Assert-Contains "main.py" "APP_VERSION = os.getenv(`"APP_VERSION`", `"$Version`")"
Assert-Contains "Dockerfile" "APP_VERSION=$Version"
Assert-Contains "cloud_config_server.py" "CLOUD_APP_VERSION = os.getenv(`"CLOUD_APP_VERSION`", `"$Version`")"
Assert-Contains "Dockerfile.cloud" "ENV CLOUD_APP_VERSION=$Version"
Assert-Contains "VERSION" $Version
Assert-Contains "service/lumaforge.go" "LumaForgeVersion = `"$Version`""
Assert-Contains "service/lumaforge.go" "LumaForgeBuildID = `"$BuildId`""
Assert-Contains "web/package.json" "`"version`": `"$Version`""
Assert-Contains "Dockerfile.v21" "COPY CHANGELOG.md /app/CHANGELOG.md"
Assert-Contains "installer/LumaForge.iss" "#define MyAppVersion `"$Version`""
Assert-Contains "CHANGELOG.md" "v$Version"
Assert-Contains "docker-compose.cloud.yml" "lumaforge-cloud"
Assert-Contains "docker-compose.cloud.yml" "iguang9881/lumaforge-cloud"
Assert-Contains "desktop_canvas.spec" 'name="LumaForge"'
Assert-Contains "static/index.html" "LumaForge"
Assert-Contains "main.py" "APP_BUILD_ID = os.getenv(`"APP_BUILD_ID`", `"$BuildId`")"
Assert-Contains "main.py" "IMAGE_MODEL = os.getenv(`"IMAGE_MODEL`", `"gpt-image-2-vip`")"
Assert-Contains "main.py" 'IMAGE_MODELS = model_list("IMAGE_MODELS", IMAGE_MODEL, ["gpt-image-2", "nano-banana-pro"])'
Assert-Contains "web/src/stores/use-config-store.ts" "imageModel: `"gpt-image-2-vip`""
Assert-Contains "web/src/hooks/use-version-check.ts" "/api/app/update-check"
Assert-NotContains "web/src/hooks/use-version-check.ts" "https://raw.githubusercontent.com/IGuanggg/lumaforge/main/VERSION"
Assert-Contains "web/src/components/layout/github-link.tsx" "https://github.com/IGuanggg/lumaforge"
Assert-Contains "web/src/constant/env.ts" "https://github.com/IGuanggg/lumaforge#readme"
Assert-Contains "static/index.html" "const APP_BUILD_ID = '$BuildId';"
Assert-Contains "static/canvas.html" "const CANVAS_BUILD_ID = '$BuildId';"
Assert-Contains "static/smart-canvas.html" "?v=$BuildId"
Assert-Contains "static/app-settings.html" "?v=$BuildId"
Assert-Contains "router/router.go" 'api.POST("/auth/register", gin.WrapF(handler.LumaAuthRegister))'
Assert-Contains "router/router.go" 'api.POST("/auth/login", gin.WrapF(handler.LumaAuthLogin))'
Assert-Contains "router/router.go" 'api.GET("/auth/me", gin.WrapF(handler.LumaCurrentUser))'
Assert-NotContains "router/router.go" 'api.POST("/auth/register", gin.WrapF(handler.Register))'
Assert-NotContains "router/router.go" 'api.POST("/auth/login", gin.WrapF(handler.Login))'
Assert-NotContains "router/router.go" "/auth/linux-do"
Assert-Contains "router/router.go" 'api.GET("/migration/v21/status", gin.WrapF(handler.LumaMigrationStatus))'
Assert-Contains "router/router.go" 'api.POST("/migration/v21/import", gin.WrapF(handler.LumaMigrationImport))'
Assert-Contains "service/migration.go" "migration-2.1.0.json"
Assert-Contains "web/src/components/layout/client-root-init.tsx" "lumaforge:v21_migration_done"
Assert-Contains "middleware/admin.go" "service.LumaCurrentAuthUser(token)"
Assert-Contains "config/config.go" "LumaForgeCloudURL"
Assert-Contains "RELEASE_NOTES_v$Version.md" "旧版本用户升级"
Assert-Contains "docs/HANDOFF.md" "Old-version compatibility requirements"
Assert-Contains "desktop_updater.py" "PROTECT_NAMES"
Assert-Contains "desktop_updater.py" "`"data`""
Assert-Contains "desktop_updater.py" "`"cloud-data`""
Assert-Contains "desktop_updater.py" "`"userdata`""
Assert-Contains "desktop_updater.py" "`"assets`""
Assert-Contains "scripts/verify_v21_upgrade.ps1" "migration-2.1.0.json"
Assert-Contains "scripts/verify_v21_upgrade.ps1" "source_unchanged"
Assert-Contains "scripts/verify_v21_upgrade.ps1" "PLAYWRIGHT_BROWSERS_PATH"
Assert-Contains "web/src/services/api/providers.ts" "fetchProviders"
Assert-Contains "web/src/app/(user)/api-settings/page.tsx" "fetchProviders"
Assert-NotContains "web/src/app/(user)/api-settings/page.tsx" "<iframe"
Assert-Contains "service/settings.go" "enabledProviderModelGroups"
Assert-Contains "web/src/app/(admin)/admin/settings/page.tsx" "API 平台和模型请到 API 设置维护"
Assert-NotContains "web/src/app/(admin)/admin/settings/page.tsx" 'label: "私有配置'
Assert-NotContains "web/src/app/(admin)/admin/settings/page.tsx" "availableModels = collectChannelModels"

$staleBuildIds = @(
    "20260526-asset-reliability1",
    "20260529-v2014-canvas-polish1",
    "20260529-v2017-smart-storyboard-workbench1",
    "20260604-v2022-smart-canvas-polish1",
    "20260604-v2026-canvas-gesture-link-hotfix1",
    "20260604-v2026-wheel-link-hotfix1",
    "20260605-v2027-resolution-cache-hotfix1",
    "20260605-v2028-cache-nav-hotfix1",
    "20260605-v2029-remove-comfyui-content1"
)
$staticFiles = Get-ChildItem -LiteralPath "static" -Recurse -File | Where-Object { $_.Extension -in ".html", ".js", ".css" }
foreach ($file in $staticFiles) {
    $relative = Resolve-Path -LiteralPath $file.FullName -Relative
    foreach ($staleBuildId in $staleBuildIds) {
        Assert-NotContains $relative $staleBuildId
    }
}

$linuxDoHits = rg -n "Linux\.do|linux-do|linuxdo|LinuxDO" web/src static router/router.go --glob "!static/vendor/**" 2>$null
if ($LASTEXITCODE -eq 0) {
    throw "Linux.do visible product references remain:`n$linuxDoHits"
}
if ($LASTEXITCODE -gt 1) {
    throw "Linux.do scan failed."
}

Write-Host "[2/5] Checking Python syntax..."
python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py
if ($LASTEXITCODE -ne 0) {
    throw "Python syntax check failed."
}

Write-Host "[2b/5] Checking Go and Next when toolchains are available..."
if ($GoExe) {
    & $GoExe test ./...
    if ($LASTEXITCODE -ne 0) {
        throw "go test ./... failed."
    }
} else {
    Write-Host "Go not found; skipped go test ./..."
}
if ($BunExe -and (Test-Path "web\bun.lock")) {
    $nextEnvPath = "web\next-env.d.ts"
    $nextEnvBefore = if (Test-Path $nextEnvPath) { [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $nextEnvPath)) } else { $null }
    Push-Location web
    try {
        & $BunExe run build
        if ($LASTEXITCODE -ne 0) {
            throw "bun run build failed."
        }
    } finally {
        Pop-Location
        if ($null -ne $nextEnvBefore) {
            [System.IO.File]::WriteAllBytes((Resolve-Path -LiteralPath $nextEnvPath), $nextEnvBefore)
        }
    }
} else {
    Write-Host "Bun not found; skipped bun run build."
}

Write-Host "[3/5] Checking key HTML script syntax when Node is available..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    node scripts/check_html_scripts.cjs
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
