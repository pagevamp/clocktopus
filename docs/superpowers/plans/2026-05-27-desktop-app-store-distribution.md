# Desktop App Distribution + Setup Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Clocktopus Tauri desktop app as a signed + notarized `.dmg` users can download from a website, with an in-app Setup flow that installs bun and the CLI so no terminal is ever needed.

**Architecture:** Two workstreams. (1) Setup bootstrap — add Rust commands to detect/install bun and surface install failures, then rewrite the `/error` page's inline JS into a stepped state machine (bun → CLI → start) with retry + manual-command fallback. (2) Distribution — add a macOS signing/entitlements config to Tauri and notarize via `tauri build`. Keep the existing spawn-global-CLI model; do not bundle a sidecar.

**Tech Stack:** Tauri 2 (Rust), inline HTML/JS served via custom `clocktopus://` URI scheme, `cargo test` for Rust unit tests, Apple Developer ID signing + notarytool (driven by Tauri).

**Spec:** `docs/superpowers/specs/2026-05-27-desktop-app-store-distribution-design.md`

---

## File Structure

- `desktop/src-tauri/src/lib.rs` — add pure path-resolution helpers (testable), the `check_bun_installed` / `install_bun` commands, change `install_clocktopus` to return `Result`, register new commands, and replace the `error_html` Setup flow. All desktop logic lives in this one file today; follow that pattern.
- `desktop/src-tauri/entitlements.plist` — **new** minimal hardened-runtime entitlements.
- `desktop/src-tauri/tauri.conf.json` — add `bundle.macOS` signing/entitlements block.
- `docs/desktop-release.md` — **new** release runbook: prerequisites, env vars, build + verify commands.

All work happens in `desktop/`. Run Rust commands from `desktop/src-tauri/`.

---

## Task 1: Pure path-resolution helpers + tests

Extract the binary-lookup logic into pure, dependency-injected helpers so it is unit-testable. Existing `check_clocktopus_installed` and `spawn_server` hardcode candidate lists; centralize them.

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs` (add helpers near top, after `dashboard_url`, ~line 22; add tests to the existing `#[cfg(test)]` module at the bottom)

- [ ] **Step 1: Write failing tests**

Add to the existing `#[cfg(test)] mod tests` block at the bottom of `lib.rs`:

```rust
    #[test]
    fn bun_candidates_includes_home_and_system_paths() {
        let c = bun_candidates("/Users/alice");
        assert_eq!(c[0], "/Users/alice/.bun/bin/bun");
        assert!(c.contains(&"/opt/homebrew/bin/bun".to_string()));
        assert!(c.contains(&"/usr/local/bin/bun".to_string()));
    }

    #[test]
    fn clocktopus_candidates_includes_known_install_dirs() {
        let c = clocktopus_candidates("/Users/alice");
        assert_eq!(c[0], "/Users/alice/.bun/bin/clocktopus");
        assert!(c.contains(&"/Users/alice/.npm-global/bin/clocktopus".to_string()));
        assert!(c.contains(&"/opt/homebrew/bin/clocktopus".to_string()));
        assert!(c.contains(&"/usr/local/bin/clocktopus".to_string()));
    }

    #[test]
    fn first_matching_returns_first_existing() {
        let cands = vec!["/a".to_string(), "/b".to_string(), "/c".to_string()];
        let got = first_matching(&cands, |p| p == "/b" || p == "/c");
        assert_eq!(got, Some("/b".to_string()));
    }

    #[test]
    fn first_matching_returns_none_when_no_match() {
        let cands = vec!["/a".to_string(), "/b".to_string()];
        let got = first_matching(&cands, |_| false);
        assert_eq!(got, None);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop/src-tauri && cargo test`
Expected: FAIL — `cannot find function bun_candidates`, `clocktopus_candidates`, `first_matching`.

- [ ] **Step 3: Implement the helpers**

Add after `dashboard_url()` (around line 22 of `lib.rs`):

```rust
/// Candidate absolute paths for the `bun` binary, in priority order.
/// GUI apps don't inherit the user's shell PATH, so we probe known locations.
fn bun_candidates(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.bun/bin/bun"),
        "/opt/homebrew/bin/bun".to_string(),
        "/usr/local/bin/bun".to_string(),
    ]
}

/// Candidate absolute paths for the globally-installed `clocktopus` binary.
fn clocktopus_candidates(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.bun/bin/clocktopus"),
        format!("{home}/.npm-global/bin/clocktopus"),
        "/opt/homebrew/bin/clocktopus".to_string(),
        "/usr/local/bin/clocktopus".to_string(),
    ]
}

/// Return the first candidate for which `exists` is true. Injecting the
/// existence check keeps this pure and unit-testable.
fn first_matching<F: Fn(&str) -> bool>(candidates: &[String], exists: F) -> Option<String> {
    candidates.iter().find(|p| exists(p)).cloned()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop/src-tauri && cargo test`
Expected: PASS (new tests green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "refactor(desktop): extract testable binary-path helpers"
```

---

## Task 2: Route existing checks through the helpers

Make `check_clocktopus_installed` and `spawn_server` use the Task 1 helpers (DRY) so behavior stays identical and a single source of truth feeds both detection and Setup.

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs:148-160` (`check_clocktopus_installed`), `desktop/src-tauri/src/lib.rs:172-199` (`spawn_server`)

- [ ] **Step 1: Update `check_clocktopus_installed`**

Replace the body of `check_clocktopus_installed` (currently builds an inline `candidates` array) with:

```rust
#[tauri::command]
fn check_clocktopus_installed() -> bool {
    // GUI apps on macOS don't inherit user shell PATH; probe known paths on disk.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = clocktopus_candidates(&home);
    first_matching(&candidates, |p| std::path::Path::new(p).exists()).is_some()
}
```

- [ ] **Step 2: Update `spawn_server` binary lookup**

In `spawn_server`, replace the inline `candidates` array + `find` (the block that sets `bin`) with:

```rust
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = clocktopus_candidates(&home);
    let Some(bin) = first_matching(&candidates, |p| std::path::Path::new(p).exists()) else {
        return;
    };
```

Leave the rest of `spawn_server` (PATH injection, `.arg("dash")`, spawn) unchanged.

- [ ] **Step 3: Verify build + tests**

Run: `cd desktop/src-tauri && cargo build && cargo test`
Expected: compiles cleanly; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "refactor(desktop): use shared path helpers in check + spawn"
```

---

## Task 3: Add bun detection/install commands; surface install errors

Add `check_bun_installed` and `install_bun`, and change `install_clocktopus` to return `Result<(), String>` so the UI can show failures. Register all in the invoke handler.

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs:162-170` (`install_clocktopus`), add new commands nearby, and `desktop/src-tauri/src/lib.rs:236` (invoke handler)

- [ ] **Step 1: Add `check_bun_installed`**

Add above `install_clocktopus`:

```rust
#[tauri::command]
fn check_bun_installed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = bun_candidates(&home);
    first_matching(&candidates, |p| std::path::Path::new(p).exists()).is_some()
}

#[tauri::command]
fn install_bun() -> Result<(), String> {
    // Official installer; lands the binary at ~/.bun/bin/bun. curl-piped scripts
    // carry no quarantine xattr, so the result runs without Gatekeeper prompts.
    let status = std::process::Command::new("sh")
        .args(["-c", "curl -fsSL https://bun.sh/install | bash"])
        .status()
        .map_err(|e| format!("failed to launch installer: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("bun installer exited with status {status}"))
    }
}
```

- [ ] **Step 2: Change `install_clocktopus` to return `Result`**

Replace `install_clocktopus` with:

```rust
#[tauri::command]
fn install_clocktopus() -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let bun = format!("{home}/.bun/bin/bun");
    let status = std::process::Command::new(&bun)
        .args(["i", "-g", "clocktopus", "--trust"])
        .status()
        .map_err(|e| format!("failed to launch bun: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("clocktopus install exited with status {status}"))
    }
}
```

Note: this changes from `.spawn()` (fire-and-forget) to `.status()` (blocks until done) so success/failure is real. The JS already polls `check_clocktopus_installed` after the call, so blocking is fine.

- [ ] **Step 3: Register the new/changed commands**

Edit the `invoke_handler` at line ~236:

```rust
        .invoke_handler(tauri::generate_handler![start_server, stop_server, check_server, check_bun_installed, install_bun, check_clocktopus_installed, install_clocktopus])
```

- [ ] **Step 4: Verify build + tests**

Run: `cd desktop/src-tauri && cargo build && cargo test`
Expected: compiles cleanly; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add bun bootstrap commands, return install results"
```

---

## Task 4: Rewrite the /error page into a stepped Setup flow

Replace the `error_html` string so the page walks bun → CLI → start, auto-advancing on success, with a Retry button and a copyable manual command on failure.

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs:221` (the `error_html` assignment)

- [ ] **Step 1: Replace the `error_html` assignment**

Replace the entire `let error_html: String = format!(...)` statement (line 221) with the following. Note CSS braces are doubled (`{{`/`}}`) because this is a Rust `format!`; only `{url}` is a real placeholder.

```rust
    let error_html: String = format!("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>*{{margin:0;padding:0;box-sizing:border-box}}:root{{--bg:#1a1d23;--fg:#e1e4e8;--sub:#8b949e;--btn:#238636;--btn-h:#2ea043;--err:#f85149}}@media(prefers-color-scheme:light){{:root{{--bg:#f6f8fa;--fg:#1f2328;--sub:#656d76;--btn:#1a7f37;--btn-h:#2da44e;--err:#cf222e}}}}body{{font-family:-apple-system,sans-serif;background:var(--bg);display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;color:var(--fg);padding:1rem}}h2{{margin-bottom:.4rem;font-size:1.1rem}}p{{color:var(--sub);font-size:.875rem}}button{{margin-top:1.1rem;padding:.55rem 1.4rem;background:var(--btn);border:none;border-radius:8px;color:white;font-size:.9rem;font-weight:500;cursor:pointer}}button:hover:not(:disabled){{background:var(--btn-h)}}button:disabled{{opacity:.5;cursor:not-allowed}}#msg{{font-size:.8rem;color:var(--sub);margin-top:.65rem;min-height:1.1em}}#msg.err{{color:var(--err)}}#cmd{{display:none;margin-top:.6rem;font-family:ui-monospace,monospace;font-size:.72rem;background:rgba(128,128,128,.15);padding:.4rem .5rem;border-radius:6px;color:var(--fg);user-select:all;cursor:copy;word-break:break-all}}</style></head><body oncontextmenu=\"return false;\"><div><h2 id=\"t\">Set up Clocktopus</h2><p id=\"sub\">Install prerequisites to continue.</p><button id=\"b\">Set up Clocktopus</button><div id=\"msg\"></div><div id=\"cmd\"></div></div><script>const DASH_URL='{url}';const invoke=window.__TAURI__.core.invoke;const t=document.getElementById('t'),sub=document.getElementById('sub'),b=document.getElementById('b'),m=document.getElementById('msg'),cmd=document.getElementById('cmd');const sleep=ms=>new Promise(r=>setTimeout(r,ms));function setMsg(text,isErr){{m.textContent=text;m.className=isErr?'err':'';}}function showCmd(text){{if(text){{cmd.textContent=text;cmd.style.display='block';}}else{{cmd.style.display='none';}}}}cmd.onclick=()=>{{navigator.clipboard&&navigator.clipboard.writeText(cmd.textContent);}};async function waitFor(check,label){{setMsg(label,false);for(let i=0;i<120;i++){{if(await invoke(check))return true;await sleep(1500);}}return false;}}function fail(step,err,manual){{setMsg((err||'Step failed')+'',true);showCmd(manual);b.disabled=false;b.textContent='Retry';b.onclick=run;}}async function run(){{b.disabled=true;showCmd('');try{{if(!await invoke('check_bun_installed')){{t.textContent='Installing bun';sub.textContent='Downloading the bun runtime…';b.textContent='Installing bun…';await invoke('install_bun');if(!await waitFor('check_bun_installed','Installing bun…'))return fail('bun','bun install timed out','curl -fsSL https://bun.sh/install | bash');}}if(!await invoke('check_clocktopus_installed')){{t.textContent='Installing Clocktopus';sub.textContent='Installing the Clocktopus CLI…';b.textContent='Installing Clocktopus…';await invoke('install_clocktopus');if(!await waitFor('check_clocktopus_installed','Installing Clocktopus…'))return fail('cli','Clocktopus install timed out','bun i -g clocktopus --trust');}}t.textContent='Starting Clocktopus';sub.textContent='Launching the server…';b.textContent='Starting…';await invoke('start_server');if(!await waitFor('check_server','Waiting for server…'))return fail('server','Server did not start','clocktopus dash');setMsg('',false);location.href=DASH_URL;}}catch(e){{fail('error',(e&&e.toString)?e.toString():'Unexpected error',null);}}}}b.onclick=run;</script></body></html>", url = dashboard_url());
```

- [ ] **Step 2: Verify build**

Run: `cd desktop/src-tauri && cargo build`
Expected: compiles cleanly (string escaping valid).

- [ ] **Step 3: Manual smoke test in dev**

Run: `cd desktop && bun run dev`
Expected: with bun + CLI already installed, the Setup button starts the server and loads the dashboard. (Full fresh-machine matrix is exercised in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): stepped Setup flow with retry and manual fallback"
```

---

## Task 5: Add macOS entitlements + signing config

Configure Tauri to sign with a Developer ID identity (read from env, so no identity string is committed) and a minimal hardened-runtime entitlements file.

**Files:**

- Create: `desktop/src-tauri/entitlements.plist`
- Modify: `desktop/src-tauri/tauri.conf.json` (the `bundle` block)

- [ ] **Step 1: Create the entitlements file**

Create `desktop/src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
</dict>
</plist>
```

Rationale: non-sandboxed Developer ID app. WKWebView needs JIT under hardened runtime. Child processes (bun/CLI) run as separate processes and need no entitlement here. Add more only if Task 7 notarized testing proves it necessary.

- [ ] **Step 2: Add the `bundle.macOS` block**

In `desktop/src-tauri/tauri.conf.json`, replace the `bundle` object with:

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.icns", "icons/128x128@2x.png", "icons/128x128.png", "icons/32x32.png"],
    "macOS": {
      "hardenedRuntime": true,
      "entitlements": "entitlements.plist"
    }
  }
```

Signing identity is supplied at build time via the `APPLE_SIGNING_IDENTITY` env var (Tauri reads it automatically), keeping it out of the repo.

- [ ] **Step 3: Verify config parses**

Run: `cd desktop && bunx tauri build --help`
Expected: command runs without a config parse error (no full build yet).

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/entitlements.plist desktop/src-tauri/tauri.conf.json
git commit -m "build(desktop): hardened-runtime entitlements + macOS signing config"
```

---

## Task 6: Write the release runbook

Document the one-time prerequisites and the repeatable build/notarize/verify commands so releases are reproducible.

**Files:**

- Create: `docs/desktop-release.md`

- [ ] **Step 1: Write the runbook**

Create `docs/desktop-release.md`:

````markdown
# Desktop release (signed + notarized .dmg)

## One-time prerequisites

1. Apple Developer Program membership (already enrolled).
2. Create a **Developer ID Application** certificate:
   - Xcode → Settings → Accounts → your team → Manage Certificates → "+" → "Developer ID Application".
   - Confirm it is installed: `security find-identity -v -p codesigning`
     (note the line like `"Developer ID Application: Your Name (TEAMID)"`).
3. Create notarization credentials (choose one):
   - **App Store Connect API key** (preferred): download the `.p8`, note Key ID + Issuer ID.
   - or an **app-specific password** for your Apple ID (appleid.apple.com → Sign-In & Security).

## Environment (set per shell, never commit)

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
# API key option:
export APPLE_API_KEY="AB12CD34EF"          # Key ID
export APPLE_API_ISSUER="xxxxxxxx-xxxx-..." # Issuer ID
export APPLE_API_KEY_PATH="$HOME/keys/AuthKey_AB12CD34EF.p8"
# OR Apple ID option:
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```
````

## Build + notarize

```sh
cd desktop
bunx tauri build
```

Tauri signs the app, submits it to the Apple notary service, staples the ticket,
and produces the `.dmg` under `desktop/src-tauri/target/release/bundle/`.

## Verify

```sh
APP="src-tauri/target/release/bundle/macos/Clocktopus.app"
DMG="src-tauri/target/release/bundle/dmg/Clocktopus_*.dmg"
codesign --verify --deep --strict --verbose=2 "$APP"   # → valid on disk
spctl -a -vvv "$APP"                                    # → accepted, source=Notarized Developer ID
xcrun stapler validate $DMG                             # → The validate action worked
```

## Final check

Download the `.dmg` on a clean macOS account, open it, drag to Applications, launch.
Gatekeeper must NOT show an "unidentified developer" warning. Then link the `.dmg`
on the website.

````

- [ ] **Step 2: Commit**

```bash
git add docs/desktop-release.md
git commit -m "docs: desktop release runbook for signing + notarization"
````

---

## Task 7: End-to-end verification (manual)

Validate both workstreams on real builds. This task has no code; it gates release.

**Files:** none.

- [ ] **Step 1: Produce a signed + notarized build**

With env vars from the runbook set: `cd desktop && bunx tauri build`
Expected: build completes; notarization succeeds; `.dmg` produced.

- [ ] **Step 2: Run the verification commands**

Run the three verify commands from `docs/desktop-release.md`.
Expected: `codesign` valid; `spctl` → "accepted, source=Notarized Developer ID"; `stapler validate` worked. If `spctl` rejects due to a hardened-runtime/entitlement issue, add the specific entitlement to `entitlements.plist`, rebuild, and re-commit.

- [ ] **Step 3: Fresh-account Setup matrix**

On a clean macOS user account (no bun, no CLI), install the `.app` from the `.dmg` and launch. Walk the Setup button and confirm each scenario:

- no bun, no CLI → bun installs, then CLI installs, then server starts, dashboard loads.
- bun present, no CLI → CLI installs, server starts.
- both present → server starts immediately.
- offline (disable network) → Setup shows an error, a Retry button, and a copyable manual command; Retry works once network returns.

Expected: all scenarios pass. Confirm a hardened-runtime app successfully spawns the curl/bun/CLI children (the key risk from the spec).

- [ ] **Step 4: Record results**

Append a short "Verified on <date> / macOS <version>" note to `docs/desktop-release.md` and commit.

```bash
git add docs/desktop-release.md
git commit -m "docs: record desktop release verification results"
```

```

---

## Notes for the executor

- All `cargo` commands run from `desktop/src-tauri/`; all `tauri`/`bun` commands from `desktop/`.
- Tasks 1–4 are pure local code and need no Apple account — do them first.
- Tasks 5–7 need the signing identity + notarization creds; if those aren't ready, complete 1–4 and pause before Task 5.
- Don't bundle a CLI sidecar or touch `tauri-nspanel`/`macOSPrivateApi` — out of scope.
```
