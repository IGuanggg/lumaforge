# LumaForge 打包与部署

目标版本：`2.1.0`

## 桌面窗口版

```powershell
.\build_desktop.bat
```

产物：

```text
dist\LumaForge\LumaForge.exe
```

完整发布包（桌面 zip、可选安装器、可选代码签名）：

```powershell
.\scripts\build_desktop_release.ps1
```

发布给自动更新使用的 zip 必须包含 `LumaForge/` 根目录：

```text
LumaForge-2.1.0-desktop.zip
  LumaForge\
    LumaForge.exe
    LumaForgeUpdater.exe
    _internal\
      v21\
        server.exe
      web\
        server.js
        .next\
        public\
      node\
        node.exe
    static\
    workflows\
```

说明：启动器会同时检查根目录和 `_internal`，PyInstaller one-dir 默认会把上述 v21 运行文件放在 `_internal`。
v2.1.0 桌面模式会优先启动 Go + Next 主体，同时在隐藏本地端口启动 legacy FastAPI 兼容服务，并把地址写入 `LUMAFORGE_LEGACY_API_URL`。设置页自动更新、备份、诊断和深度素材维护接口先通过该兼容层保留。

默认目录：

- Runtime: `%APPDATA%\LumaForge`
- Images: `%USERPROFILE%\Pictures\LumaForge`
- Logs: `%LOCALAPPDATA%\LumaForge\logs`

## 浏览器版 EXE

```powershell
.\build_windows.bat
```

产物：

```text
dist\LumaForge Browser\LumaForge.exe
```

浏览器版会自动选择端口、启动本地 FastAPI 服务并打开系统浏览器。数据在 EXE 旁边的 `userdata/`。

## macOS 版

macOS 产物必须在 macOS 上构建，不能在 Windows 上交叉编译：

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
VERSION=2.1.0 bash scripts/build_macos_release.sh
```

也可以在 GitHub Actions 手动运行 `Build macOS Release` workflow；推送 `v2.1.0` tag 时，该 workflow 会在 macOS runner 上构建并把 macOS zip 上传到 GitHub Release。

产物：

```text
releases/LumaForge-2.1.0-macos.zip
releases/LumaForge-2.1.0-macos.sha256.txt
```

正式分发建议在 macOS 上追加 Apple Developer 签名和公证：

```bash
codesign --deep --force --options runtime --sign "Developer ID Application: YOUR NAME (TEAMID)" "dist/LumaForge.app"
xcrun notarytool submit "releases/LumaForge-2.1.0-macos.zip" --keychain-profile "notarytool-profile" --wait
```

## 源码运行

```powershell
go run .
cd web
bun install
bun run dev
```

旧 Python 兼容服务仍可用：

```powershell
pip install -r requirements.txt
python launcher.py
```

## 云后台 Docker

服务名：`lumaforge-cloud`

镜像：`iguang9881/lumaforge-cloud`

持久化目录：`/opt/lumaforge-cloud/cloud-data`

```bash
mkdir -p /opt/lumaforge-cloud/cloud-data
cd /opt/lumaforge-cloud
docker pull iguang9881/lumaforge-cloud:2.1.0
docker stop lumaforge-cloud || true
docker rm lumaforge-cloud || true
docker run -d \
  --name lumaforge-cloud \
  --restart unless-stopped \
  -e CLOUD_CONFIG_DB=/app/data/cloud_config.db \
  -e CLOUD_APP_VERSION=2.1.0 \
  -p 127.0.0.1:8787:8787 \
  -v /opt/lumaforge-cloud/cloud-data:/app/data \
  iguang9881/lumaforge-cloud:2.1.0
```

## 注意事项

- 不要把 `assets/`、`output/`、`data/`、`userdata/`、`cloud-data/` 等运行数据打进发布包。
- EXE 自动更新发布包需要同时包含 `LumaForge.exe` 和 `LumaForgeUpdater.exe`，不要只上传单个 EXE。
- 代码签名脚本只做预留；没有真实证书时会跳过签名。未签名 EXE 可能触发 SmartScreen，这是签名问题，不是程序问题。
