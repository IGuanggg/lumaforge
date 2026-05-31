#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-2.0.19}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[ERROR] macOS app must be built on macOS. Use a Mac or a GitHub Actions macos runner." >&2
  exit 1
fi

echo "[1/6] Cleaning macOS build output..."
rm -rf build dist
mkdir -p releases

echo "[2/6] Installing dependencies..."
python3 -m pip install -r requirements.txt pyinstaller certifi

echo "[3/6] Building desktop app..."
python3 -m PyInstaller desktop_canvas.spec --noconfirm

if [[ ! -d "dist/LumaForge" && ! -d "dist/LumaForge.app" ]]; then
  echo "[ERROR] Desktop build failed: dist/LumaForge or dist/LumaForge.app not found." >&2
  exit 1
fi

echo "[4/6] Creating macOS zip..."
MAC_ZIP="releases/LumaForge-${VERSION}-macos.zip"
rm -f "$MAC_ZIP"
if [[ -d "dist/LumaForge.app" ]]; then
  ditto -c -k --keepParent "dist/LumaForge.app" "$MAC_ZIP"
else
  ditto -c -k --keepParent "dist/LumaForge" "$MAC_ZIP"
fi

echo "[5/6] Writing SHA256..."
shasum -a 256 "$MAC_ZIP" | tee "releases/LumaForge-${VERSION}-macos.sha256.txt"

echo "[6/6] Done."
echo "  macOS package: $MAC_ZIP"
echo ""
echo "Optional signing/notarization can be added after this step with codesign and notarytool."
