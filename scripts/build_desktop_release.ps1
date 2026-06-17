#!/usr/bin/env pwsh
# LumaForge Desktop Release Build Script
# Usage: .\scripts\build_desktop_release.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$Version = "2.1.13"

Write-Host "[1/10] Cleaning dist and build..."
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path releases | Out-Null
New-Item -ItemType Directory -Force -Path build\v21\node | Out-Null

Write-Host "[2/10] Building v2.1 Go API server..."
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "Go not found. Install Go 1.25+ before building LumaForge v2.1 desktop."
}
go build -o build\v21\server.exe .
if (-not (Test-Path "build\v21\server.exe")) {
    throw "Go server build failed: build\v21\server.exe not found"
}
Write-Host "  OK: build\v21\server.exe"

Write-Host "[3/10] Building v2.1 Next frontend..."
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw "Bun not found. Install Bun before building LumaForge v2.1 desktop."
}
Push-Location web
try {
    bun install --frozen-lockfile
    bun run build
} finally {
    Pop-Location
}
if (-not (Test-Path "web\.next\standalone\server.js")) {
    throw "Next standalone build failed: web\.next\standalone\server.js not found"
}
$standaloneNextDir = "web\.next\standalone\.next"
$standaloneStaticDir = Join-Path $standaloneNextDir "static"
if (Test-Path "web\.next\static") {
    New-Item -ItemType Directory -Force -Path $standaloneNextDir | Out-Null
    if (Test-Path $standaloneStaticDir) {
        Remove-Item -Recurse -Force $standaloneStaticDir
    }
    Copy-Item "web\.next\static" $standaloneNextDir -Recurse -Force
}
if (Test-Path "web\public") {
    $standalonePublicDir = "web\.next\standalone\public"
    if (Test-Path $standalonePublicDir) {
        Remove-Item -Recurse -Force $standalonePublicDir
    }
    Copy-Item "web\public" "web\.next\standalone" -Recurse -Force
}
Write-Host "  OK: web\.next\standalone\server.js"

Write-Host "[4/10] Copying Node runtime..."
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw "Node.js not found. Install Node.js before building LumaForge v2.1 desktop."
}
Copy-Item $nodeCommand.Source build\v21\node\node.exe -Force
Write-Host "  OK: build\v21\node\node.exe"

Write-Host "[5/10] Building updater..."
python -m PyInstaller desktop_updater.spec --noconfirm
if (-not (Test-Path "dist\LumaForgeUpdater.exe")) {
    throw "Updater build failed: dist\LumaForgeUpdater.exe not found"
}
Write-Host "  OK: dist\LumaForgeUpdater.exe"

Write-Host "[6/10] Building desktop app..."
python -m PyInstaller desktop_canvas.spec --noconfirm
if (-not (Test-Path "dist\LumaForge\LumaForge.exe")) {
    throw "Desktop build failed: dist\LumaForge\LumaForge.exe not found"
}
Write-Host "  OK: dist\LumaForge\LumaForge.exe"

# Copy updater into dist
Copy-Item "dist\LumaForgeUpdater.exe" "dist\LumaForge\LumaForgeUpdater.exe" -Force
Write-Host "  OK: dist\LumaForge\LumaForgeUpdater.exe"

Write-Host "[7/10] Attempting code signing for desktop executables..."
& "$PSScriptRoot\sign_windows.ps1" -Version $Version -Files @("dist\LumaForge\LumaForge.exe", "dist\LumaForge\LumaForgeUpdater.exe")

Write-Host "[8/10] Creating zip..."
$zipName = "releases\LumaForge-$Version-desktop.zip"
Compress-Archive -Path "dist\LumaForge" -DestinationPath $zipName -Force
Write-Host "  OK: $zipName"

Write-Host "[9/10] Building installer (if ISCC available)..."
$iscc = $null
$paths = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
)
foreach ($p in $paths) {
    if (Test-Path $p) { $iscc = $p; break }
}
if ($iscc) {
    & $iscc "installer\LumaForge.iss"
    Write-Host "  OK: releases\LumaForge-Setup-$Version.exe"
} else {
    Write-Host "  Skip: ISCC.exe not found (install Inno Setup 6 to build installer)"
}

Write-Host "[10/10] Attempting code signing for installer..."
& "$PSScriptRoot\sign_windows.ps1" -Version $Version -Files @("releases\LumaForge-Setup-$Version.exe")

Write-Host "Build summary:"
Write-Host ""
Get-ChildItem dist\LumaForge\LumaForge*.exe | ForEach-Object {
    Write-Host "  EXE: $($_.FullName) ($([math]::Round($_.Length/1MB, 1)) MB)"
}
Get-ChildItem releases\LumaForge* | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    Write-Host "  Release: $($_.Name) ($([math]::Round($_.Length/1MB, 1)) MB)"
    Write-Host "    SHA256: $hash"
}
