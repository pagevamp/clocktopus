# Manual Log Time Card

## Summary

Add a "Log Time" card on the Home tab next to the Idle Monitor card so the user can log a completed time entry directly to Clockify (and Jira when a ticket is provided) without running a live timer.

## UI

Location: Home tab, `.cards` grid. New card placed right after the Idle Monitor card so it flows naturally in the existing auto-filling grid.

Fields:

- Project dropdown — reuses the existing `/api/projects` list (populated by the same `loadProjects()` that drives Start Timer).
- Start — `<input type="datetime-local">`, default `now - 1h` (local time).
- End — `<input type="datetime-local">`, default `now` (local time).
- Description — text.
- Jira Ticket — text, optional. Same placeholder style as Start Timer (`PROJ-123`).

Layout: mirrors the Start Timer card styling. Two `form-row` blocks:

1. `[Start | End]`
2. `[Description | Jira Ticket]`

Submit button: `Log Time`.

Result UX: on success, clear description + jira inputs, reset start/end to new defaults, show `msg ok`, call `loadSessions()` so the entry appears in Recent Sessions.

## Validation (client)

- Project must be selected.
- Start and End required; End must be strictly greater than Start.
- Description OR Jira Ticket required (same rule as Start Timer).

Convert the `datetime-local` values to ISO strings (`new Date(value).toISOString()`) before POSTing.

## Backend

New route: `POST /api/timer/log` in `dashboard/routes/timer.ts`.

Request body:

```ts
{ projectId: string; description: string; start: string; end: string; jiraTicket?: string }
```

Server-side steps:

1. Validate fields (mirror client checks, return `400` on failure).
2. Resolve Clockify user; return `500` if unavailable.
3. `clockify.logTime(user.defaultWorkspace, projectId, start, end, description)`. If null, return `500`.
4. Insert a completed row via a new helper `logCompletedSession(id, projectId, description, startedAt, completedAt, jiraTicket)` in `lib/db.ts`. Uses `uuidv4()` for `id`. `isAutoCompleted = 0`.
   - Rationale: the existing `completeLatestSession` updates the newest open session, which could accidentally mark an unrelated active timer complete. A dedicated insert keeps manual entries isolated.
5. If `jiraTicket` is present, compute `timeSpentSeconds = Math.round((endMs - startMs) / 1000)`. If `>= 60`, call `stopJiraTimer(jiraTicket, timeSpentSeconds)`. Swallow errors the same way the existing stop handler does (log, continue).
6. Return `{ ok: true }`.

## Files Touched

- `dashboard/views.ts` — add the new card HTML, the `logManualTime()` JS handler, and call it from `init()` defaults (datetime-local defaults). Reuse existing `setMsg`, `loadSessions`, `escapeHtml`, project-select population.
- `dashboard/routes/timer.ts` — add `POST /timer/log` route.
- `lib/db.ts` — add `logCompletedSession` helper.

## Out of Scope

- Editing or deleting manual entries.
- Bulk manual logging.
- Overlap detection with active timer or existing entries.
- Project default memory between submissions.
