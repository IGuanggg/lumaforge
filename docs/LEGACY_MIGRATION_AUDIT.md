# Legacy Migration Audit

Updated: 2026-06-22

## Decision

The Python compatibility runtime and root `static/` application cannot be removed yet. They remain part of the desktop runtime and release package, not dead code.

The React application is the primary UI. New product features must be implemented in Go and React unless they are required to keep the compatibility runtime operational during migration.

## Current Dependencies

| Legacy component | Active dependency | Removal gate |
| --- | --- | --- |
| `main.py` | `desktop_launcher.py` starts it on the legacy port | Move remaining local desktop APIs to Go |
| `main.py` updater | `desktop_updater.py`, app update, restart, backup, diagnostics | Verify native Go/launcher replacements in packaged desktop mode |
| legacy canvas API | `service/migration.go` imports v2.0 canvases and assets | Keep read-only import support for at least one supported release line |
| `static/app-settings.html` | React `/app-settings` embeds it | Replace all settings sections with React controls |
| root `static/api-settings.html` | legacy `static/index.html` uses it | Remove together with the legacy shell |
| generation and asset routes | selected Go handlers still use the compatibility API | Remove each proxy only after equivalent Go coverage and tests |

## React Canvas Coverage

The task proposal was stale in several places. The current React canvas already includes:

- undo and redo history with a bounded history stack;
- multi-node selection, group operations, copy and paste;
- connection creation, selection, and deletion;
- project import and export;
- batch image groups and queued generation status;
- node status for queued, submitting, generating, saving, and failed phases.

PNG snapshot export is not yet equivalent to the legacy implementation and remains a follow-up item.

## Cleanup Completed

- Removed the Next.js copy of `static/api-settings.html`; the native React API settings page is now the only API settings UI in the primary application.
- Removed the corresponding legacy fallback button.
- Replaced the React `/app-settings` iframe with a native settings surface for update, diagnostics, backups, desktop actions, and local data paths.
- Removed the Next.js copy of `static/app-settings.html` and the static-only Tailwind/Lucide/theme/i18n files that supported it.
- Removed the unused Next.js copy of `three.module.js`.
- Added an explicit deprecation policy for the compatibility files.

## Safe Removal Sequence

1. Move remaining desktop maintenance and deep backup operations behind complete Go APIs instead of legacy no-op/proxy fallbacks.
2. Keep legacy canvas and asset migration read-only and measure successful imports.
3. Validate packaged desktop update, rollback, and data recovery.
4. Remove the legacy launcher process and root static shell in a dedicated major cleanup release.

Deletion must not be based on repository size alone. It requires packaged-runtime tests and an explicit migration window.
