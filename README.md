# Clocktopus

<p align="center">
  <img src="assets/logo.png" alt="Clocktopus Logo" width="300px" />
</p>

CLI-based time-tracking automation for Clockify with idle monitoring, Jira integration, Google Calendar sync, and a web dashboard.

## Quick Start

Most users only need the dashboard — a web UI to manage timers, connect integrations, and monitor idle time.

### Prerequisites

[Bun](https://bun.sh) is required (used as the runtime):

```bash
curl -fsSL https://bun.sh/install | bash
```

### Install

```bash
bun install -g clocktopus --trust
```

> **Note:** `--trust` allows the postinstall script to build native addons (required for idle monitor on macOS). Without it, addon compilation is skipped and the monitor may fail to load.

### Run

```bash
# Start dashboard in foreground
clocktopus dash

# Or as a background daemon
clocktopus serve
```

Open [http://localhost:4001](http://localhost:4001) in your browser.

### Setup

1. Go to **Settings** tab
2. Enter your **Clockify API key** ([get one here](https://app.clockify.me/manage-api-keys))
3. Click **Pull from Clockify** in the Projects tab
4. Optionally connect **Jira** and **Google Calendar** with one click

That's it. Start/stop timers from the Home tab.

### Commands

| Command                   | Description                             |
| ------------------------- | --------------------------------------- |
| `clocktopus dash`         | Start dashboard (foreground)            |
| `clocktopus serve`        | Start dashboard as background daemon    |
| `clocktopus serve:stop`   | Stop the dashboard daemon               |
| `clocktopus serve:logs`   | View dashboard daemon logs              |
| `clocktopus start`        | Start a timer (interactive)             |
| `clocktopus stop`         | Stop the current timer                  |
| `clocktopus status`       | Check timer status                      |
| `clocktopus monitor`      | Start idle monitor as background daemon |
| `clocktopus monitor:stop` | Stop the idle monitor                   |
| `clocktopus monitor:logs` | View idle monitor logs                  |

### Desktop App (macOS)

A menu bar app is available — download the `.dmg` from [GitHub Releases](https://github.com/sajxraj/clocktopus/releases).

After installing, remove the quarantine flag (app is not code-signed):

```bash
xattr -cr /Applications/Clocktopus.app
```

The dashboard server must be running (`clocktopus serve`). See [desktop/README.md](desktop/README.md) for details.

---

## Development

### Install from Source

```bash
git clone https://github.com/sajxraj/clocktopus.git
cd clocktopus
bun install
bun run build
```

### Local Commands

When running from source, use `bun run clock` instead of `clocktopus`:

```bash
bun run build                  # Build TypeScript

bun run dashboard              # Start dashboard (foreground)
bun run clock start "Task"     # Start a timer
bun run clock start -j PROJ-1  # Start with Jira ticket
bun run clock stop             # Stop timer
bun run clock status           # Check timer status

bun run monitor                # Start idle monitor (PM2 daemon)
bun run monitor:stop           # Stop monitor
bun run monitor:restart        # Restart monitor
bun run monitor:logs           # View monitor logs

bun run google-auth            # Authenticate Google account
bun run log-calendar -t        # Log today's events
bun run db:cleanup             # Clean old session logs
```

### Configuration

All configuration is stored in a local SQLite database and managed through the dashboard Settings tab.

| Setting          | How to configure                                 |
| ---------------- | ------------------------------------------------ |
| Clockify API Key | Dashboard > Settings > Clockify                  |
| Jira (OAuth)     | Dashboard > Settings > Click "Connect Atlassian" |
| Jira (API token) | Dashboard > Settings > "or use API token"        |
| Google Calendar  | Dashboard > Settings > Click "Connect Google"    |

OAuth for Jira and Google is handled transparently through a [Cloudflare Worker proxy](docs/atlassian-proxy-flow.md) — no client credentials needed from users.

### Project Structure

```
clocktopus/
├── index.ts              # CLI entry point (Commander)
├── clockify.ts           # Clockify API client
├── lib/                  # Core libraries (db, auth, credentials)
├── dashboard/            # Web dashboard (Hono server)
│   ├── server.ts         # Dashboard server
│   ├── views.ts          # HTML/CSS/JS (single-page app)
│   └── routes/           # API routes
├── desktop/              # Tauri macOS menu bar app
├── proxy/                # Cloudflare Worker (OAuth proxy)
├── scripts/              # Google auth & calendar scripts
└── data/                 # SQLite DB & config (gitignored)
```

---

## Troubleshooting

### No notifications on macOS

Go to **System Settings > Notifications** and ensure **terminal-notifier** has notifications enabled.

### Monitor not detecting display off

Enable **Require password immediately** in System Settings > Lock Screen.

### Uninstall

Remove the global install using whichever package manager you used:

```bash
# If installed via npm/npx
npm uninstall -g clocktopus

# If installed via bun (bun global uninstall is unreliable — delete the binary directly)
rm ~/.bun/bin/clocktopus
```

### Bun installs an old version

Bun caches registry data aggressively. Clear the cache and reinstall:

```bash
bun pm cache rm && bun i -g clocktopus@latest
```

### Native addons not built (untrusted postinstall)

Bun skips postinstall scripts for untrusted packages. Install with `--trust` to fix this:

```bash
bun install -g clocktopus --trust
```

Or if already installed, rebuild manually:

```bash
cd ~/.bun/install/global/node_modules/macos-notification-state && npx node-gyp rebuild
```

### Linux

```bash
apt install libxss-dev pkg-config build-essential
```

## License

MIT
