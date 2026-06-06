@echo off
setlocal

echo ============================================
echo   LumaForge - Desktop Window Builder
echo ============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+ and add to PATH.
    pause
    exit /b 1
)

where pwsh >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell 7 (pwsh) not found. Install PowerShell 7 or run scripts\build_desktop_release.ps1 manually.
    pause
    exit /b 1
)

echo [1/1] Building LumaForge v2.1 desktop release...
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\build_desktop_release.ps1
if errorlevel 1 (
    echo [ERROR] Desktop release build failed.
    pause
    exit /b 1
)

echo Build complete!
echo.
echo Output: dist\LumaForge\LumaForge.exe
echo Release zip: releases\LumaForge-2.1.0-desktop.zip
echo.
echo Desktop data:
echo   Runtime: %%APPDATA%%\LumaForge
echo   Images:  %%USERPROFILE%%\Pictures\LumaForge
echo   Logs:    %%LOCALAPPDATA%%\LumaForge\logs
echo.
pause
