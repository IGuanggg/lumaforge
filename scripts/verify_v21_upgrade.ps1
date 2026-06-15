param(
    [string]$ToolRoot = $(Join-Path $env:LOCALAPPDATA "LumaForgeDevTools"),
    [string]$RunRoot = $(Join-Path $env:TEMP ("LumaForge-v21-upgrade-" + (Get-Date -Format "yyyyMMdd-HHmmss"))),
    [int]$LegacyPort = 19029,
    [int]$ApiPort = 19081,
    [int]$WebPort = 19082,
    [switch]$SkipWeb,
    [switch]$KeepProcesses
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Resolve-Tool {
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

function Copy-TreeReadOnly {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) {
        return $false
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force -ErrorAction SilentlyContinue |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    return $true
}

function Test-VolatileSourcePath {
    param([string]$RelativePath)
    $normalized = ($RelativePath -replace "\\", "/").TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $false
    }
    foreach ($prefix in @("logs/", "cache/", "updates/", "tmp/", "temp/")) {
        if ($normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    $leaf = [System.IO.Path]::GetFileName($normalized)
    if ($leaf -in @("update_state.json")) {
        return $true
    }
    return $false
}

function Convert-ToRelativePath {
    param(
        [string]$Root,
        [string]$Path
    )
    $rootAbs = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $pathAbs = [System.IO.Path]::GetFullPath($Path)
    $uriRoot = [System.Uri]($rootAbs + [System.IO.Path]::DirectorySeparatorChar)
    $uriPath = [System.Uri]$pathAbs
    return [System.Uri]::UnescapeDataString($uriRoot.MakeRelativeUri($uriPath).ToString()).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
}

function Get-SourceSnapshot {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return [ordered]@{ exists = $false; files = 0; ignored_files = 0; latest_write_utc = ""; entries = @(); ignored_entries = @() }
    }
    $allFiles = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)
    $entries = @()
    $ignored = @()
    foreach ($file in $allFiles) {
        $relative = Convert-ToRelativePath $Path $file.FullName
        $entry = [ordered]@{
            path = $relative
            length = $file.Length
            latest_write_utc = $file.LastWriteTimeUtc.ToString("o")
        }
        if (Test-VolatileSourcePath $relative) {
            $ignored += $entry
        } else {
            $entries += $entry
        }
    }
    $entries = @($entries | Sort-Object path)
    $ignored = @($ignored | Sort-Object path)
    $latest = ""
    if ($entries.Count -gt 0) {
        $latest = ($entries | Sort-Object latest_write_utc -Descending | Select-Object -First 1).latest_write_utc
    } else {
        $latest = (Get-Item -LiteralPath $Path).LastWriteTimeUtc.ToString("o")
    }
    return [ordered]@{
        exists = $true
        files = $entries.Count
        ignored_files = $ignored.Count
        latest_write_utc = $latest
        entries = $entries
        ignored_entries = $ignored
    }
}

function Compare-SourceSnapshots {
    param(
        [object]$Before,
        [object]$After
    )
    $labels = @("runtime", "assets", "local")
    $changed = @()
    foreach ($label in $labels) {
        $beforeItem = if ($Before -is [System.Collections.IDictionary]) { $Before[$label] } else { $Before.$label }
        $afterItem = if ($After -is [System.Collections.IDictionary]) { $After[$label] } else { $After.$label }
        $beforeJson = ($beforeItem.entries | ConvertTo-Json -Compress -Depth 6)
        $afterJson = ($afterItem.entries | ConvertTo-Json -Compress -Depth 6)
        if ($beforeJson -ne $afterJson) {
            $changed += $label
        }
    }
    return [ordered]@{
        ok = ($changed.Count -eq 0)
        changed = $changed
    }
}

function Wait-Http {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $last = $null
    while ((Get-Date) -lt $deadline) {
        try {
            return Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
        } catch {
            $last = $_.Exception.Message
            Start-Sleep -Milliseconds 600
        }
    }
    throw "Timed out waiting for $Url. Last error: $last"
}

function Resolve-WebAssetUrl {
    param(
        [object]$AssetsResponse,
        [string]$WebBaseUrl
    )
    $items = @()
    if ($AssetsResponse -and $AssetsResponse.data -and $AssetsResponse.data.items) {
        $items += @($AssetsResponse.data.items)
    }
    if ($AssetsResponse -and $AssetsResponse.data -and $AssetsResponse.data.assets) {
        $items += @($AssetsResponse.data.assets)
    }
    if ($AssetsResponse -and $AssetsResponse.items) {
        $items += @($AssetsResponse.items)
    }
    if ($AssetsResponse -and $AssetsResponse.assets) {
        $items += @($AssetsResponse.assets)
    }
    foreach ($item in $items) {
        foreach ($field in "coverUrl", "cover_url", "thumb_url", "url", "local_url", "source_url") {
            $value = [string]$item.$field
            if ([string]::IsNullOrWhiteSpace($value)) {
                continue
            }
            if ($value.StartsWith("/assets/") -or $value.StartsWith("/output/")) {
                return $WebBaseUrl.TrimEnd("/") + $value
            }
            $uri = $null
            if ([System.Uri]::TryCreate($value, [System.UriKind]::Absolute, [ref]$uri)) {
                if ($uri.Host -in @("127.0.0.1", "localhost")) {
                    return $value
                }
            }
        }
    }
    return ""
}

function Start-HiddenProcess {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [string]$Stdout,
        [string]$Stderr
    )
    $options = @{
        FilePath = $FilePath
        WorkingDirectory = $WorkingDirectory
        PassThru = $true
        WindowStyle = "Hidden"
        RedirectStandardOutput = $Stdout
        RedirectStandardError = $Stderr
    }
    if ($ArgumentList -and $ArgumentList.Count -gt 0) {
        $options.ArgumentList = $ArgumentList
    }
    return Start-Process @options
}

$goExe = Resolve-Tool "go"
$bunExe = Resolve-Tool "bun" @("bun-v1.3.13\bun.exe")
$nodeExe = Resolve-Tool "node"
$pythonExe = Resolve-Tool "python"
$playwrightRoot = Join-Path $ToolRoot "playwright"
$browserRoot = Join-Path $ToolRoot "playwright-browsers"

if (-not $goExe) { throw "Go 1.25.x not found under PATH or $ToolRoot." }
if (-not $pythonExe) { throw "Python not found." }
if (-not $SkipWeb -and -not $bunExe) { throw "Bun not found under PATH or $ToolRoot\bun-v1.3.13." }
if (-not $SkipWeb -and -not $nodeExe) { throw "Node.js not found." }
if (-not $SkipWeb -and -not (Test-Path -LiteralPath (Join-Path $playwrightRoot "node_modules\@playwright\test"))) {
    throw "Playwright not found under $playwrightRoot."
}
if (-not $SkipWeb -and -not (Test-Path -LiteralPath $browserRoot)) {
    throw "Playwright browsers not found under $browserRoot."
}

$sourceRuntime = Join-Path $env:APPDATA "LumaForge"
$sourceAssets = Join-Path ([Environment]::GetFolderPath("MyPictures")) "LumaForge"
$sourceLocal = Join-Path $env:LOCALAPPDATA "LumaForge"
$runtimeCopy = Join-Path $RunRoot "runtime"
$assetsCopy = Join-Path $RunRoot "assets"
$localCopy = Join-Path $RunRoot "localappdata"
$logs = Join-Path $RunRoot "logs"
$screenshots = Join-Path $RunRoot "screenshots"
New-Item -ItemType Directory -Force -Path $RunRoot, $runtimeCopy, $assetsCopy, $localCopy, $logs, $screenshots | Out-Null

$before = [ordered]@{
    runtime = Get-SourceSnapshot $sourceRuntime
    assets = Get-SourceSnapshot $sourceAssets
    local = Get-SourceSnapshot $sourceLocal
}

$copied = [ordered]@{
    runtime = Copy-TreeReadOnly $sourceRuntime $runtimeCopy
    assets = Copy-TreeReadOnly $sourceAssets $assetsCopy
    local = Copy-TreeReadOnly $sourceLocal $localCopy
}

$serverExe = Join-Path $RunRoot "server.exe"
& $goExe build -o $serverExe .
if ($LASTEXITCODE -ne 0) {
    throw "Go server build failed."
}

$processes = @()
$oldEnv = @{}
foreach ($key in "APP_RUNTIME_DIR","APP_ASSETS_DIR","APP_OUTPUT_DIR","APP_LOG_DIR","APP_CACHE_DIR","LOCALAPPDATA","APP_PORT","PORT","LUMAFORGE_DATA_DIR","LUMAFORGE_LEGACY_API_URL","API_BASE_URL","HOSTNAME","PLAYWRIGHT_BROWSERS_PATH") {
    $oldEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}

try {
    $env:APP_RUNTIME_DIR = $runtimeCopy
    $env:APP_ASSETS_DIR = $assetsCopy
    $env:APP_OUTPUT_DIR = Join-Path $assetsCopy "legacy-output"
    $env:APP_LOG_DIR = $logs
    $env:APP_CACHE_DIR = Join-Path $localCopy "cache"
    $env:LOCALAPPDATA = $localCopy
    $env:APP_PORT = [string]$LegacyPort
    $legacy = Start-HiddenProcess $pythonExe @("main.py") $root (Join-Path $logs "legacy.out.log") (Join-Path $logs "legacy.err.log")
    $processes += $legacy
    Wait-Http "http://127.0.0.1:$LegacyPort/health" 90 | Out-Null

    $env:PORT = [string]$ApiPort
    $env:LUMAFORGE_DATA_DIR = $runtimeCopy
    $env:LUMAFORGE_LEGACY_API_URL = "http://127.0.0.1:$LegacyPort"
    $api = Start-HiddenProcess $serverExe @() $root (Join-Path $logs "go.out.log") (Join-Path $logs "go.err.log")
    $processes += $api
    Wait-Http "http://127.0.0.1:$ApiPort/api/health" 90 | Out-Null

    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/migration/v21/status"
    $import = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/migration/v21/import" -Method POST
    $assets = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/assets?limit=5"
    $providers = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/providers"
    $reportPath = Join-Path $runtimeCopy "migration-2.1.0.json"
    if (-not (Test-Path -LiteralPath $reportPath)) {
        throw "Migration report was not written: $reportPath"
    }

    $webOk = $false
    if (-not $SkipWeb) {
        $nextEnvPath = Join-Path $root "web\next-env.d.ts"
        $nextEnvBefore = if (Test-Path -LiteralPath $nextEnvPath) { [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $nextEnvPath)) } else { $null }
        Push-Location web
        try {
            & $bunExe install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { throw "bun install failed." }
            & $bunExe run build
            if ($LASTEXITCODE -ne 0) { throw "bun run build failed." }
        } finally {
            Pop-Location
            if ($null -ne $nextEnvBefore) {
                [System.IO.File]::WriteAllBytes((Resolve-Path -LiteralPath $nextEnvPath), $nextEnvBefore)
            }
        }

        $standalone = Join-Path $root "web\.next\standalone\server.js"
        if (-not (Test-Path -LiteralPath $standalone)) {
            $standalone = Join-Path $root "web\.next\standalone\web\server.js"
        }
        if (-not (Test-Path -LiteralPath $standalone)) {
            throw "Next standalone server.js not found."
        }
        $standaloneDir = Split-Path -Parent $standalone
        $staticSource = Join-Path $root "web\.next\static"
        $staticTarget = Join-Path $standaloneDir ".next\static"
        if (Test-Path -LiteralPath $staticSource) {
            if (Test-Path -LiteralPath $staticTarget) {
                Remove-Item -LiteralPath $staticTarget -Recurse -Force
            }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $staticTarget) | Out-Null
            Copy-Item -LiteralPath $staticSource -Destination (Split-Path -Parent $staticTarget) -Recurse -Force
        }
        $publicSource = Join-Path $root "web\public"
        $publicTarget = Join-Path $standaloneDir "public"
        if (Test-Path -LiteralPath $publicSource) {
            if (Test-Path -LiteralPath $publicTarget) {
                Remove-Item -LiteralPath $publicTarget -Recurse -Force
            }
            Copy-Item -LiteralPath $publicSource -Destination $standaloneDir -Recurse -Force
        }
        $env:API_BASE_URL = "http://127.0.0.1:$ApiPort"
        $env:PORT = [string]$WebPort
        $env:HOSTNAME = "127.0.0.1"
        $web = Start-HiddenProcess $nodeExe @($standalone) $standaloneDir (Join-Path $logs "web.out.log") (Join-Path $logs "web.err.log")
        $processes += $web
        Wait-Http "http://127.0.0.1:$WebPort/" 90 | Out-Null
        $sampleAssetUrl = Resolve-WebAssetUrl $assets "http://127.0.0.1:$WebPort"
        if ($sampleAssetUrl) {
            $assetResponse = Invoke-WebRequest -UseBasicParsing -Uri $sampleAssetUrl -TimeoutSec 20
            $contentType = [string]$assetResponse.Headers["Content-Type"]
            if ($assetResponse.StatusCode -ge 400 -or -not $contentType.StartsWith("image/", [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Local asset image did not load through Next proxy: $sampleAssetUrl ($($assetResponse.StatusCode), $contentType)"
            }
        }

        $env:PLAYWRIGHT_BROWSERS_PATH = $browserRoot
        $pwScript = Join-Path $RunRoot "playwright-smoke.cjs"
        @"
const { chromium } = require(process.env.LUMAFORGE_PLAYWRIGHT_MODULE);
const base = process.env.LUMAFORGE_WEB_URL;
const out = process.env.LUMAFORGE_SCREENSHOT_DIR;
async function canvasStoreSnapshot(page) {
  return await page.evaluate(async () => {
    const raw = await new Promise((resolve, reject) => {
      const open = indexedDB.open('infinite-canvas');
      open.onerror = () => reject(open.error || new Error('open indexedDB failed'));
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('app_state')) {
          resolve(null);
          db.close();
          return;
        }
        const tx = db.transaction('app_state', 'readonly');
        const store = tx.objectStore('app_state');
        const get = store.get('infinite-canvas:canvas_store');
        get.onerror = () => reject(get.error || new Error('read canvas store failed'));
        get.onsuccess = () => {
          resolve(get.result || null);
          db.close();
        };
      };
    });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const projects = parsed?.state?.projects || [];
    const legacyIds = projects.map((project) => project?.metadata?.legacyId).filter(Boolean);
    return {
      projectCount: projects.length,
      legacyIds,
      uniqueLegacyIds: Array.from(new Set(legacyIds)),
    };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  for (const [name, path] of [['home','/'], ['login','/login'], ['canvas','/canvas'], ['assets','/asset-library'], ['api-settings','/api-settings'], ['app-settings','/app-settings']]) {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
    if ((await page.content()).includes('Linux.do')) throw new Error(name + ' still contains Linux.do');
    if (name === 'canvas') {
      await page.waitForTimeout(1400);
      const before = await canvasStoreSnapshot(page);
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1400);
      const after = await canvasStoreSnapshot(page);
      if (after.legacyIds.length !== after.uniqueLegacyIds.length) throw new Error('Duplicate migrated legacy canvas ids after reload');
      if (before.projectCount !== after.projectCount) throw new Error('Canvas project count changed after reload: ' + before.projectCount + ' -> ' + after.projectCount);
    }
    if (name === 'assets') {
      await page.waitForTimeout(1000);
      const broken = await page.evaluate(() => Array.from(document.images)
        .filter((img) => img.src.includes('/assets/') || img.src.includes('/output/'))
        .filter((img) => !img.complete || img.naturalWidth <= 0)
        .map((img) => img.src));
      if (broken.length) throw new Error('Broken local asset image(s): ' + broken.join(', '));
    }
    await page.screenshot({ path: out + '/' + name + '.png', fullPage: true });
  }
  await browser.close();
})();
"@ | Set-Content -LiteralPath $pwScript -Encoding UTF8
        Push-Location $playwrightRoot
        try {
            $env:LUMAFORGE_WEB_URL = "http://127.0.0.1:$WebPort"
            $env:LUMAFORGE_SCREENSHOT_DIR = $screenshots
            $env:LUMAFORGE_PLAYWRIGHT_MODULE = Join-Path $playwrightRoot "node_modules\playwright"
            & $nodeExe $pwScript
            if ($LASTEXITCODE -ne 0) { throw "Playwright smoke failed." }
        } finally {
            Pop-Location
        }
        $webOk = $true
    }

    $after = [ordered]@{
        runtime = Get-SourceSnapshot $sourceRuntime
        assets = Get-SourceSnapshot $sourceAssets
        local = Get-SourceSnapshot $sourceLocal
    }
    $sourceCompare = Compare-SourceSnapshots $before $after
    $sourceUnchanged = [bool]$sourceCompare.ok
    if (-not $sourceUnchanged) {
        throw "Source data snapshot changed during verification: $($sourceCompare.changed -join ', ')."
    }

    $summary = [ordered]@{
        ok = $true
        run_root = $RunRoot
        copied = $copied
        source_unchanged = $sourceUnchanged
        source_snapshot = [ordered]@{
            before = $before
            after = $after
            compare = $sourceCompare
        }
        legacy_url = "http://127.0.0.1:$LegacyPort"
        api_url = "http://127.0.0.1:$ApiPort"
        web_url = if ($SkipWeb) { "" } else { "http://127.0.0.1:$WebPort" }
        migration_status = $status.data
        migration_import = $import.data
        asset_total = $assets.data.total
        provider_count = @($providers.data).Count
        web_smoke = $webOk
        sample_asset_url = if ($webOk) { $sampleAssetUrl } else { "" }
        screenshots_dir = if ($webOk) { $screenshots } else { "" }
    }
    $summaryPath = Join-Path $RunRoot "upgrade-verification-summary.json"
    $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    Write-Host "v2.1 upgrade verification passed."
    Write-Host "Summary: $summaryPath"
    if ($webOk) {
        Write-Host "Screenshots: $screenshots"
    }
} finally {
    foreach ($key in $oldEnv.Keys) {
        [Environment]::SetEnvironmentVariable($key, $oldEnv[$key], "Process")
    }
    if (-not $KeepProcesses) {
        foreach ($process in $processes) {
            if ($process -and -not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
