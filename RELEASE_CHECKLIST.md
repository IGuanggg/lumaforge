# LumaForge Release Checklist

Version target: `2.1.0`

Run this checklist before tagging a GitHub release or building Docker/EXE artifacts.

## 1. Version and Brand

- `VERSION`, `service/lumaforge.go`, and `web/package.json` use the release version.
- `main.py` default `APP_VERSION` is the release version for legacy compatibility.
- `cloud_config_server.py` default `CLOUD_APP_VERSION` is the release version.
- `Dockerfile.cloud` uses the same `CLOUD_APP_VERSION`.
- `docker-compose.cloud.yml` uses service/container `lumaforge-cloud`.
- Desktop output is `LumaForge.exe`.
- App title shows `光绘工坊 · LumaForge`.

## 2. Data Safety

Do not package or commit these runtime directories:

- `assets/`
- `output/`
- `data/`
- `userdata/`
- `cloud-data/`
- `cache/`
- `logs/`
- `releases/`
- `updates/`

Upgrade must preserve mounted cloud data under `/opt/lumaforge-cloud`.

## 3. Local Regression Checks

- Start Go API and Next app on `127.0.0.1:3000`.
- Confirm navigation works: 智能画布, 生图工作台, 视频创作台, 提示词库, 我的素材, API 设置, 应用设置.
- Confirm generated images save locally and appear in 素材库.
- Confirm download buttons save images from local files first.
- Confirm chat reference images do not enter 素材库.
- Confirm settings iframes load current 2.1.0 cache-busted static assets.

## 4. Canvas Checks

- Create image/prompt/API/LLM/output nodes.
- Drag, zoom, and pan only affect the canvas area, not the whole app layout.
- Output node shows loading state while running and images after completion.
- Agent creates editable nodes and does not permanently shift the canvas viewport.

## 5. Cloud Checks

- Register/login.
- Email verification updates in the frontend without requiring a full re-login.
- Config sync includes API providers, model lists, canvas state, and API keys.
- Asset media sync uploads missing local files, skips existing files, restores missing local files, and cleans cloud only on explicit action.
- Logout clears account-scoped local sync state before another account logs in.

## 6. Build Artifacts

Browser/source release:

```powershell
Compress-Archive -Path main.go,go.mod,go.sum,config,handler,middleware,model,repository,router,service,web,VERSION,CHANGELOG.md,CHANGELOG.infinite-canvas.md,LICENSE.infinite-canvas-AGPL,main.py,cloud_config_server.py,launcher.py,desktop_launcher.py,static,workflows,requirements.txt,requirements-cloud.txt,Dockerfile,Dockerfile.v21,Dockerfile.cloud,docker-compose.yml,docker-compose.v21.yml,docker-compose.v21.local.yml,docker-compose.cloud.yml,*.spec,*.bat,README.md,APP_PACKAGING.md,RELEASE_CHECKLIST.md,docs,scripts -DestinationPath releases\lumaforge-browser-v2.1.0.zip -Force
```

Desktop EXE:

```powershell
.\scripts\build_desktop_release.ps1
```

- GitHub Release must include `releases\LumaForge-2.1.0-desktop.zip`, not only a single EXE.
- Desktop zip must contain `LumaForge.exe`, `LumaForgeUpdater.exe`, and v21 runtime files: `v21/server.exe`, `web/server.js`, `node/node.exe` under either package root or `_internal`.
- If Inno Setup is installed, confirm `releases\LumaForge-Setup-2.1.0.exe` exists.
- Confirm older desktop installs upgrade through the v2.1.0 desktop zip and do not retain removed static UI after restart.
- If a real signing certificate is available, set `WINDOWS_SIGN_CERT_PATH` and `WINDOWS_SIGN_CERT_PASSWORD`; otherwise signing is skipped by design.
- Record SHA256 hashes printed by the release script in the release notes.

macOS package:

```bash
VERSION=2.1.0 bash scripts/build_macos_release.sh
```

- macOS must be built on macOS; Windows cannot produce a real `.app`.
- GitHub Release should include `releases/LumaForge-2.1.0-macos.zip` when built on a Mac or macOS CI runner.
- For public distribution, sign and notarize with Apple Developer `codesign` and `xcrun notarytool`.

Cloud Docker:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.cloud -t iguang9881/lumaforge-cloud:2.1.0 -t iguang9881/lumaforge-cloud:latest --push .
```

Server upgrade command:

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
