# Tray Popup Design

## Summary

Replace the current left-click behavior (show/hide a floating main window) with a native-feeling popup: the existing dashboard window repositions itself below the tray icon, gains a vibrancy blur background, and dismisses when focus is lost.

## Goal

Clicking the tray icon opens the full Clocktopus dashboard as a popover anchored to the status bar — the same UX pattern used by apps like Fantastical, Dato, and Spark — without building a separate compact UI or a native Swift plugin.

## Behavior

### Left-click on tray icon

1. If the window is hidden: reposition it to `TrayCenter` (directly below the tray icon), then show and focus it.
2. If the window is visible: hide it (toggle).

### Click outside the window

`WindowEvent::Focused(false)` fires on the main window → window hides. This matches native popover dismiss behavior.

### Right-click on tray icon

Unchanged — shows existing menu: Stop Timer, Open Dashboard, Quit.

### "Open Dashboard" menu item

Unchanged — shows the main window (which is now also the popup window; the behavior is the same).

## Window Configuration

The existing `main` window gains two new properties in `tauri.conf.json`:

```json
"transparent": true,
"decorations": false
```

- `transparent: true` — allows the vibrancy blur to show through the window background.
- `decorations: false` — removes the title bar and native chrome; the dashboard fills the full window area.
- Size remains 420×600.
- `resizable: false` — a popover should not be user-resizable.

## Vibrancy

Applied to the `main` window via `tauri-plugin-vibrancy` on macOS:

```rust
use tauri_plugin_vibrancy::MacOSVibrancy;
window.set_vibrancy(MacOSVibrancy::Popover, None, None)
```

Material: `.Popover` — the same NSVisualEffectView material macOS uses for system popovers (frosted glass, adapts to dark/light mode).

## Positioning

`tauri-plugin-positioner` moves the window below the tray icon before it is shown:

```rust
use tauri_plugin_positioner::{Position, WindowExt};
window.move_window(Position::TrayCenter)?;
```

The plugin reads the tray icon bounds from the OS and centers the window horizontally below it, with a small vertical offset. This must be called every time before showing, because the tray icon position can change (e.g. if other menu bar items are added/removed).

The tray event handler in `lib.rs` must call `tauri_plugin_positioner::on_tray_event()` to give the plugin the tray bounds on each event.

## Dashboard CSS

The dashboard body background must be transparent so the vibrancy blur is visible:

```css
body {
  background: transparent;
}
```

Without this, the solid dark background covers the blur. Other elements (cards, containers) keep their own backgrounds.

## Files Touched

- `desktop/src-tauri/Cargo.toml` — add `tauri-plugin-positioner` and `tauri-plugin-vibrancy`
- `desktop/src-tauri/tauri.conf.json` — add `transparent: true`, `decorations: false` to the `main` window
- `desktop/src-tauri/capabilities/default.json` — add `positioner:default` permission
- `desktop/src-tauri/src/lib.rs` — register both plugins; update left-click handler to position-then-show; add `on_focus_lost` to hide window; wire `on_tray_event` for positioner
- Dashboard CSS (global stylesheet in `dashboard/views.ts` or a CSS file) — set `body { background: transparent }`

## Out of Scope

- Arrow/caret pointing from the window to the tray icon (requires native Swift NSPopover).
- Compact mini-widget UI (full dashboard shown instead).
- Separate `/popup` route.
- Per-monitor DPI handling beyond what `tauri-plugin-positioner` provides.
- Animations (slide-in, fade) on show/hide.
- Windows or Linux support (vibrancy is macOS-only; positioner works cross-platform).
