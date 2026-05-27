# Sessions Timeline View

## Problem

The Sessions tab in the dashboard currently shows a paginated table of recent sessions. The table is dense and accurate, but it makes it hard to _see_ unaccounted time — gaps between sessions that should have been logged. Users want a visual day view, like Clockify's, where bars sit on a vertical hour axis and empty stretches are immediately obvious.

## Goal

Add a vertical, single-day timeline view to the Sessions tab. It shares the existing data source, lives behind a Table / Timeline toggle, lets the user pick a date, highlights gaps ≥ 30 minutes, and surfaces the day's totals (logged time and gap time).

## Non-goals

- Editing a session's description, times, project, or Jira ticket (delete-only parity with the table).
- Drag-to-create or drag-to-resize on the timeline.
- Multi-day, week, month, or continuous-scroll views.
- Timezones other than the user's local time.
- Sophisticated overlap layout (rare in current data; minimum viable offset only).
- A user-configurable gap threshold (30 min is fixed for v1).
- A new external charting/timeline library.

## Requirements

1. The Sessions tab gets a pill toggle near the top: **Table** | **Timeline**. Default = Table. Selected view persists in `localStorage` (key e.g. `clocktopus.sessions.view`).
2. Timeline view contains:
   - A date row: `‹` prev, the current date as `YYYY-MM-DD`, `›` next, and a `Today` button.
   - A summary strip aligned right in the date row: `Xh Ym logged · N gaps (Xh Ym)`.
   - A timeline canvas: fixed 24h vertical strip, 30px per hour (720px total), scrolls inside its own card.
3. The canvas renders:
   - A left gutter of hour labels (`00:00`, `01:00`, …, `23:00`).
   - Horizontal grid lines, one per hour.
   - Bars for each session that overlaps the selected local day.
   - Red-washed gap blocks between adjacent sessions where the gap ≥ 30 min.
   - A "now" line if the selected date is today.
4. Each session bar shows description (truncated), Jira ticket badge if present, and a project color dot. Native `title` tooltip on hover with full description + project + Jira + start–end + duration.
5. Clicking a session bar opens the same delete-confirm modal already used by the table row.
6. Clicking a gap block: (a) switches the top-level nav to the **Track** tab, (b) switches the Track sub-mode to **Manual Log** (`switchTrackMode('manual')`), (c) ensures the manual form is in start/end mode (not duration mode — the in-flight `manual-range-wrap` / `manual-duration-wrap` toggle), (d) pre-fills `manual-start-date`, `manual-start-time`, `manual-end-date`, `manual-end-time` with the gap's boundaries in local time, (e) focuses `#manual-description`.
7. Cross-midnight sessions are clipped at the selected day's boundary visually; the tooltip shows the full original range.
8. An in-progress session (`completedAt IS NULL`) renders with a dashed border and a `"in progress"` label, and is sized as if `completedAt = now`.
9. Empty state: if no sessions overlap the selected day, the canvas shows hour grid + the text `"No sessions on this date."` Summary still renders (`0h 0m logged · 0 gaps`).
10. The 30-minute gap rule excludes the leading gap (00:00 → first session) and the trailing gap (last session → 24:00 or `now` on today). Only between-session gaps count toward the highlight and the summary's gap stats.

## Architecture

### Components

| Component                  | Type   | Purpose                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db.ts`                | edited | New `getSessionsInRange(fromIso, toIso)`. Single prepared statement: `WHERE startedAt < ? AND (completedAt IS NULL OR completedAt > ?)`, ordered by `startedAt ASC`.                                                                                                                                                                                    |
| `dashboard/routes/data.ts` | edited | Extend existing `GET /api/sessions`: if `from` and `to` query params are present, return _all_ matching sessions (no pagination) by calling `getSessionsInRange`. Response shape stays `{ data, page, limit, total, totalPages }` — when ranged, `page=1`, `limit=data.length`, `total=data.length`, `totalPages=1`. Enrichment (`projectName`) reused. |
| `dashboard/views.ts`       | edited | Add: pill toggle, date row, summary strip, `<div id="timeline-canvas">`, CSS block scoped under `.timeline-*` selectors, and inline JS functions `loadTimeline`, `renderTimeline`, `renderGap`, `computeSummary`, `prefillManualLogFromGap`, `switchSessionsView`.                                                                                      |

No new external dependencies (no `vis-timeline`, no `frappe-gantt`, no SVG library). Vanilla ES5-style JS to match the rest of `views.ts`.

### Data flow

```
User picks date in Timeline view
   ↓
Client computes local-day boundaries:
   fromIso = startOfDay(date).toISOString()
   toIso   = startOfDay(date + 1 day).toISOString()
   ↓
fetch('/api/sessions?from=' + fromIso + '&to=' + toIso)
   ↓
Server: getSessionsInRange(fromIso, toIso) → enriched array
   ↓
Client: renderTimeline(sessions, dateLocal)
   ├── clip each session to [fromIso, toIso]
   ├── compute topPct, heightPct against 24h
   ├── compute between-session gaps (≥ 30 min → red wash)
   ├── compute summary (logged total, gap count, gap total)
   └── DOM update: bars, gaps, hour grid, "now" line, summary text
```

### DOM structure (rendered timeline)

```
<div class="timeline-card">
  <div class="timeline-date-row">
    <button data-action="prev">‹</button>
    <span class="timeline-date-label">2026-05-13</span>
    <button data-action="next">›</button>
    <button data-action="today">Today</button>
    <span class="timeline-summary">5h 23m logged · 3 gaps (1h 12m)</span>
  </div>
  <div class="timeline-canvas" style="height:720px; position:relative;">
    <div class="timeline-gutter">
      <span style="top:0">00:00</span> ... <span style="top:690px">23:00</span>
    </div>
    <div class="timeline-grid">
      <!-- 24 horizontal lines, 30px apart -->
    </div>
    <div class="timeline-track">
      <button class="timeline-bar" style="top:X%; height:Y%" title="...">
        <span class="dot" style="background:#hsl"></span>
        <span class="desc">Working on FOO-12</span>
        <span class="jira">FOO-12</span>
      </button>
      <div class="timeline-gap" style="top:X%; height:Y%" data-from="..." data-to="...">
        Gap · 45m
      </div>
      <!-- "now" line if today -->
      <div class="timeline-now" style="top:X%"></div>
    </div>
  </div>
</div>
```

### Project color

Stable deterministic mapping `projectId → HSL`:

- `hash(projectId) % 360` → hue
- saturation 55%, lightness 50%
- null `projectId` → neutral gray (`#6e7681`)

Reused across timeline bar dot and (future) any other place that wants it. Defined once in the inline JS.

## Edge cases

- **Session spans midnight**: clip to selected day for top/height calc; full range in tooltip; counts toward logged total only for the clipped portion.
- **In-progress session on a past date**: should not happen normally. Skip rendering the bar and emit a `console.warn`. Exclude from logged total and gap calc.
- **Two sessions overlap**: the second bar's `left` shifts to 50% width and a `⚠` marker appears. Acceptable for v1; rare in practice.
- **Date in the future**: allow navigation; canvas is empty, summary is zeros, no "now" line.
- **Server timezone vs client timezone**: server stores ISO UTC. Day boundaries are computed in the _client's_ local TZ. Server query is purely UTC range. No server TZ logic needed.

## Testing

- `lib/db.ts`: unit-test `getSessionsInRange` boundary inclusion (session starting exactly at `to` → excluded; session ending exactly at `from` → excluded; in-progress session whose start is before `to` → included). Reuse existing `better-sqlite3` test pattern in the repo if present; otherwise a small new test file under `lib/`.
- Client-side: manual QA in browser against a seeded day. Cases to cover: empty day, single session, two sessions with a 45-min gap (red wash), session spanning midnight, today with in-progress timer, click bar → delete confirm, click gap → manual-log prefilled.

## Out of scope (deferred)

- Session edit endpoint (`PATCH /api/sessions/:id`) and matching UI.
- Drag-to-resize / drag-to-create.
- Week view, multi-day view, collapsed empty-hour mode.
- Configurable gap threshold setting persisted to DB.
- Keyboard nav for prev/next day (can be added later; arrow keys when canvas is focused).
- Touch / mobile gestures.
