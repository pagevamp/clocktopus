# Desktop App Distribution + Setup Bootstrap — Design

Date: 2026-05-27
Status: Approved for planning

## Goal

Let users install the Clocktopus desktop app from a website link with zero terminal
commands, and have the app cleanly pass macOS Gatekeeper. Two independent workstreams:

1. **Distribution** — sign and notarize the Tauri app so a downloaded `.dmg` opens
   without "unidentified developer" blocks, and can be linked from the website.
2. **Setup bootstrap** — extend the in-app first-run flow so it installs its own
   prerequisites (bun, then the `clocktopus` CLI) and starts the server, without the
   user touching a terminal.

Explicitly **out of scope**: Mac App Store listing (requires App Sandbox + bans the
`tauri-nspanel` / `macOSPrivateApi` this app depends on — separate, larger effort).
Fully bundling the CLI as a Tauri sidecar is also out of scope; we keep the
spawn-global-CLI model and bootstrap it instead.

## Current state (verified)

- App: Tauri 2 menubar app in `desktop/`, `com.clocktopus.desktop`, signing not configured.
- `desktop/src-tauri/src/lib.rs` serves a custom `clocktopus://` scheme with two pages:
  - `/loading` — spinner.
  - `/error` — has an existing install/start state machine in inline JS.
- Existing Rust commands: `start_server`, `stop_server`, `check_server`,
  `check_clocktopus_installed`, `install_clocktopus`.
- `install_clocktopus()` runs `~/.bun/bin/bun i -g clocktopus --trust` — **assumes bun
  already installed**; silently no-ops if `~/.bun/bin/bun` is absent.
- `spawn_server()` resolves the `clocktopus` binary from known absolute paths
  (`~/.bun/bin`, `~/.npm-global/bin`, homebrew) and injects `~/.bun/bin` into the child
  PATH — so no shell-rc dependency is needed once bun exists on disk.
- `tauri.conf.json` bundle: `targets: "all"`, icons set, no macOS signing block.

## Part 1 — Sign + notarize

### Prerequisite (manual, done by user)

- Apple Developer Program: user is enrolled. Cert status unknown.
- Create a **Developer ID Application** certificate (Xcode → Settings → Accounts →
  Manage Certificates → +, or developer.apple.com). Confirm it shows in Keychain via
  `security find-identity -v -p codesigning` (note the identity string).
- Generate notarization credentials: an **App Store Connect API key** (preferred) or an
  Apple ID + app-specific password. Stored as env vars, never committed.

### Config changes

- Add `bundle.macOS` to `tauri.conf.json`:
  - `signingIdentity`: the "Developer ID Application: …" string (or read from env).
  - Hardened runtime: enabled (Tauri default when signing; required for notarization).
  - `entitlements`: path to a minimal entitlements plist (see below).
- Entitlements plist (`desktop/src-tauri/entitlements.plist`), minimal for a non-sandboxed,
  hardened-runtime app that spawns child processes:
  - Start with an empty/near-empty dict; add only what testing proves necessary.
  - Candidate keys if child-spawn or network under hardened runtime misbehaves:
    `com.apple.security.cs.allow-unsigned-executable-memory` is **not** expected to be
    needed (children are separate processes). Document the tested final set.
- Notarization: invoked through `tauri build` using env creds (`APPLE_API_KEY`,
  `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`, or `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`).
  Tauri signs → submits to notary → staples → produces `.dmg`.

### Verification

- `codesign --verify --deep --strict --verbose=2` on the `.app`.
- `spctl -a -vvv` on the `.app` → "accepted, source=Notarized Developer ID".
- `xcrun stapler validate` on the `.dmg`.
- Manual: download on a clean machine / fresh user account, confirm it opens without
  Gatekeeper warning.

## Part 2 — Setup bootstrap flow

Turn the `/error` page's install logic into a multi-step Setup state machine. The app
already navigates to `/error` at startup when the CLI is not installed or the server is
down, so the entry point is unchanged.

### New / changed Rust commands (`lib.rs`)

- `check_bun_installed() -> bool` — check `~/.bun/bin/bun` plus homebrew paths
  (`/opt/homebrew/bin/bun`, `/usr/local/bin/bun`) on disk. Mirrors
  `check_clocktopus_installed` style (no reliance on inherited shell PATH).
- `install_bun() -> Result<(), String>` — run
  `sh -c "curl -fsSL https://bun.sh/install | bash"`. Returns an error string on
  non-zero exit so the UI can show it. Lands the binary at `~/.bun/bin/bun`.
- `install_clocktopus()` — change to return `Result<(), String>` (currently fire-and-forget)
  so failures surface to the Setup UI; keep using absolute `~/.bun/bin/bun`.
- Existing `start_server` / `check_server` / `check_clocktopus_installed` unchanged.
- Register the new commands in `invoke_handler`.

### Setup state machine (error-page JS)

Single primary button labeled by current step. Ordered flow:

1. `check_bun_installed()` → if false, button "Install bun"; on click `install_bun()`,
   show "Installing bun…", poll `check_bun_installed()`.
2. `check_clocktopus_installed()` → if false, "Install Clocktopus"; on click
   `install_clocktopus()`, poll `check_clocktopus_installed()`.
3. Both present → "Start Server"; on click `start_server()`, poll `check_server()`,
   then `location.href = DASH_URL`.

The flow auto-advances: after each successful step it re-evaluates and moves to the next,
so a fresh user can complete bun → CLI → start by clicking through prompts (or a single
"Set up Clocktopus" button that runs the whole chain).

### Failure UX (per user decision: error + retry)

- Each step that fails shows: the failing step name, the returned error message, a
  **Retry** button, and a copyable manual fallback command for that step
  (e.g. `curl -fsSL https://bun.sh/install | bash`, `bun i -g clocktopus --trust`).
- Retry re-invokes the same step command.

## Risks / validations

- **Hardened runtime + spawning curl/bun/CLI children** — children are separate
  processes, expected fine; must be confirmed on a notarized build, not just dev.
- **Quarantine on downloaded bun** — bun installed via curl-pipe has no quarantine
  xattr, so it should execute; validate on a clean machine.
- **Entitlements** — start minimal, expand only if a tested notarized build fails to
  spawn children or reach the network. Record the final set.
- **Network/permission failures** during install — covered by the retry + manual-command
  fallback UX.

## Testing

- Rust: unit-test pure helpers as today; the install/check commands are integration-level
  (manual on clean machine).
- End-to-end manual matrix on a fresh macOS user account:
  - no bun, no CLI → full Setup chain succeeds.
  - bun present, no CLI → CLI install + start succeeds.
  - both present → start succeeds.
  - simulated failure (offline) → error + retry + manual command shown.
- Gatekeeper/notarization checks from Part 1 verification.
