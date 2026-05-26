# LumaForge Project Handoff

Last updated: 2026-05-26

## Project Identity

- Chinese name: 光绘工坊
- English brand: LumaForge
- GitHub repository name: lumaforge
- Frontend package/app name: lumaforge
- Backend cloud service: lumaforge-cloud
- Docker image: iguang9881/lumaforge-cloud
- Docker container: lumaforge-cloud
- Cloud data directory: /opt/lumaforge-cloud
- Desktop exe: LumaForge.exe
- Desktop updater exe: LumaForgeUpdater.exe

## Current State

- Current local app version in code: 2.0.9
- Current build id: 20260526-asset-reliability1
- Main local URL: http://localhost:3010/
- Main app file: main.py
- Desktop launcher: desktop_launcher.py
- Browser launcher: launcher.py
- Desktop updater: desktop_updater.py
- Desktop PyInstaller spec: desktop_canvas.spec
- Updater PyInstaller spec: desktop_updater.spec

The project is a local-first AI creation studio with:

- Text-to-image
- Image enhancement
- Image editing
- Angle control
- GPT chat
- Smart canvas
- Infinite canvas
- Asset library
- Cloud sync / backup
- API provider management
- Desktop EXE packaging
- Docker backend deployment

## Important User Preferences

- The user wants a normal desktop-app experience, not a manual deployment workflow.
- EXE is the priority, browser/local mode remains useful for development.
- Local data must survive upgrades.
- Do not make the user manually download and replace every release.
- Downloads should prioritize local files.
- Cloud storage exists, but should not be assumed unlimited.
- Do not add random new features while fixing release/stability issues.
- Keep UI consistent with the current LumaForge style.
- Do not regress recently fixed modules such as GPT chat, smart canvas, enhance, asset library, and download behavior.

## Data Directory Rules

Desktop mode must not keep user data inside the program install directory.

Current intended desktop paths:

- Runtime/data/config: `%APPDATA%\LumaForge`
- Assets: `%USERPROFILE%\Pictures\LumaForge`
- Logs/cache/webview storage: `%LOCALAPPDATA%\LumaForge`

Protected directories during update:

- API
- data
- assets
- logs
- cache
- cloud-data
- releases
- updates
- userdata
- output

The update process must replace program files only. It must not overwrite user data.

## Completed Recently

### v2.0.5 Stability Work

- Vendored frontend runtime dependencies under `static/vendor`.
- Removed runtime CDN dependency for core frontend libraries.
- Added static dependency health checks.
- Added local data health checks.
- Added cache and old canvas backup cleanup preview/run.
- Hardened API liveness checks with timeout and caching.
- Fixed project-wide download buttons to route through local backend.
- Fixed API signup button to open external browser instead of trapping user inside app.
- Removed confusing “新增百炼” shortcut button from API settings.

### v2.0.6 Desktop Auto-Update Foundation

- Added independent updater:
  - `desktop_updater.py`
  - `desktop_updater.spec`
- Desktop update flow:
  1. Main app checks GitHub Release.
  2. Main app downloads desktop `.zip`.
  3. Main app starts `LumaForgeUpdater.exe`.
  4. Main app exits.
  5. Updater waits for old process to exit.
  6. Updater replaces program files.
  7. Updater restarts `LumaForge.exe`.
- `desktop_launcher.py` now sets stable desktop data paths.
- `launcher.py` also uses stable user data paths.
- Launcher attempts to migrate old `userdata` and `assets` from app directory when possible.
- App settings page now displays update capability.
- `desktop_canvas.spec` includes `LumaForgeUpdater.exe` when it exists in `dist`.

## Current User Request / Next Target

Current planned version: 2.0.9

Goal:

Version hardening around asset reuse, local recovery, diagnostics, and update status clarity.

The user specifically asked for:

- Material detail page displays generation parameters.
- Reuse parameters to regenerate.
- Local lightweight backup/restore.
- Post-update status prompt.
- Startup diagnostics page.
- Asset library missing-file check.
- Thumbnail rebuild.
- Final interface/UI/API check and hardening.

Implemented polish:

- Smart Canvas "back to list" now opens the shared canvas manager in `list=smart` mode.
- The shared canvas manager filters and labels smart canvases when opened through that mode.
- Smart Canvas is now the first-run landing page as a list selector (`/static/canvas.html?list=smart`), not a direct editor route.
- App Settings shows a one-time v2.0.9 welcome card with quick links to diagnostics and asset checks.
- Asset health results are grouped into checked / missing files / thumbnail rebuild counts, with quick actions for thumbnail rebuild and removing missing references.
- Backup restore now has a clearer overwrite warning and visible risk note.
- Diagnostics output is grouped into OK / auto-fixable / manual-action buckets.
- App Settings now blocks direct `file://` use with a clear local-service warning.
- Backup restore creates a new lightweight snapshot before applying the selected backup.
- Version/update panel includes a publish check button covering app version, static assets, asset health, thumbnails, backup presence, update capability, and update-check URL.

## v2.0.7 Recommended Scope

### 1. Update UX

Improve `static/app-settings.html`:

- Add update progress UI.
- Show phases:
  - checking
  - found
  - downloading
  - verifying
  - downloaded
  - waiting_for_exit
  - extracting
  - replacing
  - restarting
  - done
  - failed
  - rollback
- Add Release Notes modal.
- Show:
  - current version
  - latest version
  - selected asset name
  - package size
  - update mode
  - SHA256 verification status
- If failure state exists, show clear error and backup directory.

### 2. Backend Update State

Enhance `main.py`:

- Add or improve `GET /api/app/update-state`.
- Return:
  - current version
  - build id
  - update capability
  - update_state.json content
  - app dir
  - data dir
  - assets dir
- During download, write update state:
  - phase
  - downloaded bytes
  - total bytes if available
  - file name
  - SHA256
  - error
- During install/updater handoff, write a clear pending external updater state.

### 3. Desktop Updater State

Enhance `desktop_updater.py`:

- Write state phases while running:
  - waiting_for_exit
  - extracting
  - replacing
  - rollback
  - done
  - failed
- Keep the state JSON UTF-8.
- Preserve rollback behavior.
- Never touch protected user-data directories.

### 4. Installer

Add Inno Setup script:

- Suggested path: `installer/LumaForge.iss`
- Output: `LumaForge-Setup-2.0.7.exe`
- Default install dir: `{autopf}\LumaForge`
- Include:
  - `dist\LumaForge\**`
  - `LumaForge.exe`
  - `LumaForgeUpdater.exe`
- Add Start Menu shortcut.
- Add optional desktop shortcut.
- Uninstall must not delete `%APPDATA%\LumaForge` or `%LOCALAPPDATA%\LumaForge`.

### 5. Code Signing Preparation

Add script:

- Suggested path: `scripts/sign_windows.ps1`

Use environment variables:

- `WINDOWS_SIGN_CERT_PATH`
- `WINDOWS_SIGN_CERT_PASSWORD`
- `WINDOWS_SIGN_TIMESTAMP_URL`

Default timestamp URL:

- `http://timestamp.digicert.com`

Behavior:

- If certificate variables are missing, do not fail. Print that signing was skipped.
- If configured, sign:
  - `dist\LumaForge\LumaForge.exe`
  - `dist\LumaForge\LumaForgeUpdater.exe`
  - `releases\LumaForge-Setup-2.0.7.exe` if it exists

### 6. Desktop Release Script

Add script:

- Suggested path: `scripts/build_desktop_release.ps1`

Flow:

1. Clean `build`, `dist`, and create `releases`.
2. Run `pyinstaller desktop_updater.spec --noconfirm`.
3. Run `pyinstaller desktop_canvas.spec --noconfirm`.
4. Assert:
   - `dist\LumaForge\LumaForge.exe`
   - `dist\LumaForge\LumaForgeUpdater.exe`
5. Create:
   - `releases\LumaForge-2.0.7-desktop.zip`
6. If `ISCC.exe` exists, build installer:
   - `releases\LumaForge-Setup-2.0.7.exe`
7. Run `scripts/sign_windows.ps1`.
8. Print SHA256 hashes for release assets.

## Release Asset Rule

For auto-update to work, GitHub Release must include a desktop zip asset.

Do not upload only a single EXE.

Required asset shape:

```text
LumaForge-2.0.7-desktop.zip
  LumaForge/
    LumaForge.exe
    LumaForgeUpdater.exe
    _internal/
    static/
    workflows/
```

The app currently selects `.zip` release assets for auto update.

## Key Files

- `main.py`: FastAPI backend, app config, update endpoints, cloud sync, asset APIs, canvas APIs.
- `static/index.html`: main shell/navigation/status bar.
- `static/app-settings.html`: app paths, local data health, update UI.
- `static/api-settings.html`: API provider configuration.
- `static/smart-canvas.html`: smart canvas.
- `static/canvas.html`: infinite canvas.
- `static/assets.html`: asset library.
- `desktop_launcher.py`: desktop window mode using pywebview.
- `launcher.py`: browser/local mode.
- `desktop_updater.py`: external updater for EXE replacement.
- `desktop_canvas.spec`: PyInstaller desktop app spec.
- `desktop_updater.spec`: PyInstaller updater spec.
- `README.md`, `RELEASE_CHECKLIST.md`, `APP_PACKAGING.md`: release documentation.

## Validation Commands

Run these before claiming release readiness:

```powershell
python -m py_compile main.py desktop_launcher.py launcher.py desktop_updater.py
```

Check inline scripts:

```powershell
@'
const fs = require('fs');
const path = require('path');
const files = fs.readdirSync('static').filter(f => f.endsWith('.html')).map(f => path.join('static', f));
let failed = false;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const matches = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  let checked = 0;
  matches.forEach((m, i) => {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) return;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] || '').toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'application/javascript') return;
    checked += 1;
    try { new Function(m[2]); }
    catch (err) { console.error(`${file} inline script #${i + 1}: ${err.message}`); failed = true; }
  });
  console.log(`${file}: ${checked} normal inline scripts OK`);
}
if (failed) process.exit(1);
'@ | node -
```

Desktop smoke:

```powershell
$env:APP_PORT='3021'
python desktop_launcher.py --smoke-test
```

Local service check:

```powershell
$env:APP_PORT='3010'
python main.py
```

Then verify:

- `GET /api/app/info`
- `GET /api/app/static-health`
- `GET /api/app/local-data-health`
- `GET /api/app/update-check`
- `GET /api/app/update-state` once added

## Important Cautions

- Do not run destructive git commands.
- Do not reset or revert user changes without permission.
- Use `rg` for search.
- Use `apply_patch` for manual file edits.
- Be careful with Chinese text encoding. Prefer UTF-8 reads/writes and avoid PowerShell `Set-Content` on HTML files.
- Do not rewrite the whole UI. Keep style consistent.
- Do not move data directories again unless explicitly planned.
- Do not promise SmartScreen is solved without a real code-signing certificate.
- Do not claim EXE auto-update works until a release zip containing `LumaForgeUpdater.exe` is tested.
