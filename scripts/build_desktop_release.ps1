#!/usr/bin/env pwsh
# LumaForge Desktop Release Build Script
# Usage: .\scripts\build_desktop_release.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$Version = "2.0.12"

Write-Host "[1/8] Cleaning dist and build..."
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force build -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path releases | Out-Null

Write-Host "[2/8] Building updater..."
python -m PyInstaller desktop_updater.spec --noconfirm
if (-not (Test-Path "dist\LumaForgeUpdater.exe")) {
    throw "Updater build failed: dist\LumaForgeUpdater.exe not found"
}
Write-Host "  OK: dist\LumaForgeUpdater.exe"

Write-Host "[3/8] Building desktop app..."
python -m PyInstaller desktop_canvas.spec --noconfirm
if (-not (Test-Path "dist\LumaForge\LumaForge.exe")) {
    throw "Desktop build failed: dist\LumaForge\LumaForge.exe not found"
}
Write-Host "  OK: dist\LumaForge\LumaForge.exe"

# Copy updater into dist
Copy-Item "dist\LumaForgeUpdater.exe" "dist\LumaForge\LumaForgeUpdater.exe" -Force
Write-Host "  OK: dist\LumaForge\LumaForgeUpdater.exe"

Write-Host "[4/8] Attempting code signing for desktop executables..."
& "$PSScriptRoot\sign_windows.ps1"

Write-Host "[5/8] Creating zip..."
$zipName = "releases\LumaForge-$Version-desktop.zip"
Compress-Archive -Path "dist\LumaForge" -DestinationPath $zipName -Force
Write-Host "  OK: $zipName"

Write-Host "[6/8] Building installer (if ISCC available)..."
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

Write-Host "[7/8] Attempting code signing for installer..."
& "$PSScriptRoot\sign_windows.ps1"

Write-Host "[8/8] Build summary:"
Write-Host ""
Get-ChildItem dist\LumaForge\LumaForge*.exe | ForEach-Object {
    Write-Host "  EXE: $($_.FullName) ($([math]::Round($_.Length/1MB, 1)) MB)"
}
Get-ChildItem releases\LumaForge* | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    Write-Host "  Release: $($_.Name) ($([math]::Round($_.Length/1MB, 1)) MB)"
    Write-Host "    SHA256: $hash"
}
