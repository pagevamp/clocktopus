# Tray Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current left-click show/hide behavior with a native-feeling popup: the existing dashboard window repositions itself directly below the tray icon, gains a frosted-glass vibrancy background, and auto-dismisses when focus is lost.

**Architecture:** Add `tauri-plugin-positioner` (window placement near tray) and `tauri-plugin-vibrancy` (native macOS NSVisualEffectView blur). The `main` window becomes frameless and transparent. Left-click positions the window at `TrayCenter` then shows it. `WindowEvent::Focused(false)` hides it. The dashboard body background becomes transparent so the vibrancy blur shows through.

**Tech Stack:** Tauri v2, Rust, tauri-plugin-positioner v2, tauri-plugin-vibrancy v2, TypeScript (Hono dashboard).

**Spec:** `docs/superpowers/specs/2026-04-17-tray-popup-design.md`

---

## File Structure

- `desktop/src-tauri/Cargo.toml` — add `tauri-plugin-positioner` and `tauri-plugin-vibrancy`
- `desktop/src-tauri/Cargo.lock` — updated automatically by cargo
- `desktop/src-tauri/tauri.conf.json` — window: `transparent`, `decorations: false`, `resizable: false`, `visible: false`
- `desktop/src-tauri/src/lib.rs` — register plugins, apply vibrancy, rewrite tray click handler, add focus-lost handler
- `dashboard/views.ts` — `body { background: transparent }`

---

### Task 1: Add plugin dependencies

**Files:**

- Modify: `desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add the two plugins**

Open `desktop/src-tauri/Cargo.toml`. After the `chrono` line at the bottom of `[dependencies]`, add:

```toml
tauri-plugin-positioner = "2"
tauri-plugin-vibrancy = "2"
```

The full `[dependencies]` block should now end with:

```toml
reqwest = { version = "0.13.2", features = ["blocking"] }
png = "0.18.1"
chrono = { version = "0.4", default-features = false, features = ["clock"] }
tauri-plugin-positioner = "2"
tauri-plugin-vibrancy = "2"
```

- [ ] **Step 2: Verify they resolve**

Run: `cd desktop/src-tauri && cargo check`

Expected: `Finished` — dependencies download and compile. If either crate is not found, check that the version specifier `"2"` resolves on crates.io (run `cargo search tauri-plugin-positioner` to confirm the latest v2 version and pin it if needed).

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
git commit -m "feat(desktop): add positioner and vibrancy plugin dependencies"
```

---

### Task 2: Update window configuration

**Files:**

- Modify: `desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Update the main window object**

Open `desktop/src-tauri/tauri.conf.json`. The `windows` array currently contains:

```json
{
  "title": "Clocktopus",
  "width": 420,
  "height": 600,
  "resizable": true,
  "fullscreen": false
}
```

Replace with:

```json
{
  "title": "Clocktopus",
  "width": 420,
  "height": 600,
  "resizable": false,
  "fullscreen": false,
  "transparent": true,
  "decorations": false,
  "visible": false
}
```

- `transparent: true` — required for vibrancy blur to show through the window background
- `decorations: false` — removes title bar and native window chrome; content fills the full window area
- `resizable: false` — a popup/popover should not be user-resizable
- `visible: false` — window starts hidden; shown on left-click (prevents a bare window flash on launch)

- [ ] **Step 2: Verify cargo check still passes**

Run: `cd desktop/src-tauri && cargo check`

Expected: `Finished` — no errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/tauri.conf.json
git commit -m "feat(desktop): configure main window as frameless transparent popup"
```

---

### Task 3: Make dashboard background transparent

**Files:**

- Modify: `dashboard/views.ts`

- [ ] **Step 1: Change body background**

Open `dashboard/views.ts`. Find line 10 (the `body` rule inside the `<style>` block):

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f1117;
  color: #e1e4e8;
  padding: 2rem;
}
```

Change `background: #0f1117` to `background: transparent`:

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: transparent;
  color: #e1e4e8;
  padding: 2rem;
}
```

Cards, inputs, and other elements keep their own dark backgrounds — only the base "canvas" of the page becomes transparent so the OS-level vibrancy blur is visible behind them.

- [ ] **Step 2: Build TypeScript**

Run from repo root: `bun run build`

Expected: `tsc` finishes with no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): transparent body background for vibrancy"
```

---

### Task 4: Wire plugins and update tray behavior

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`

Four changes in sequence: add imports → register plugins + apply vibrancy → rewrite tray click handler → update window focus handler.

- [ ] **Step 1: Add imports**

At the top of `lib.rs`, the current imports are:

```rust
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconId},
    Manager,
};
use std::time::Duration;
```

Add two lines immediately after `use std::time::Duration;`:

```rust
use tauri_plugin_positioner::{Position, WindowExt};
#[cfg(target_os = "macos")]
use tauri_plugin_vibrancy::{MacOSVibrancy, VibrancyExt};
```

- [ ] **Step 2: Register plugins**

In `pub fn run()`, the builder currently starts:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
```

Add positioner registration before `.setup`. Vibrancy does not require plugin registration — it provides only trait extensions:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_positioner::init())
    .setup(|app| {
```

- [ ] **Step 3: Apply vibrancy to the window**

Inside `.setup(|app| {`, the first line is:

```rust
let window = app.get_webview_window("main").unwrap();
```

Immediately after that line, add:

```rust
#[cfg(target_os = "macos")]
window
    .set_vibrancy(MacOSVibrancy::Popover, None, None)
    .expect("failed to apply vibrancy");
```

This applies `NSVisualEffectView` with the `.popover` material — the same frosted-glass macOS uses for system popovers. The `#[cfg]` guard means it compiles cleanly on non-macOS platforms.

- [ ] **Step 4: Rewrite the tray icon event handler**

Find the current `.on_tray_icon_event` closure:

```rust
.on_tray_icon_event(|tray, event| {
    if let tauri::tray::TrayIconEvent::Click {
        button: tauri::tray::MouseButton::Left,
        button_state: tauri::tray::MouseButtonState::Up,
        ..
    } = event
    {
        let win = tray.app_handle().get_webview_window("main").unwrap();
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
})
```

Replace with:

```rust
.on_tray_icon_event(|tray, event| {
    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
    if let tauri::tray::TrayIconEvent::Click {
        button: tauri::tray::MouseButton::Left,
        button_state: tauri::tray::MouseButtonState::Up,
        ..
    } = event
    {
        let win = tray.app_handle().get_webview_window("main").unwrap();
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.move_window(Position::TrayCenter);
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
})
```

`on_tray_event` must be called on every tray event (not just clicks) so the positioner plugin can capture the tray icon's current screen bounds before `move_window` is called. `Position::TrayCenter` places the window horizontally centred below the tray icon.

- [ ] **Step 5: Add focus-lost handler to window event**

Find the current window event handler:

```rust
window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window_clone.hide();
    }
});
```

Replace with:

```rust
window.on_window_event(move |event| {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_clone.hide();
        }
        tauri::WindowEvent::Focused(false) => {
            let _ = window_clone.hide();
        }
        _ => {}
    }
});
```

`Focused(false)` fires when the window loses focus — clicking anywhere outside the popup triggers this and hides the window, matching native popover dismiss behavior.

- [ ] **Step 6: Verify compilation**

Run: `cd desktop/src-tauri && cargo check`

Expected: `Finished` — no errors.

If you see `error[E0425]: cannot find function 'init' in module 'tauri_plugin_vibrancy'`, remove the `.plugin(tauri_plugin_vibrancy::init())` line (vibrancy on this crate version is trait-only, no registration needed).

If you see `error[E0277]: the trait bound ... WindowExt is not satisfied`, ensure `use tauri_plugin_positioner::{Position, WindowExt};` is present.

- [ ] **Step 7: Run the full test suite**

Run: `cd desktop/src-tauri && cargo test`

Expected: 18 tests pass, 0 failed.

- [ ] **Step 8: Manual smoke test (macOS — skip if automated agent)**

Run: `cd desktop && bun run tauri dev`

Verify:

1. App launches — no window appears, only the tray icon shows.
2. Left-click tray icon → dashboard window appears directly below the icon with frosted-glass blur background.
3. Click anywhere outside the window → window hides.
4. Left-click tray icon again → window reappears at the same position.
5. Right-click tray icon → context menu (Stop Timer / Open Dashboard / Quit) appears unchanged.
6. "Open Dashboard" in menu → same window appears.
7. Card and input backgrounds are still dark (only the base body is transparent).

- [ ] **Step 9: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): tray popup with positioner and vibrancy"
```
