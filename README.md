# Clocktopus

<p align="center">
  <img src="assets/logo.png" alt="Clocktopus Logo" width="300px" />
</p>

CLI-based time-tracking automation for Clockify with idle monitoring, Jira integration, Google Calendar sync, and a web dashboard.

## Quick Start (Dashboard User)

Most users only need the dashboard — a web UI to manage timers, connect integrations, and monitor idle time.

### Install

```bash
npm i -g clocktopus
```

Requires [Bun](https://bun.sh) runtime:

```bash
curl -fsSL https://bun.sh/install | bash
```

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

### Dashboard Commands

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `clocktopus dash`       | Start dashboard (foreground)         |
| `clocktopus serve`      | Start dashboard as background daemon |
| `clocktopus serve:stop` | Stop the dashboard daemon            |
| `clocktopus serve:logs` | View dashboard daemon logs           |

### Desktop App (macOS)

A menu bar app is available — download the `.dmg` from [GitHub Releases](https://github.com/sajxraj/clocktopus/releases).

After installing, remove the quarantine flag (app is not code-signed):

```bash
xattr -cr /Applications/Clocktopus.app
```

The dashboard server must be running (`clocktopus serve`). See [desktop/README.md](desktop/README.md) for details.

---

## Power User Guide

For CLI-based workflows, scripting, and advanced features.

### Install from Source

```bash
git clone https://github.com/sajxraj/clocktopus.git
cd clocktopus
bun install
bun run build
```

### Local Development

When running from source, use `bun run clock` instead of `clocktopus`:

```bash
# Build first
bun run build

# Dashboard
bun run dashboard              # Start dashboard (foreground)

# Timer
bun run clock start "Task"     # Start a timer
bun run clock start -j PROJ-1  # Start with Jira ticket
bun run clock stop             # Stop timer
bun run clock status           # Check timer status

# Monitor
bun run monitor                # Start idle monitor (PM2 daemon)
bun run monitor:stop           # Stop monitor
bun run monitor:restart        # Restart monitor
bun run monitor:status         # Check monitor status
bun run monitor:logs           # View monitor logs

# Google Calendar
bun run google-auth            # Authenticate Google account
bun run log-calendar -t        # Log today's events

# Database
bun run db:cleanup             # Clean old session logs
```

### CLI Commands

#### Timer Management

```bash
# Start a timer (interactive project selection)
clocktopus start "Task description"

# Start with a Jira ticket (auto-fetches ticket title)
clocktopus start -j TICKET-123

# Stop the current timer
clocktopus stop

# Check timer status
clocktopus status
```

#### Idle Monitor

Automatically stops timers when you're idle (5 min) or lock your screen, and restarts when you're back.

```bash
# Run in foreground
clocktopus monitor

# Or manage via dashboard UI (Start/Stop/Restart buttons)
```

The dashboard's Idle Monitor buttons use PM2 under the hood:

| Action      | What it does                   |
| ----------- | ------------------------------ |
| **Start**   | Launches monitor as PM2 daemon |
| **Stop**    | Stops the monitor daemon       |
| **Restart** | Restarts after code changes    |

#### Google Calendar Integration

Log Google Calendar events as Clockify time entries.

```bash
# Authenticate (one-time)
clocktopus google-auth

# Log events for a date range
clocktopus log-calendar -s 2025-07-21 -e 2025-07-22

# Log today's events
clocktopus log-calendar -t
```

For each event, you'll be prompted to select a Clockify project. Selections are cached by event name for recurring meetings.

#### Database Cleanup

```bash
# Delete session logs older than 5 days (default)
clocktopus db:cleanup

# Delete logs older than N days
clocktopus db:cleanup 10
```

### Configuration

All configuration is stored in a local SQLite database (`data/sessions.db`) and managed through the dashboard Settings tab. No `.env` file is needed.

| Setting          | How to configure                                 |
| ---------------- | ------------------------------------------------ |
| Clockify API Key | Dashboard > Settings > Clockify                  |
| Jira (OAuth)     | Dashboard > Settings > Click "Connect Atlassian" |
| Jira (API token) | Dashboard > Settings > "or use API token"        |
| Google Calendar  | Dashboard > Settings > Click "Connect Google"    |

#### OAuth Architecture

- **Jira**: OAuth tokens are exchanged through a [Cloudflare Worker proxy](docs/atlassian-proxy-flow.md) that holds the client secret securely. Users just click Connect.
- **Google**: Uses a Desktop-type OAuth client. Credentials are handled transparently.
- **Clockify**: Each user provides their own API key.

#### Environment Variables (Optional Override)

Power users can override credentials via environment variables or a `.env` file:

```
CLOCKIFY_API_KEY="your_key"
ATLASSIAN_CLIENT_ID="your_id"
ATLASSIAN_CLIENT_SECRET="your_secret"
GOOGLE_CLIENT_ID="your_id"
GOOGLE_CLIENT_SECRET="your_secret"
```

The app checks the database first, then falls back to environment variables.

### Local Project Filtering (CLI only)

On first `clocktopus start`, all projects are saved to `data/local-projects.json`. Edit this file to keep only your frequently used projects:

```json
[
  { "id": "671b783fbd91bc5e5ddcb944", "name": "Project A" },
  { "id": "another_id", "name": "Project B" }
]
```

### Shell Aliases

For quick access, add to `~/.zshrc`:

```bash
CLOCKTOPUS_PATH="$HOME/Projects/Personal/clocktopus"

clockto() {
  cd "$CLOCKTOPUS_PATH" || return
  bun run "$@"
}

alias cbuild="clockto build"
alias cstart="clockto clock start"
alias cstop="clockto clock stop"
alias mstart="clockto monitor"
alias mstop="clockto monitor:stop"
alias mrestart="clockto monitor:restart"
alias mlogs="clockto monitor:logs"
```

---

## Troubleshooting

### No notifications on macOS

Go to **System Settings > Notifications** and ensure **terminal-notifier** (or your terminal app) has notifications enabled.

### Monitor not detecting display off

The idle monitor detects screen lock and system idle (5 min). If your Mac's display turns off without locking, enable **Require password immediately** in System Settings > Lock Screen.

### Linux Requirements

```bash
apt install libxss-dev pkg-config build-essential
```

---

## Project Structure

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

## License

MIT
