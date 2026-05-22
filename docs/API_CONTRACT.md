# LumaForge API Contract

Version: 2.0.2

This file is the stable contract for the browser app, desktop EXE, and cloud backend. When a feature changes an API shape, update this file in the same PR.

## Product Names

- App display name: `光绘工坊`
- English brand: `LumaForge`
- Frontend package/release name: `lumaforge`
- Cloud service name: `lumaforge-cloud`
- Cloud Docker image: `iguang9881/lumaforge-cloud`
- Cloud container name: `lumaforge-cloud`
- Cloud host data directory: `/opt/lumaforge-cloud`
- Desktop EXE: `LumaForge.exe`

## Resource Types

- `temporary_ref`: temporary reference images used by chat/image generation. These must not enter the asset library.
- `asset`: user-visible library item. Generated outputs and manual uploads live here.
- `output`: generated image/video file saved locally first, then indexed as an asset when appropriate.
- `cache`: removable temporary/cache files. Never sync as durable user data.
- `avatar`: account profile image, stored in cloud account profile storage.
- `project`: canvas/project state, including nodes, links, positions, and selected model settings.

## Response Convention

Successful mutating endpoints should return:

```json
{ "ok": true }
```

Errors should use HTTP status codes and a short `detail` string:

```json
{ "detail": "human readable reason" }
```

Frontend code should show clear human messages, not raw HTML or stack traces.

## Local Backend Endpoints

### App and Update

- `GET /api/app/info`
  - Returns `name`, `brand`, `repository`, `version`, `desktop`, `cloud_url`, `paths`, and update state.
- `GET /api/app/update-check`
  - Checks the configured release JSON/GitHub release source.
- `POST /api/app/update-download`
  - Downloads a newer browser/source zip into the update cache.
- `POST /api/app/update-apply`
  - Applies a downloaded browser/source update. EXE hot update is not promised.

### Queue and Runtime Status

- `GET /api/queue_status?client_id=...`
  - Returns generation queue status and `online_count`.
  - UI status chips must read from this endpoint instead of hard-coded numbers.

### Uploads

- `POST /api/ai/upload`
  - Query: `temporary=true|false`.
  - `temporary=true` stores a working file but must not index it into the asset library.
  - `temporary=false` may index as a visible asset.

### Assets

- `GET /api/assets`
  - Lists local library assets.
- `POST /api/assets/upload`
  - Adds a local asset.
- `DELETE /api/assets/{id}?delete_file=true`
  - Deletes metadata and optionally the local file.
- `GET /api/assets/{id}/download`
  - Downloads/saves an asset using local file first when possible.

### Chat and Image Generation

- `POST /api/chat`
  - Supports chat mode and image mode.
  - Image mode may accept temporary reference image paths and should not auto-index reference-only uploads.
- `POST /api/online-image`
  - Enqueues/dequeues generation tasks by `client_id`.
  - Generated files should be saved locally before being added to the visible asset library.

## Cloud Backend Endpoints

### Identity

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/email/send`
- `POST /api/email/verify`
- `POST /api/password/change`

After restore or password-changing operations invalidate sessions, clients should be forced back to login.

### Cloud Config Sync

- `GET /api/config`
- `PUT /api/config`

The config payload includes API providers, model lists, ComfyUI endpoints, canvas/project state, prompts, and user preferences. API keys are included by default for this personal-use app.

### Cloud Media Sync

Cloud media sync should:

- upload missing local asset files;
- skip already uploaded files by hash/path;
- retry failed uploads;
- restore missing local files from cloud;
- clean cloud objects only when explicitly requested.

### Cloud Backup

Cloud backup is encrypted SQLite backup storage for the cloud backend itself. It is not a replacement for asset media sync.

- Default prefix: `lumaforge/backups`
- Default host data directory: `/opt/lumaforge-cloud`
- Restore must create a local safety snapshot before replacing the current database.
