# Jira-only Mode — Design

Date: 2026-04-21
Status: Approved for planning

## Goal

Decouple Clockify from Jira so the app works for a user who configures only Jira (no Clockify API key). Today, every timer route short-circuits on a missing/invalid Clockify key, blocking Jira worklogs too.

## Scope

- Jira-only mode supported end-to-end: start/stop timer, manual log entry, delete session, idle monitor, CLI.
- Calendar sync and Google Connect remain Clockify-dependent. They are shown but disabled when Clockify is not configured, with explanatory copy.
- No new abstraction layer. Decoupling is done with inline guards at each call site.

## Non-goals

- Provider abstraction / `TimerProvider` interface.
- Running calendar sync against Jira worklogs.
- Multi-provider simultaneous time logging beyond the existing Clockify + Jira worklog pairing.

## Mode detection

Presence of `CLOCKIFY_API_KEY` (resolved via `resolveCredential`) determines Clockify mode.

- Helper: `isClockifyEnabled(): boolean` added to `lib/credentials.ts`. Returns true iff the key resolves to a non-empty string. No network call.
- The existing `GET /status` endpoint validates the key against Clockify and returns `clockify: boolean`. UI uses this runtime-validated value for conditional rendering.
- Backend route guards use the cheap `isClockifyEnabled()` check. If the key is present but invalid at call time, the Clockify call fails and the handler falls through to the Jira-only path (see Error handling).

## Credential state matrix

| Clockify | Jira | Behavior                                                                         |
| -------- | ---- | -------------------------------------------------------------------------------- |
| ✓        | ✓    | Full mode (current).                                                             |
| ✓        | ✗    | Clockify-only. Jira worklog calls silently skipped (existing tolerant behavior). |
| ✗        | ✓    | **New Jira-only mode.** Timer = DB + Jira worklog. No Clockify calls.            |
| ✗        | ✗    | Bootstrap. Timer creation blocked. UI shows onboarding.                          |

## Architecture

Inline guards at each Clockify-touching call site. Pattern:

```ts
if (isClockifyEnabled()) {
  // existing Clockify flow
}
// always: DB log + Jira worklog
```

The `Clockify` class in `clockify.ts` is unchanged. It is instantiated only inside guarded branches so it never runs without a key.

### Request flow — `/timer/start`

- Both modes: validate input, write `logSessionStart` in DB, schedule Jira worklog post (on stop).
- Clockify mode: call `clockify.startTimer()`; use its returned time-entry id as the session id.
- Jira-only mode: generate session id via `uuidv4()`; `projectId` may be `null`; `jiraTicket` is **required**.

### Request flow — `/timer/stop`, `/timer/log`, `DELETE /timer/:id`

- DB session close / insert / delete always runs.
- Jira worklog post or delete always runs (when ticket/worklog id present).
- Clockify stop / log / delete only runs in Clockify mode.

## Component changes

### `lib/credentials.ts`

- Add `export function isClockifyEnabled(): boolean`.

### `dashboard/routes/timer.ts`

- `GET /timer/active`: if no Clockify key, read from DB `getOpenSession()` only, skip Clockify sync. Return session data or `{active:false}`.
- `POST /timer/start`: if no Clockify key, require `jiraTicket`; on missing, return 400 "Jira ticket required in Jira-only mode". Skip `clockify.startTimer`. Generate uuid session id. `projectId` optional / nullable.
- `POST /timer/stop`: wrap `clockify.stopTimer()` in `isClockifyEnabled()`. DB close + Jira worklog unchanged.
- `POST /timer/log`: wrap `clockify.logTime()` in guard. DB insert + Jira worklog unchanged. When Clockify mode, session id = Clockify entry id; Jira-only, session id = uuid. In Jira-only mode, `jiraTicket` is required (else log has no destination); return 400 "Jira ticket required in Jira-only mode" when missing.
- `DELETE /timer/:id`: wrap `clockify.deleteTimeEntry()` in guard. DB delete + Jira worklog delete unchanged.
- Neither provider configured: `POST /timer/start` and `POST /timer/log` return 400 "No provider configured. Add Clockify or Jira credentials." `stop` and `DELETE` still operate on DB.

### `dashboard/routes/data.ts`

- `POST /projects/fetch`: return 400 "Clockify not configured" when `!isClockifyEnabled()`.
- `GET /projects` and `GET /projects/all` continue to return DB rows (empty list in fresh Jira-only install).

### `dashboard/routes/calendar.ts`

- All endpoints return 400 "Calendar sync requires Clockify" when `!isClockifyEnabled()`.

### `dashboard/routes/google.ts`

- Google OAuth endpoints remain functional (user may already be connected) but the dashboard UI disables the Connect button when Clockify is not configured.

### `scripts/log-calendar-events.ts`

- On startup, check `isClockifyEnabled()`. If false, print "Calendar sync requires Clockify. Configure Clockify API key and re-run." and exit 0.

### `clockify.ts`

- No changes. Constructor and methods untouched.

### `index.ts` (CLI)

- `start`: if `!isClockifyEnabled()`, require `-j <ticket>`; on missing, error "Jira-only mode requires --jira" and exit non-zero. Skip project prompt, skip `clockify.startTimer`, call `logSessionStart` with `projectId: null`.
- `stop`: wrap `clockify.stopTimer()` in guard. DB close + Jira worklog unchanged.
- `status`: read from DB; show Clockify status only if enabled.

### Idle monitor (`dashboard/routes/monitor.ts` + monitor daemon)

- Auto-stop on idle: skip `clockify.stopTimer()` when disabled; DB close + Jira worklog always.
- Auto-resume on activity (cooldown path): skip `clockify.startTimer()` when disabled; create new DB session with uuid + same `jiraTicket` as the previous session.

### `dashboard/views.ts`

- Render logic reads `status` payload.
- Hide/disable based on `status.clockify`:
  - **Home timer form:** if Clockify disabled, hide project dropdown, show "Jira-only mode" chip, make Jira ticket field required. If both Clockify and Jira disabled, hide the form entirely and show onboarding copy.
  - **Projects tab:** hide "Pull from Clockify" button when Clockify disabled. Projects list renders whatever is in DB.
  - **Calendar tab:** visible in nav but disabled (unclickable) when Clockify disabled, with caption "Calendar sync requires Clockify."
  - **Settings — Google Connect button:** rendered but `disabled` when Clockify disabled, with helper text "Calendar sync requires Clockify. Connect Clockify first."
  - **Settings — Clockify card:** always visible (entry point to enable).
  - **Sessions list:** `projectName` column shows "—" when `projectId` is null.
  - **Header status indicator:** show "Jira-only" label when `clockify:false && jira:true`.

## Data model

### `sessions` table

- `projectId` becomes nullable. If the current column was declared `NOT NULL`, emit a migration that creates a new table without the constraint, copies rows, drops and renames. If column is already nullable (check current DDL), no migration.
- `logSessionStart(id, projectId?, description, startedAt, jiraTicket?)` — `projectId` parameter becomes `string | null | undefined`.
- `logCompletedSession(...)` — same treatment for `projectId`.
- `SessionSchema` (zod) — `projectId: z.string().nullable().optional()`.

### Session id source

- Clockify mode: Clockify time-entry id (unchanged).
- Jira-only mode: `uuidv4()` at start/log time.
- No other code depends on id format.

### `projects` table

- Unchanged. Empty in a fresh Jira-only install; `getActiveProjects()` returns `[]`; UI handles empty list.

### Other tables

- No changes. `jiraTicket`, `jiraWorklogId`, `atlassian_tokens`, `google_tokens`, `credentials`, `event_projects` unchanged.

## Error handling

- **Clockify key present but invalid at request time.** Today, timer routes return 500 when `clockify.getUser()` fails. New behavior: log a warning and fall through to the Jira-only DB + worklog path so a Clockify outage does not break Jira logging. UI still shows `clockify:false` from `/status` on next poll.
- **Jira worklog post failure.** Existing `try/catch` preserved. DB session still closes. Not fatal.
- **Jira-only `/timer/start` missing ticket.** 400 with explicit message.
- **Neither provider configured.** `POST /timer/start` and `POST /timer/log` → 400. `POST /timer/stop`, `DELETE /timer/:id`, `GET /timer/active` remain functional against DB so stale sessions can be cleaned up. UI hides the timer form and shows onboarding.
- **Delete with no Clockify.** Clockify delete skipped (guarded). Jira worklog delete runs if `jiraWorklogId` exists. DB row removed always.
- **Idle monitor in Jira-only mode.** Same semantics as manual stop/start: DB + Jira worklog only.

## Testing plan

- Manual: reproduce each matrix row locally by removing/restoring the Clockify key via `data/db` credentials table, exercise start/stop/log/delete and idle monitor, confirm Jira worklogs post with expected `timeSpentSeconds`.
- Regression: full mode (Clockify + Jira) happy path must remain behaviorally unchanged. Verify session ids still match Clockify entry ids and all existing notifications/logs fire.
- Schema: if migration is needed, test against an existing dev DB with sessions already present to confirm no data loss.
- UI: exercise each conditional in `views.ts` against the four matrix rows and confirm correct show/hide/disable.

## Out-of-scope / follow-ups

- Logging calendar events as Jira worklogs.
- Multi-workspace Jira support.
- Provider abstraction refactor.
