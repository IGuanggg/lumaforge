# Build desktop window edition with:
#   pyinstaller desktop_canvas.spec --noconfirm

import os
import certifi
from PyInstaller.utils.hooks import collect_submodules


block_cipher = None

updater_datas = []
if os.path.isfile("dist/LumaForgeUpdater.exe"):
    updater_datas.append(("dist/LumaForgeUpdater.exe", "."))

datas = [
    ("static", "static"),
    ("workflows", "workflows"),
    (certifi.where(), "certifi"),
] + updater_datas

if os.path.isfile("build/v21/server.exe"):
    datas.append(("build/v21/server.exe", "v21"))
if os.path.isfile("build/v21/server"):
    datas.append(("build/v21/server", "v21"))
if os.path.isdir("build/v21/node"):
    datas.append(("build/v21/node", "node"))
if os.path.isdir("web/.next/standalone"):
    datas.append(("web/.next/standalone", "web"))
if os.path.isdir("web/.next/static"):
    datas.append(("web/.next/static", "web/.next/static"))
if os.path.isdir("web/public"):
    datas.append(("web/public", "web/public"))

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + collect_submodules("httpx")
    + collect_submodules("webview")
    + ["PIL", "PIL.Image", "PIL.JpegImagePlugin", "PIL.PngImagePlugin", "PIL.WebPImagePlugin"]
)

a = Analysis(
    ["desktop_launcher.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=["runtime_hook_ssl_cert.py"],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LumaForge",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="static/logo.ico",
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="LumaForge",
)
