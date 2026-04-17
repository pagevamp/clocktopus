# Menu Bar Timer Display

## Summary

Show the running timer's elapsed duration as text next to the tray icon in the macOS menu bar, formatted `H:MM:SS` and updated every second. When no timer is active, no text is shown.

## Goal

Make the current elapsed time glanceable from the menu bar without opening the dashboard window.

## Architecture

The existing single background thread in `desktop/src-tauri/src/lib.rs` already polls `GET /api/timer/active` every 5 seconds to swap idle/active icons. Extend that thread to also drive the menu bar title text.

Approach:

- Thread sleeps for 1 second per iteration.
- Every 5th tick, it hits `/api/timer/active` and parses `{ active: bool, start: string | undefined }`.
- Thread keeps two pieces of local state:
  - `is_active: bool`
  - `start_ms: Option<i64>` (Unix millis parsed from the ISO string)
- On state-change (active ↔ inactive), the existing icon + tooltip update continues unchanged.
- Every tick:
  - If `is_active && start_ms.is_some()`, compute `elapsed = now - start_ms`, format as `H:MM:SS`, call `tray.set_title(Some(formatted))`.
  - Otherwise call `tray.set_title(None)`.

This keeps API load at the current 1 request / 5s while ticking the displayed time once per second.

## Time format

`H:MM:SS`. Hours are unpadded and always shown (even 0). Minutes and seconds are zero-padded to two digits.

Examples:

- `0:00:05`
- `0:01:23`
- `1:23:45`
- `12:00:00` (12-hour timer)

Negative or zero elapsed (clock skew edge case): treat as `0:00:00`.

## JSON parsing

The current code detects `active` via a string-contains hack. That is insufficient for pulling the `start` ISO field, so introduce proper JSON parsing.

Add `serde_json = "1"` to `desktop/src-tauri/Cargo.toml` under `[dependencies]`. Use it to parse the response body into `serde_json::Value` and read `active` (bool) and `start` (string, optional).

Parse the `start` ISO string (e.g. `2026-04-17T10:30:00Z` or with offset) to Unix millis using `chrono` if already available, otherwise a minimal parser. `reqwest` already pulls `chrono`-compatible features indirectly, but to avoid a new chrono dep, use the simpler approach: parse via `time` crate only if already present; otherwise use a short manual parser that accepts RFC 3339.

Preferred: add `chrono = { version = "0.4", default-features = false, features = ["clock"] }` — it is the idiomatic choice, well-tested, and keeps parsing robust.

## State transitions

1. **Inactive → Active:** poll returns `active: true`, `start: ISO`. Parse `start_ms`. Swap icon to active variant (existing behavior). Start showing title on next tick.
2. **Active → Inactive:** poll returns `active: false`. Clear `start_ms`. Swap icon to idle (existing behavior). Clear title on next tick.
3. **Active → Active (same session):** title keeps ticking; no icon change.
4. **Active → Active (new session, different start):** `start_ms` is refreshed on the 5-second poll; title reflects the new start within 5 seconds.

Case 4 is acceptable: a user who stops and immediately restarts a timer may see a momentary stale elapsed value for up to 5 seconds. Not worth more machinery.

## Error handling

- If the HTTP request fails, timeouts, or the JSON is unparsable: leave `is_active` and `start_ms` unchanged. The title keeps ticking from the last known start, which is the desired behavior when the dashboard is briefly unreachable.
- On sustained failure (dashboard killed): after a few seconds the user will see a stale counter. Acceptable — icon still reflects last known state. No separate "offline" indicator in scope.

## Files Touched

- `desktop/src-tauri/src/lib.rs` — rewrite the background thread loop to sleep 1s, poll every 5 ticks, parse JSON, and drive `tray.set_title()` every tick.
- `desktop/src-tauri/Cargo.toml` — add `serde_json` and `chrono` dependencies.

## Out of Scope

- Linux / Windows menu bar text.
- Configurable format (HH:MM vs HH:MM:SS vs compact).
- Showing the project name or description in the menu bar.
- Click-to-stop from the tray without opening the dashboard.
- Notifications or animations on elapsed thresholds.
