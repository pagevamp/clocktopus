# Clocktopus Desktop

A macOS menu bar app built with [Tauri v2](https://v2.tauri.app/) that wraps the Clocktopus dashboard. It provides quick access to start/stop timers from the system tray with a live status indicator.

## Architecture

```
desktop/
├── src-tauri/
│   ├── src/lib.rs          # Main app logic (tray icon, window, timer polling)
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # App config (window size, permissions, bundling)
│   ├── capabilities/       # Security permissions (opener plugin, etc.)
│   ├── icons/              # App and tray icons (generated)
│   └── build.rs            # Tauri build script (auto-generated, don't edit)
└── package.json            # Dev scripts (bun run dev / bun run build)
```

The desktop app is a **thin shell** — it does not contain any business logic. It loads the dashboard UI from `http://localhost:4001` and adds:

- A **system tray icon** (octopus with green status dot when timer is active)
- **Click to toggle** the dashboard window
- **Right-click menu** with "Open Dashboard" and "Quit"
- **Close to tray** — closing the window hides it instead of quitting
- **Timer status polling** — checks `/api/timer/active` every 5 seconds to update the tray icon

## Prerequisites

### 1. Rust

Install via rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Choose option 1 (default). Restart your terminal or run:

```bash
source "$HOME/.cargo/env"
```

Verify:

```bash
rustc --version  # should print 1.77+
cargo --version
```

### 2. Xcode Command Line Tools

```bash
xcode-select --install
```

### 3. Bun (already installed for the main project)

```bash
bun --version
```

## Setup

From the `desktop/` directory:

```bash
cd desktop
bun install
```

This installs the `@tauri-apps/cli` dev dependency. Rust dependencies are fetched automatically on first build.

## Development

**Important**: The dashboard server must be running before launching the desktop app.

### Terminal 1 — Start the dashboard server

```bash
# From the project root
bun run dashboard
```

### Terminal 2 — Start the desktop app in dev mode

```bash
cd desktop
bun run dev
```

The first build takes 3-5 minutes (compiling Rust dependencies). Subsequent builds are fast (~1-2 seconds) thanks to incremental compilation.

Hot reload:

- **Rust changes** (`src-tauri/src/`): Tauri CLI detects changes and recompiles automatically
- **Frontend changes** (`dashboard/views.ts`): Rebuild the main project (`bun run build` in root), then refresh the window

## Building for Production

### Generate the .app and .dmg

```bash
cd desktop
bun run build
```

Output:

```
src-tauri/target/release/bundle/macos/Clocktopus.app    # Standalone app
src-tauri/target/release/bundle/dmg/Clocktopus_0.1.0_aarch64.dmg  # Installer
```

### Install

Drag `Clocktopus.app` to `/Applications`, or open the `.dmg` and drag from there.

**Note**: The dashboard server (`bun run dashboard`) must still be running for the app to work. The desktop app connects to `http://localhost:4001`.

## Custom Icons

### Generating all icon sizes from a single image

Create a 1024x1024 PNG logo with **transparent background** (RGBA, not RGB), then run:

```bash
cd desktop
bunx tauri icon path/to/your-logo-1024x1024.png
```

**Important**: The source PNG must have an alpha channel (transparent background). If exporting from Affinity Designer/Photo, ensure the background layer is hidden and export as PNG with transparency enabled. You can verify with:

```bash
sips -g hasAlpha path/to/your-logo.png
# Should show: hasAlpha: yes
```

This generates all required sizes in `src-tauri/icons/`. After regenerating, rebuild the app:

```bash
cd desktop
bun run build
```

### Icon files

| File        | Size       | Purpose                             |
| ----------- | ---------- | ----------------------------------- |
| `icon.icns` | Multi-size | macOS app icon (.app, .dmg, Dock)   |
| `32x32.png` | 32x32      | Also used as the menu bar tray icon |

### Tray icon

The tray icon uses `src-tauri/icons/32x32.png` (your logo scaled down). When a timer is active, a green status dot is overlaid in the bottom-right corner. This is handled in `src-tauri/src/lib.rs`.

````

## Configuration

### tauri.conf.json

Key settings in `src-tauri/tauri.conf.json`:

```jsonc
{
  "app": {
    "withGlobalTauri": true, // Exposes window.__TAURI__ to frontend JS
    "windows": [
      {
        "title": "Clocktopus",
        "width": 420, // Window dimensions
        "height": 600,
        "resizable": true,
      },
    ],
  },
  "build": {
    "frontendDist": "http://localhost:4001", // Dashboard URL
    "devUrl": "http://localhost:4001",
  },
}
````

### Capabilities (permissions)

`src-tauri/capabilities/default.json` controls what the app can do:

- `core:default` — basic window management
- `opener:default` — open URLs in system browser (used for OAuth flows)

### Rust dependencies (Cargo.toml)

| Crate                 | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `tauri`               | Core framework (with `tray-icon`, `image-png` features) |
| `tauri-plugin-opener` | Open external URLs in system browser                    |
| `reqwest`             | HTTP client for polling timer status                    |

## How It Works

### Tray Icon

1. On launch, a system tray icon is created with the octopus shape
2. A background thread polls `GET /api/timer/active` every 5 seconds
3. When timer state changes, the icon swaps between:
   - **Idle**: white octopus, no dot
   - **Active**: white octopus + green dot (bottom-right corner)
4. Tooltip updates to "Clocktopus - Timer running" when active

### Window Behavior

- **Left-click** tray icon: toggles window visibility
- **Right-click** tray icon: context menu (Open Dashboard / Quit)
- **Close button** (red X): hides window to tray instead of quitting
- Window loads `http://localhost:4001` (same as opening in a browser)

### OAuth (Jira/Google)

The dashboard detects when running inside Tauri (`window.__TAURI__`) and opens OAuth URLs in the system browser via the opener plugin, instead of navigating away from the dashboard.

## Troubleshooting

### "Could not connect" / blank window

The dashboard server isn't running. Start it:

```bash
bun run dashboard
```

### Multiple tray icons

Kill all instances and restart:

```bash
pkill -f "target/debug/app" && pkill -f "target/release/Clocktopus"
cd desktop && bun run dev
```

### First build is slow

Normal — Rust compiles ~400 crates on the first build. Subsequent builds only recompile changed code.

### App not signed (macOS Gatekeeper warning)

When opening the built `.app`, macOS may block it. Right-click > Open > Open to bypass, or sign it:

```bash
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/Clocktopus.app
```

For distribution, you'll need an Apple Developer certificate.

### Tray icon not updating

Check that the dashboard server is reachable at `http://localhost:4001/api/timer/active`. The poller silently retries on failure.
