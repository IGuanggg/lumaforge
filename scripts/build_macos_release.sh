#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-2.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[ERROR] macOS app must be built on macOS. Use a Mac or a GitHub Actions macos runner." >&2
  exit 1
fi

echo "[1/9] Cleaning macOS build output..."
rm -rf build dist
mkdir -p releases
mkdir -p build/v21/node

echo "[2/9] Installing Python dependencies..."
python3 -m pip install -r requirements.txt pyinstaller certifi

echo "[3/9] Building v2.1 Go API server..."
if ! command -v go >/dev/null 2>&1; then
  echo "[ERROR] Go not found. Install Go 1.25+ before building LumaForge v2.1 desktop." >&2
  exit 1
fi
go build -o build/v21/server .

echo "[4/9] Building v2.1 Next frontend..."
if ! command -v bun >/dev/null 2>&1; then
  echo "[ERROR] Bun not found. Install Bun before building LumaForge v2.1 desktop." >&2
  exit 1
fi
(cd web && bun install --frozen-lockfile && bun run build)

echo "[5/9] Copying Node runtime..."
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js before building LumaForge v2.1 desktop." >&2
  exit 1
fi
cp "$(command -v node)" build/v21/node/node
chmod +x build/v21/node/node

echo "[6/9] Building desktop app..."
python3 -m PyInstaller desktop_canvas.spec --noconfirm

if [[ ! -d "dist/LumaForge" && ! -d "dist/LumaForge.app" ]]; then
  echo "[ERROR] Desktop build failed: dist/LumaForge or dist/LumaForge.app not found." >&2
  exit 1
fi

echo "[7/9] Creating macOS zip..."
MAC_ZIP="releases/LumaForge-${VERSION}-macos.zip"
rm -f "$MAC_ZIP"
if [[ -d "dist/LumaForge.app" ]]; then
  ditto -c -k --keepParent "dist/LumaForge.app" "$MAC_ZIP"
else
  ditto -c -k --keepParent "dist/LumaForge" "$MAC_ZIP"
fi

echo "[8/9] Writing SHA256..."
shasum -a 256 "$MAC_ZIP" | tee "releases/LumaForge-${VERSION}-macos.sha256.txt"

echo "[9/9] Done."
echo "  macOS package: $MAC_ZIP"
echo ""
echo "Optional signing/notarization can be added after this step with codesign and notarytool."
