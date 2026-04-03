# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Clocktopus is a CLI-based time-tracking automation tool for Clockify with idle monitoring, Jira integration, and Google Calendar sync. Built with TypeScript (ESM), Hono web framework, better-sqlite3, and PM2 for daemon management.

## Build & Commands

- Build: `bun run build` (runs `bunx tsc`, output in `dist/`)
- Lint: `bun run lint` (eslint with TypeScript parser + Prettier integration)
- Start CLI: `bun run clock start`
- Monitor daemon: `bun run monitor` (PM2-managed background process)
- Monitor control: `bun run monitor:stop`, `bun run monitor:restart`, `bun run monitor:status`, `bun run monitor:logs`
- DB cleanup: `bun run db:cleanup`
- Google auth: `bun run google-auth`
- Calendar logging: `bun run log-calendar`

## Shell Aliases (in ~/.zshrc)

The `clocktopus` function cd's to the project and runs `bun run`. Key aliases:

- `cbuild` / `cstart` / `cstop` — build, start clock, stop clock
- `mstart` / `mstop` / `mrestart` / `mstatus` / `mlogs` — PM2 monitor control
- `cgcalauth` / `cgcal` — Google Calendar auth and logging

## Code Style

- Husky pre-commit hook auto-runs `eslint --fix` and `prettier --write` on staged files
- TypeScript strict mode enabled
- ESM modules (`"type": "module"` in package.json)

## Environment

- Requires `.env` in `data/` with API keys: `CLOCKIFY_API_KEY`, `JIRA_API_KEY`, Google OAuth credentials
- macOS-specific: uses `desktop-idle` and `macos-notification-state` for idle detection
- Linux requires `libxss-dev` and `pkg-config` for `desktop-idle`

## Data

- SQLite database stored in `data/` directory
- Project configuration in `data/projects.json`

## Package Manager

Uses Bun as the package manager and runtime. Use `bun` / `bunx` instead of `yarn` / `npx`.
