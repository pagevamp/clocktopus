# Jira Tab — Design

Date: 2026-05-27

## Summary

Add a new dashboard tab, **Jira**, that lets the user log Jira worklogs directly
against their open work. The tab shows a project dropdown and, for the selected
project, a list of the user's _To Do_ tickets with estimated/spent hours and a
per-row control to add a worklog.

## Goals

- Surface the user's To Do tickets without leaving the dashboard.
- Log a Jira worklog (timeSpent) against a ticket in a few clicks.
- Reuse existing Jira auth (`jiraApiRequest`, OAuth + Basic fallback) and the
  12h worklog cap.

## Non-Goals

- No Clockify time entry creation from this tab (Jira worklog only).
- No editing/deleting existing worklogs.
- No ticket creation or status changes.

## User Flow

1. User opens the **Jira** tab.
2. Dashboard fetches the user's To Do tickets, grouped by project.
3. A `<select>` lists the projects that have matching tickets. First project is
   selected by default.
4. Changing the dropdown renders that project's tickets.
5. Each ticket row shows: title (`KEY — summary`), estimated hours, spent hours,
   an hours input, an optional note input, and a **check-icon button** that
   submits the worklog.
6. The check-icon button is disabled until hours > 0. Clicking it posts the
   worklog; on success the spent-hours cell increments, inputs clear, and a
   toast confirms. On failure an inline error shows and inputs are preserved.

## Architecture

Follows existing pattern (approach A): JQL search lives in `lib/jira.ts`, one
new read route + one write route in `dashboard/routes/jira.ts`, and tab markup
plus inline JS in `dashboard/views.ts`. No new dependencies.

### Backend — `lib/jira.ts`

**`getMyTodoIssues()`**

- JQL: `assignee = currentUser() AND statusCategory = "To Do" ORDER BY project`
- Fields requested: `summary,project,timetracking`
- Uses existing `jiraApiRequest` against the issue search endpoint.
- Returns grouped shape:
  ```ts
  type JiraIssue = {
    key: string; // e.g. "ABC-123"
    summary: string;
    estimateSeconds: number | null; // timetracking.originalEstimateSeconds
    spentSeconds: number; // timetracking.timeSpentSeconds, default 0
  };
  type JiraProjectGroup = {
    projectKey: string;
    projectName: string;
    issues: JiraIssue[];
  };
  // getMyTodoIssues(): Promise<JiraProjectGroup[]>
  ```
- Returns `[]` when the search yields nothing. Returns `null` on API/auth
  failure (mirrors existing `jiraApiRequest` null-on-error convention).

**`logJiraWorklog(ticketId, seconds, comment)`**

- Validates `seconds` is finite, `> 0`, and `<= MAX_WORKLOG_SECONDS` (12h);
  refuses otherwise (same guard as `stopJiraTimer`).
- Posts worklog to `/issue/${ticketId}/worklog` with `timeSpentSeconds` and an
  ADF comment built from `comment` (falls back to `"Logged from Clocktopus"`
  when empty).
- Returns `{ id } | null`.
- `stopJiraTimer` stays unchanged; the two share the cap constant.

### Backend — `dashboard/routes/jira.ts`

**`GET /jira/issues`**

- Calls `getMyTodoIssues()`.
- `null` → `{ ok: false, reason: 'not_connected' }` (HTTP 200; UI decides
  messaging — `null` here also covers transient API errors, treated as
  "can't load").
- Array → `{ ok: true, projects: JiraProjectGroup[] }`.

**`POST /jira/worklog`**

- Body: `{ ticketId: string, hours: number, note?: string }`.
- Validates `ticketId` present and `hours` is a finite number `> 0` and
  `<= 12`. Converts hours → seconds (`Math.round(hours * 3600)`).
- Calls `logJiraWorklog(ticketId, seconds, note)`.
- Success → `{ ok: true, addedSeconds: seconds }`. Failure → `{ ok: false,
error }` with HTTP 400/502 as appropriate.

### Frontend — `dashboard/views.ts`

- **Nav**: add `<button class="nav-btn" onclick="switchTab('jira')"
id="nav-jira">Jira</button>` after Calendar.
- **Tab content**: `<div id="tab-jira" class="tab-content">` containing:
  - a project `<select id="jira-project">`,
  - a `<div id="jira-list">` for ticket rows,
  - loading / empty / not-connected message slots.
- **JS functions** (inline, matching existing style):
  - `loadJira()` — fetch `/jira/issues` once per tab-open, cache result in a
    module-scoped variable, populate the dropdown, render first project.
  - `renderJiraProject(projectKey)` — render rows for the selected project.
  - `saveWorklog(ticketKey, rowEl)` — read hours + note, POST, update spent
    cell, clear inputs, toast; on error show inline message.
  - Hook `switchTab('jira')` to call `loadJira()` on first activation.
- **Row markup**: reuse `.table-wrap` + a `min-width` table like
  `.sessions-table` for horizontal scroll. Under ~560px, rows restyle to
  stacked cards (CSS media query), keeping inputs and the check button usable.
- **Check-icon button**: a `.nav-btn`-style icon button (✓), `disabled` until
  the row's hours input parses to a number `> 0`. Disabled again during the
  in-flight request to prevent double-submit.

## Display / Conversion

- Hours shown to one decimal (e.g. `2.5h`). Seconds → hours = `s / 3600`.
- Estimate cell shows `—` when `estimateSeconds` is null.
- Spent cell starts from `spentSeconds`; after a successful save it increases by
  the posted hours (no refetch needed).

## States & Errors

- **Not connected** (`reason: 'not_connected'`): show "Connect Jira in
  Settings" with no dropdown/list.
- **Empty** (`projects: []`): show "No To Do tickets assigned to you".
- **Loading**: spinner / "Loading…" until the fetch resolves.
- **Save failure**: inline error on the row; inputs preserved; button
  re-enabled.

## Testing

Unit tests in `lib/jira.test.ts` (mirrors `lib/jira-summary.test.ts`):

- hours → seconds conversion and rounding.
- `logJiraWorklog` cap rejection (`> 12h`, `<= 0`, non-finite) returns null
  without posting.
- grouping/parse: a sample search response maps to `JiraProjectGroup[]` with
  correct `estimateSeconds` / `spentSeconds` extraction and null-estimate
  handling.

Route-level validation (rejecting `hours <= 0`, missing `ticketId`) covered by
the same conversion/guard logic.
