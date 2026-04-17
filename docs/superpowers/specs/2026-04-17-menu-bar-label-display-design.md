# Menu Bar Label Display

## Summary

Extend the menu bar timer display (see `2026-04-17-menu-bar-timer-display-design.md`) to show a short label after the elapsed duration — the Jira ticket if one is associated with the running timer, otherwise a trimmed description.

## Goal

Make the running timer glanceable not just by duration but also by what is being worked on, without opening the dashboard.

## Format

`H:MM:SS LABEL`

- Time comes first.
- A single space separates time and label.
- If no label is available (no ticket and no description), fall back to `H:MM:SS` alone.

Examples:

- `0:01:23 JIRA-123`
- `0:01:23 Refactor auth middleware`
- `0:01:23 Implementing new dashboard…` (trimmed from longer description)
- `0:01:23` (no label)

## Label source

1. If the running timer has a Jira ticket (extracted from the description via the existing `extractJiraTicket` helper), use the ticket key as the label (e.g. `JIRA-123`). No trimming — ticket keys are always short.
2. Otherwise, use the description. Trim to 30 characters max: if the description exceeds 30 chars, take the first 29 chars and append `…` (U+2026 HORIZONTAL ELLIPSIS).
3. If neither exists, omit the label entirely.

Trimming is **character-count based**, not byte-count, to avoid cutting mid-UTF8 on multi-byte descriptions.

## API change

`GET /api/timer/active` currently returns:

```json
{ "active": true, "description": "...", "projectId": "...", "start": "..." }
```

Add a `jiraTicket` field (string, optional — omitted when no ticket can be extracted):

```json
{ "active": true, "description": "...", "projectId": "...", "start": "...", "jiraTicket": "JIRA-123" }
```

Computed by calling `extractJiraTicket(timer.description ?? '')` in `dashboard/routes/timer.ts`. When the extractor returns a falsy value, omit the key.

## Rust side

Extend the JSON parse in the poll thread to read:

- `description: Option<String>`
- `jira_ticket: Option<String>`

Cache both on the thread state alongside the existing `start_ms`.

New pure helper:

```rust
fn format_label(jira: Option<&str>, desc: Option<&str>) -> Option<String>
```

Rules:

- If `jira` is `Some` and non-empty, return `Some(jira.to_string())`.
- Else if `desc` is `Some` and non-empty, return `Some(trimmed)` where `trimmed` keeps the first `DESC_MAX_CHARS` characters; if the full string is longer than `DESC_MAX_CHARS`, replace the final character with `…` so the total char count equals `DESC_MAX_CHARS`.
- Else return `None`.

Constant:

```rust
const DESC_MAX_CHARS: usize = 30;
```

Unit-test the helper with cases:

- Only jira → returns jira verbatim
- Only short description → returns description verbatim
- Only long description (> 30 chars) → returns 30 chars ending in `…`
- Jira + description → returns jira (jira wins)
- Empty strings → treated as None
- Neither → returns None
- Multi-byte / emoji description — ensure character-based trimming doesn't panic and produces correct character count

## Title composition

In the tick loop, once per tick:

```
title = format!("{}{}", elapsed, label_suffix)
```

where `label_suffix` is `" LABEL"` when a label exists, `""` otherwise. Then `tray.set_title(Some(&title))`.

## State transitions

- Label refreshes on the same 5-second poll cadence as `start_ms`. A timer whose description is updated mid-session will see the new label within 5 seconds.
- On HTTP/JSON failure, all cached fields (including label) are preserved — same invariant as the existing error-handling path.

## Files touched

- `dashboard/routes/timer.ts` — add `jiraTicket` to the `GET /api/timer/active` response when extractable.
- `desktop/src-tauri/src/lib.rs` — add `format_label` helper + tests, add `description`/`jira_ticket` fields to thread state, extend JSON parse, extend title composition.

## Out of scope

- Truncating the Jira ticket (never needed).
- Per-project custom labels or colors.
- Showing project name alongside the label.
- Rich formatting (bold, color) — NSStatusItem titles are plain text.
- Localizing the ellipsis character.
