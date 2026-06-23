param(
    [switch]$Fast
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $unformatted = @(gofmt -l main.go config handler middleware model repository router service)
    if ($unformatted.Count -gt 0) {
        throw "Go files need gofmt:`n$($unformatted -join "`n")"
    }

    go vet ./...
    if (-not $Fast) {
        go test ./...
        python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py
        python -m unittest cloud_config_server_test.py
    }

    Push-Location (Join-Path $root "web")
    try {
        bun run typecheck
    }
    finally {
        Pop-Location
    }

    Write-Host "Quality checks passed." -ForegroundColor Green
}
finally {
    Pop-Location
}
