# Self-update feature

**Date:** 2026-05-28
**Status:** Approved design

## Goal

Two related self-update flows surfaced from the same Settings → About section:

1. **CLI package update** — pull a newer `clocktopus` npm release via
   `bun i -g clocktopus --trust` without dropping to a terminal. Covers
   dashboard web UI, Tauri webview, and the CLI itself.
2. **Desktop app update** — when running inside Tauri, detect that a newer
   `.dmg` exists in GitHub Releases, download it to `~/Downloads`, and reveal
   the file in Finder so the user can drag it to Applications.

Both flows periodically check for new versions and badge the UI when updates
are available.

## Non-goals

- Auto-install without user confirmation.
- Rollback to previous version.
- Bundled release notes / changelog rendering.
- Signature verification beyond what npm/bun already do.
- Updating bun itself (existing `install_bun` already covers initial setup).
- Auto-installing the desktop `.dmg`. We download + reveal in Finder; user
  drags to Applications. No tauri-plugin-updater integration in this scope.

## Architecture

One shared core module drives three entrypoints:

```
lib/updater.ts                          ← shared core
  ├── dashboard/routes/update.ts        (HTTP for browser + Tauri webview)
  ├── CLI subcommand `clocktopus update` (terminal users)
  └── Tauri Rust command `update_clocktopus` (desktop, also handles server restart)

lib/monitor (existing PM2 daemon)
  └── startUpdateChecker()               ← periodic poll, writes cache, fires OS toast
```

All three entrypoints converge on `lib/updater.ts` so install behavior stays
identical regardless of surface.

## Components

### `lib/updater.ts`

Public API:

- `getCurrentVersion(): string` — reads the bundled `package.json` version
  (already shipped via `files` in the package).
- `fetchLatestVersion(opts?: { force?: boolean }): Promise<{ version: string; publishedAt: string } | null>`
  — `GET https://registry.npmjs.org/clocktopus/latest`. 5-minute in-memory
  cache; `force: true` bypasses cache. Returns `null` on network / 5xx error.
- `runUpdate({ onLog }: { onLog: (line: string) => void }): Promise<void>`
  — resolves `~/.bun/bin/bun` (reuse Tauri's `bun_candidates` logic in TS),
  spawns `bun i -g clocktopus --trust` with `PATH` prefixed by `~/.bun/bin`
  so postinstall lifecycle scripts succeed. Streams stdout + stderr lines to
  `onLog`. Resolves on exit code 0, rejects with combined stderr otherwise.
- `stopMonitorIfRunning(): Promise<void>` — wraps existing `monitor:stop`
  plumbing; no-op if monitor not running.
- `isUpdateAvailable(current: string, latest: string): boolean` — semver
  compare; latest strictly greater than current.

### `lib/update-cache.ts` (new SQLite table)

Single-row table `update_check`:

| column             | type | notes                                                   |
| ------------------ | ---- | ------------------------------------------------------- |
| `id`               | int  | always `1`                                              |
| `latest_version`   | text | last successful fetch                                   |
| `published_at`     | text | ISO from registry                                       |
| `checked_at`       | text | ISO of last successful fetch                            |
| `notified_version` | text | last version we've shown OS toast for; suppress repeats |

Migration added to existing `lib/db.ts` initialization path.

### `dashboard/routes/update.ts`

- `GET /api/version`
  Returns `{ current, latest, updateAvailable, publishedAt, checkedAt }`.
  Query `?refresh=1` bypasses cache and forces a registry fetch.

- `POST /api/update`
  Body: `{}`. Creates an in-memory job (`Map<jobId, JobState>`), returns
  `{ jobId }`. Steps run async:
  1. Call `stopMonitorIfRunning()`.
  2. Call `runUpdate({ onLog })`; lines append to job log buffer.
  3. On success: schedule `process.exit(0)` after 500ms so Tauri / supervisor
     respawns dashboard on the new binary. Job state → `done`.
  4. On failure: job state → `error` with stderr; server keeps running.

- `GET /api/update/:jobId/stream`
  Server-Sent Events. Replays buffered log lines, then streams new ones as
  `event: log`. Terminal event is `event: done` or `event: error`.

- `POST /api/update/dismiss`
  Marks current `latest` as acknowledged in `update_check.notified_version`
  so the badge stays but OS notification doesn't re-fire.

### CLI subcommand

Registered in `index.ts` (commander). Flags:

```
clocktopus update          # interactive: print versions, prompt y/n, install
clocktopus update --yes    # non-interactive install
clocktopus update --check  # print current + latest, exit
```

Streams bun stdout to terminal directly. On success prints:
`Updated to vX.Y.Z. Restart monitor with: mrestart` (mention `mrestart` since
the project's `~/.zshrc` aliases document it).

### Tauri Rust command

Extract shared helper from existing `install_clocktopus`:

```rust
fn run_bun_install_clocktopus(app: &tauri::AppHandle) -> Result<(), String> { ... }
```

Helper streams each captured stdout/stderr line to the frontend via
`app.emit("update://log", line)` so the Tauri modal can render progress
without going through the HTTP route.

New command:

```rust
#[tauri::command]
fn update_clocktopus(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerChild>,
) -> Result<(), String> {
    kill_server_child(&state);
    kill_server_by_port();
    run_bun_install_clocktopus(&app)?;
    spawn_server(&state);
    Ok(())
}
```

Register in `invoke_handler!`. Frontend calls when running inside Tauri.

### Dashboard UI

New "About" subsection inside existing Settings card (`dashboard/views.ts`):

- Row 1: `Version 1.12.3` · `Check for updates` button.
- After check, if newer: badge `1.13.0 available` (published date tooltip) +
  primary `Update` button.
- Click `Update` → modal with spinner + live log tail and terminal state
  ✅ "Updated to 1.13.0. Reloading…" then `location.reload()` after server
  respawn detected, OR ❌ with stderr and `Retry` button.
- Two paths into the modal, decided once at click time:
  - **Browser / CLI dashboard**: `POST /api/update` then subscribe to
    `/api/update/:jobId/stream` for log lines. Dashboard self-exits on
    success; reload polls until it comes back.
  - **Tauri** (`window.__TAURI__` present): call `invoke('update_clocktopus')`
    directly. Rust handles stop → install → respawn. Tauri streams install
    log to the modal via a Tauri event channel (`update://log`) emitted from
    `run_bun_install_clocktopus`; final `Ok`/`Err` from the invoke resolves
    the modal. No HTTP route involved on this path.
- Settings sub-row: two checkboxes
  - "Check for updates automatically" → `updates.autoCheck`
  - "Notify when an update is available" → `updates.notify`

### Periodic checker

Lives inside the existing monitor daemon (no new PM2 service).

- On boot: one immediate `fetchLatestVersion()` + write to cache.
- `setInterval(6 * 60 * 60 * 1000, runCheck)` afterward.
- After successful fetch:
  - Compare against `getCurrentVersion()`.
  - If newer AND `latest !== notified_version` AND `updates.notify` true:
    fire `lib/notifier.ts` toast `Clocktopus X.Y.Z available — open dashboard to update`.
    Set `notified_version = latest`.
- Reads `updates.autoCheck`; bails early if false.

Dashboard process runs the same checker as fallback when monitor is disabled:
on dashboard boot + every 6h while alive. Both writers target the same
`update_check` row; last-write-wins is fine.

### Desktop app version check (Tauri-only)

Source of truth for releases: GitHub Releases on `pagevamp/clocktopus`. The
build workflow (`.github/workflows/build-desktop.yml`) tags `v*` and uploads
the signed `.dmg` as a release asset.

**Current version**: read via `@tauri-apps/api/app` `getVersion()` in the
frontend (returns the value from `desktop/src-tauri/tauri.conf.json`). Pass
to backend as `?currentDesktopVersion=…` so caching can key on it.

**Latest release lookup** — new dashboard route since fetching has to come
from a server (CORS + token-rate-limit handling) rather than the webview:

- `GET /api/desktop-version?currentDesktopVersion=X.Y.Z`
  Returns `{ current, latest, updateAvailable, downloadUrl, htmlUrl, publishedAt }`.
  Fetches `https://api.github.com/repos/pagevamp/clocktopus/releases/latest`,
  6-hour in-memory cache. `downloadUrl` = first asset matching `*.dmg`;
  `htmlUrl` = release page. Returns `latest: null` on network / 5xx.
  Endpoint exists in all dashboard processes but the UI only calls it when
  `window.__TAURI__` is present, so non-desktop users never see it.

**Download command** (Tauri Rust):

```rust
#[tauri::command]
async fn download_desktop_update(url: String) -> Result<String, String> {
    // Stream the .dmg into ~/Downloads/<filename>, emit "desktop-update://progress"
    // events with bytes downloaded so the UI can render a progress bar.
    // On finish: Command::new("open").args(["-R", &path]).spawn() to reveal in Finder.
    // Returns the absolute path so the modal can show "Saved to <path>".
}
```

Registered in `invoke_handler!`. Filename derived from the URL's basename
(GitHub asset names already include version, e.g. `Clocktopus_1.0.3_aarch64.dmg`).

**UI** — second row inside the same About section, only rendered when
`window.__TAURI__` is present:

- `Desktop app 1.0.2` · `Check for updates` button.
- After check, if newer: badge `1.0.3 available` (with published date
  tooltip) + primary `Download` button + secondary `Release notes` link to
  `htmlUrl`.
- Click `Download` → modal with progress bar (driven by the
  `desktop-update://progress` event). Terminal state:
  ✅ "Saved to ~/Downloads/Clocktopus_1.0.3_aarch64.dmg — opened in Finder.
  Drag Clocktopus to Applications to finish updating." with `Open Finder
again` button.
  ❌ stderr + `Retry`.

**Periodic check**: the Tauri frontend (which already polls `/api/version`
for tray indicator) also polls `/api/desktop-version` on the same cadence
(app focus + every 6h). No monitor-daemon involvement — desktop version is
meaningless in non-Tauri contexts.

**OS notification** for desktop updates: skipped. Tray badge + dashboard
banner are enough; we don't want to fire a second toast on top of the CLI
toast.

### Tray indicator

Tauri frontend polls both `/api/version` and `/api/desktop-version` on app
focus + every 6h. When either reports `updateAvailable`:

- Swap tray icon to dot variant (add `tray-update.png` asset alongside the
  existing tray icon). One dot covers both update types — no need to
  distinguish at the icon level.
- Update the tray menu:
  - CLI newer → menu item `Check for updates…` → `Update CLI to X.Y.Z`.
  - Desktop newer → add `Download desktop X.Y.Z` item below it.
  - Both newer → show both items.
  - Clicking either navigates the webview to dashboard Settings → About so
    the user picks which update to run there.
- Reset on each update's success (CLI install completes → reset CLI label;
  desktop version equals latest after relaunch → reset desktop label).

## Settings

Added to existing settings store (`lib/settings.ts`):

```ts
updates: {
  autoCheck: boolean; // default: true
  notify: boolean; // default: true
}
```

Migration: if key missing, defaults applied on first read.

## Error handling

| Case                           | Behavior                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| npm registry offline / 5xx     | `GET /api/version` returns `latest: null`; UI: "Couldn't reach registry". Periodic checker silently skips.   |
| bun binary missing             | `runUpdate` rejects with `bun not found`; UI suggests reinstalling bun (link to setup screen / install_bun). |
| `bun i -g` exits non-zero      | Modal shows stderr; server NOT restarted; retry button enabled.                                              |
| Same version                   | `updateAvailable: false`; UI shows "Up to date".                                                             |
| Update succeeds, respawn fails | Tauri shows existing error screen ("Server did not start"); user can click Start Server.                     |
| GitHub API offline / 5xx       | `GET /api/desktop-version` returns `latest: null`; UI: "Couldn't reach GitHub". No tray badge.               |
| GitHub rate limit (403)        | Same as offline. Unauthenticated GitHub requests are 60/h per IP — 6h poll is well under.                    |
| No `.dmg` asset on release     | `downloadUrl: null`; UI swaps `Download` button for `Open release page` linking to `htmlUrl`.                |
| .dmg download fails mid-stream | Modal shows error + `Retry`. Partial file is deleted.                                                        |

## Testing

- `lib/updater.test.ts`
  - `fetchLatestVersion` caches for 5 min; `force` bypasses.
  - `isUpdateAvailable` semver edge cases (prerelease, equal, downgrade).
  - `runUpdate` happy path mocks `child_process.spawn` and verifies args
    (`bun i -g clocktopus --trust`) + PATH prefix.
  - `runUpdate` reject path: non-zero exit returns combined stderr.
- `lib/update-cache.test.ts`
  - Migration creates row; subsequent reads return persisted values.
  - `notified_version` write suppresses second toast.
- `dashboard/routes/update.test.ts`
  - `GET /api/version` returns expected shape; `?refresh=1` bypasses cache.
  - `POST /api/update` creates job; SSE stream emits log + terminal event.
- `dashboard/routes/desktop-version.test.ts`
  - `GET /api/desktop-version` resolves `downloadUrl` from the first `.dmg`
    asset; falls back to `htmlUrl` when no asset matches.
  - 6h cache served on repeated calls; differing `currentDesktopVersion`
    query still recomputes `updateAvailable`.
  - GitHub 5xx → `latest: null`.
- Manual smoke:
  - Tauri build, trigger CLI update against a test npm tag, confirm server
    respawns on new binary.
  - Bump `desktop/src-tauri/tauri.conf.json` version locally below the
    latest GitHub release, confirm desktop card shows update + download
    reveals .dmg in Finder.

## Scope summary

In: shared updater lib, dashboard route + UI, CLI subcommand, Tauri update
command, monitor periodic checker, OS notification, tray indicator (covering
both update types), settings toggles, SQLite cache table, desktop-version
route + Tauri download command + About row.

Out (deferred): auto-install of CLI, rollback, changelog rendering, bun
self-update, email, in-app modal popups beyond the update dialogs themselves,
tauri-plugin-updater integration (drag-to-Applications stays manual), Windows
/ Linux desktop installers (only macOS `.dmg` is built today).
