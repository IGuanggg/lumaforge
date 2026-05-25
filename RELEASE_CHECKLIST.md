# LumaForge Release Checklist

Version target: `2.0.8`

Run this checklist before tagging a GitHub release or building Docker/EXE artifacts.

## 1. Version and Brand

- `main.py` default `APP_VERSION` is the release version.
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

- Start browser app on `127.0.0.1:3010`.
- Confirm navigation works: 文生图, 细节增强, 图片编辑, 角度控制, GPT 对话, 无限画布, 素材库, 应用设置.
- Confirm generated images save locally and appear in 素材库.
- Confirm download buttons save images from local files first.
- Confirm chat reference images do not enter 素材库.
- Confirm status chips show real queue and online counts.
- Confirm 2.0.8 cache-busted entries load the current GPT 对话, 细节增强, 无限画布, 素材库, and 应用设置 pages.

## 4. Canvas Checks

- Create image/prompt/API/LLM/output nodes.
- Drag, zoom, and pan only affect the canvas area, not the whole app layout.
- Output node shows loading state while running and images after completion.
- Agent creates editable nodes and does not permanently shift the canvas viewport.

## 5. Cloud Checks

- Register/login.
- Email verification updates in the frontend without requiring a full re-login.
- Config sync includes API providers, model lists, ComfyUI settings, canvas state, and API keys.
- Asset media sync uploads missing local files, skips existing files, restores missing local files, and cleans cloud only on explicit action.
- Logout clears account-scoped local sync state before another account logs in.

## 6. Build Artifacts

Browser/source release:

```powershell
Compress-Archive -Path main.py,cloud_config_server.py,launcher.py,desktop_launcher.py,static,workflows,requirements.txt,requirements-cloud.txt,Dockerfile,Dockerfile.cloud,docker-compose.yml,docker-compose.cloud.yml,*.spec,*.bat,README.md,APP_PACKAGING.md,RELEASE_CHECKLIST.md,docs,scripts -DestinationPath releases\lumaforge-browser-v2.0.8.zip -Force
```

Desktop EXE:

```powershell
.\scripts\build_desktop_release.ps1
```

- GitHub Release must include `releases\LumaForge-2.0.8-desktop.zip`, not only a single EXE.
- If Inno Setup is installed, confirm `releases\LumaForge-Setup-2.0.8.exe` exists.
- If a real signing certificate is available, set `WINDOWS_SIGN_CERT_PATH` and `WINDOWS_SIGN_CERT_PASSWORD`; otherwise signing is skipped by design.
- Record SHA256 hashes printed by the release script in the release notes.

Cloud Docker:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.cloud -t iguang9881/lumaforge-cloud:2.0.8 -t iguang9881/lumaforge-cloud:latest --push .
```

Server upgrade command:

```bash
mkdir -p /opt/lumaforge-cloud/cloud-data
cd /opt/lumaforge-cloud
docker pull iguang9881/lumaforge-cloud:2.0.8
docker stop lumaforge-cloud || true
docker rm lumaforge-cloud || true
docker run -d \
  --name lumaforge-cloud \
  --restart unless-stopped \
  -e CLOUD_CONFIG_DB=/app/data/cloud_config.db \
  -e CLOUD_APP_VERSION=2.0.8 \
  -p 127.0.0.1:8787:8787 \
  -v /opt/lumaforge-cloud/cloud-data:/app/data \
  iguang9881/lumaforge-cloud:2.0.8
```
