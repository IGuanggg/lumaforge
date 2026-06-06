# LumaForge Project Handoff

Last updated: 2026-06-05

## Project Identity

- Chinese name: 光绘工坊
- English brand: LumaForge
- GitHub repository name: lumaforge
- Frontend package/app name: lumaforge
- Cloud backend service: lumaforge-cloud
- Docker image: iguang9881/lumaforge-cloud
- Desktop exe: LumaForge.exe
- Desktop updater exe: LumaForgeUpdater.exe

## Current Version

- App version: 2.1.0
- Build ID: 20260605-v210-source-refactor1
- New main backend: `main.go`
- New main frontend: `web/`
- Legacy compatibility backend: `main.py`
- Desktop launcher: `desktop_launcher.py`
- Desktop updater: `desktop_updater.py`
- Release check: `scripts/check_release.ps1`

## v2.1.0 Direction

v2.1.0 is a source-main refactor. The Go + Next.js project imported from `new新的infinite-canvas-0.2.4-copy.zip` is now the new main canvas/application body.

The following LumaForge assets must remain authoritative:

- Cloud account and sync backend:
  - `cloud_config_server.py`
  - `Dockerfile.cloud`
  - `docker-compose.cloud.yml`
  - `requirements-cloud.txt`
- API provider settings:
  - `data/api_providers.json`
  - `api_provider_keys.json`
  - model fetch
  - connection test/manual probe
  - VIP and non-VIP image model choices
- App settings/update module:
  - current version and Build ID
  - GitHub Release update check
  - update state
  - desktop zip download/install/restart flow
  - ignore 3 days / never remind update notice state
- Desktop packaging and update safety:
  - Windows desktop zip is required for auto-update
  - installer EXE alone is not enough
  - updater must replace program files only
  - user data must never be overwritten

## Desktop Runtime

The v2.1.0 desktop launcher starts the new runtime first:

- Go API server: `v21/server.exe`
- Next standalone app: `web/server.js`
- Node runtime: `node/node.exe`

When the v2.1 runtime is available, `desktop_launcher.py` also starts a hidden legacy FastAPI compatibility server on a local port and passes it to the Go API through `LUMAFORGE_LEGACY_API_URL`.

This keeps existing update, backup, diagnostics, and deep asset maintenance routes available while the new Go + Next main body is being migrated.

If v2.1 runtime artifacts are missing, the launcher falls back to the legacy Python app.

## Data Rules

Desktop mode must not keep user data inside the install directory.

Protected user locations:

- Runtime/config/data: `%APPDATA%\LumaForge`
- Images/assets: `%USERPROFILE%\Pictures\LumaForge`
- Logs/cache/webview storage: `%LOCALAPPDATA%\LumaForge`

Protected runtime directories during update:

- `API`
- `data`
- `assets`
- `logs`
- `cache`
- `cloud-data`
- `releases`
- `updates`
- `userdata`
- `output`

Old-version compatibility requirements:

- Users registered in LumaForge Cloud must not be migrated into or replaced by the imported Go local user table.
- Keep `cloud_config.db` / `cloud-data` as the source of truth for cloud accounts, email verification, cloud config, and cloud media records.
- Existing desktop users must keep `%APPDATA%\LumaForge`, `%USERPROFILE%\Pictures\LumaForge`, and `%LOCALAPPDATA%\LumaForge` untouched by installer and updater.
- First v2.1 startup may copy missing legacy app-dir data into the runtime directories only when the destination is empty; it must never overwrite user-modified files.
- Old clients that still call LumaForge Cloud APIs must continue to work while v2.1 is rolling out.

Migration rule:

- First v2.1 startup writes `migration-2.1.0.json`.
- Existing data is reused or copied only.
- Never delete old canvas, asset, API provider, cloud session, backup, update, or log files during migration.

## API Compatibility

Keep these LumaForge routes:

- `/api/providers/*`
- `/api/providers/test-connection`
- `/api/providers/probe-async`
- `/api/providers/{provider_id}/fetch-models`
- `/api/config/token`
- `/api/cloud/*`
- `/api/assets/*`
- `/api/app/info`
- `/api/app/update-check`
- `/api/app/update-state`
- `/api/app/update-download`
- `/api/app/update-install`

New source routes may remain:

- `/api/v1/images/generations`
- `/api/v1/images/edits`
- `/api/v1/chat/completions`
- `/api/v1/videos`
- `/api/prompts`

`/api/auth/*` maps to the LumaForge cloud account flow. Do not switch the real account source to the imported local user table.

Image generation defaults:

- Model: `gpt-image-2-vip`
- Ratio: `16:9`
- Quality: `1K`
- VIP and non-VIP image model choices must both remain selectable.

## Release Validation

Run before publishing:

```powershell
python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_release.ps1 -Version 2.1.0 -BuildId 20260605-v210-source-refactor1
git diff --check
```

If local Go/Bun are unavailable, validate with Docker:

```powershell
docker build -f Dockerfile.v21 -t lumaforge:v21-check --progress=plain .
docker run --rm -v ${PWD}:/src -w /src golang:1.25-alpine /usr/local/go/bin/go test ./...
```

Expected release artifacts:

- `lumaforge-browser-v2.1.0.zip`
- `LumaForge-2.1.0-desktop.zip`
- `LumaForge-Setup-2.1.0.exe`
- macOS zip from macOS local build or GitHub Actions macOS workflow

## Current Caveats

- This is an architecture-level start, not a small hotfix.
- Keep the legacy compatibility layer until update, backup, cloud media sync, and deep asset migration are fully implemented in Go.
- Do not mass-rename internal legacy `comfy*` identifiers without a dedicated test pass. Visible UI should say “本地工作流”, but internal compatibility names can remain temporarily.
- Stability is higher priority than adding new canvas features.
