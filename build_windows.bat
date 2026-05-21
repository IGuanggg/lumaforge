@echo off
setlocal

echo ============================================
echo   LumaForge - Windows EXE Builder
echo ============================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+ and add to PATH.
    pause
    exit /b 1
)

REM Install dependencies
echo [1/3] Installing dependencies...
pip install -r requirements.txt pyinstaller -q
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

REM Build
echo [2/3] Building EXE with PyInstaller...
pyinstaller infinite_canvas.spec --noconfirm
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    pause
    exit /b 1
)

echo [3/3] Build complete!
echo.
echo Output: dist\LumaForge Browser\LumaForge.exe
echo.
echo To run: double-click "LumaForge.exe" in the dist folder.
echo Runtime data will be saved to "userdata\" beside the EXE.
echo.
pause
