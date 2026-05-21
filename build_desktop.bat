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

echo [1/3] Installing dependencies...
pip install -r requirements.txt pyinstaller -q
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo [2/3] Building desktop EXE with PyInstaller...
pyinstaller desktop_canvas.spec --noconfirm
if errorlevel 1 (
    echo [ERROR] Desktop build failed.
    pause
    exit /b 1
)

echo [3/3] Build complete!
echo.
echo Output: dist\LumaForge\LumaForge.exe
echo.
echo Desktop data:
echo   Runtime: %%APPDATA%%\LumaForge
echo   Images:  %%USERPROFILE%%\Pictures\LumaForge
echo   Logs:    %%LOCALAPPDATA%%\LumaForge\logs
echo.
pause
