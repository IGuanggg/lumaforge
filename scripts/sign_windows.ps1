#!/usr/bin/env pwsh
# LumaForge Windows Code Signing Script
# Usage: .\scripts\sign_windows.ps1
#
# Environment variables:
#   WINDOWS_SIGN_CERT_PATH      - Path to .pfx certificate file
#   WINDOWS_SIGN_CERT_PASSWORD  - Certificate password
#   WINDOWS_SIGN_TIMESTAMP_URL  - Timestamp server (default: http://timestamp.digicert.com)

param(
    [string]$CertPath = $env:WINDOWS_SIGN_CERT_PATH,
    [string]$CertPassword = $env:WINDOWS_SIGN_CERT_PASSWORD,
    [string]$TimestampUrl = $env:WINDOWS_SIGN_TIMESTAMP_URL
)

$ErrorActionPreference = "Stop"

if (-not $TimestampUrl) {
    $TimestampUrl = "http://timestamp.digicert.com"
}

# Find signtool
$signtool = $null
$sdkPaths = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
)

foreach ($sdkPath in $sdkPaths) {
    if (Test-Path $sdkPath) {
        $versions = Get-ChildItem $sdkPath -Directory | Sort-Object Name -Descending
        foreach ($v in $versions) {
            $candidate = Join-Path $v.FullName "x64\signtool.exe"
            if (Test-Path $candidate) {
                $signtool = $candidate
                break
            }
            $candidate = Join-Path $v.FullName "x86\signtool.exe"
            if (Test-Path $candidate) {
                $signtool = $candidate
                break
            }
        }
    }
    if ($signtool) { break }
}

if (-not $CertPath -or -not $CertPassword) {
    Write-Host "[sign] Signing skipped. Set WINDOWS_SIGN_CERT_PATH and WINDOWS_SIGN_CERT_PASSWORD to enable Windows code signing."
    exit 0
}

if (-not (Test-Path $CertPath)) {
    Write-Host "[sign] 证书文件不存在: $CertPath"
    exit 1
}

if (-not $signtool) {
    Write-Host "[sign] 未找到 signtool.exe，请安装 Windows SDK 或 Visual Studio"
    Write-Host "[sign] 下载地址: https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/"
    exit 1
}

Write-Host "[sign] Using signtool: $signtool"
Write-Host "[sign] Certificate: $CertPath"
Write-Host "[sign] Timestamp: $TimestampUrl"

$files = @(
    "dist\LumaForge\LumaForge.exe",
    "dist\LumaForge\LumaForgeUpdater.exe",
    "releases\LumaForge-Setup-2.0.15.exe"
)

$signed = 0
$failed = 0
foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Host "[sign] Skip (not found): $file"
        continue
    }
    Write-Host "[sign] Signing: $file"
    & $signtool sign /f $CertPath /p $CertPassword /tr $TimestampUrl /td sha256 /fd sha256 $file
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[sign] OK: $file"
        $signed++
    } else {
        Write-Host "[sign] FAILED: $file (exit code $LASTEXITCODE)"
        $failed++
    }
}

Write-Host "[sign] Done. Signed $signed file(s)."
if ($failed -gt 0) {
    exit 1
}
