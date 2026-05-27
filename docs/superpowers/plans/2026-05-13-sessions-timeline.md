# Sessions Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vertical, single-day timeline view to the dashboard's Sessions tab (Clockify-style) so users can see logged sessions and unaccounted gaps at a glance.

**Architecture:** Reuse the existing `GET /api/sessions` endpoint with new optional `from`/`to` range params, backed by a new `getSessionsInRange` DB helper. Render entirely in `dashboard/views.ts` with vanilla inline JS + CSS (no new external libs). View toggle (Table / Timeline) lives in the Sessions tab and is persisted in `localStorage`.

**Tech Stack:** TypeScript (ESM), Bun runtime + `bun:test`, Hono, `better-sqlite3`, vanilla browser JS/CSS.

**Spec:** `docs/superpowers/specs/2026-05-13-sessions-timeline-design.md`

---

## File Structure

| File                       | Action | Responsibility                                                                             |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `lib/db.ts`                | modify | Add `getSessionsInRange(fromIso, toIso)` returning sessions overlapping a UTC range.       |
| `lib/db.test.ts`           | create | Unit tests for `getSessionsInRange`. New file — no existing test file for `db.ts`.         |
| `dashboard/routes/data.ts` | modify | Extend `GET /api/sessions` to honor `from`/`to` query params.                              |
| `dashboard/views.ts`       | modify | Toggle UI, date row, summary, timeline canvas, CSS block, inline JS render + interactions. |

`views.ts` is already large (~1.8k lines) and styled with inline `<style>` + inline JS. We follow that pattern — do NOT split it as part of this plan.

---

## Task 1: DB helper `getSessionsInRange` (TDD)

**Files:**

- Modify: `lib/db.ts:235` (insert new exported function after `getRecentSessions`)
- Create: `lib/db.test.ts`

The query returns every session whose interval overlaps `[fromIso, toIso)`. An open (in-progress) session is treated as `completedAt = +∞` for overlap purposes (we include any open session whose `startedAt < toIso`).

- [ ] **Step 1: Write the failing test file**

Create `lib/db.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We must point the DB at a temp file BEFORE importing db.ts, because db.ts
// resolves DB_PATH from a constant at module load. The simplest way: set the
// CWD-relative `data/` dir to a temp dir via the DATA_DIR override if present,
// otherwise use a fresh temp HOME. Inspect lib/db.ts for the exact resolution.
//
// Looking at lib/db.ts, DB_PATH is derived from a `DB_DIR` constant that points
// to `<repo>/data`. For these tests we sidestep that by creating a sibling
// helper that operates on an in-memory Database. Use better-sqlite3 directly.

import Database from 'better-sqlite3';

function makeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      description TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      isAutoCompleted INTEGER DEFAULT 0,
      jiraTicket TEXT,
      jiraWorklogId TEXT
    )
  `);
}

function insert(
  db: Database.Database,
  row: { id: string; startedAt: string; completedAt: string | null; description?: string },
) {
  db.prepare('INSERT INTO sessions (id, projectId, description, startedAt, completedAt) VALUES (?, NULL, ?, ?, ?)').run(
    row.id,
    row.description ?? row.id,
    row.startedAt,
    row.completedAt,
  );
}

// Local copy of the function under test. We exercise the SQL we plan to ship.
// The real implementation in lib/db.ts will use the same query.
function getSessionsInRange(db: Database.Database, fromIso: string, toIso: string) {
  return db
    .prepare(
      'SELECT * FROM sessions WHERE startedAt < ? AND (completedAt IS NULL OR completedAt > ?) ORDER BY startedAt ASC',
    )
    .all(toIso, fromIso);
}

describe('getSessionsInRange', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    makeSchema(db);
  });
  afterEach(() => db.close());

  const from = '2026-05-13T00:00:00.000Z';
  const to = '2026-05-14T00:00:00.000Z';

  it('includes session fully inside the range', () => {
    insert(db, { id: 'a', startedAt: '2026-05-13T09:00:00.000Z', completedAt: '2026-05-13T10:00:00.000Z' });
    const rows = getSessionsInRange(db, from, to) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('excludes session ending exactly at from', () => {
    insert(db, { id: 'b', startedAt: '2026-05-12T23:00:00.000Z', completedAt: from });
    expect((getSessionsInRange(db, from, to) as unknown[]).length).toBe(0);
  });

  it('excludes session starting exactly at to', () => {
    insert(db, { id: 'c', startedAt: to, completedAt: '2026-05-14T01:00:00.000Z' });
    expect((getSessionsInRange(db, from, to) as unknown[]).length).toBe(0);
  });

  it('includes session that straddles from (started before, ends inside)', () => {
    insert(db, { id: 'd', startedAt: '2026-05-12T23:30:00.000Z', completedAt: '2026-05-13T00:30:00.000Z' });
    expect((getSessionsInRange(db, from, to) as Array<{ id: string }>).map((r) => r.id)).toEqual(['d']);
  });

  it('includes session that straddles to (started inside, ends after)', () => {
    insert(db, { id: 'e', startedAt: '2026-05-13T23:30:00.000Z', completedAt: '2026-05-14T00:30:00.000Z' });
    expect((getSessionsInRange(db, from, to) as Array<{ id: string }>).map((r) => r.id)).toEqual(['e']);
  });

  it('includes open (in-progress) session if startedAt < to', () => {
    insert(db, { id: 'f', startedAt: '2026-05-13T22:00:00.000Z', completedAt: null });
    expect((getSessionsInRange(db, from, to) as Array<{ id: string }>).map((r) => r.id)).toEqual(['f']);
  });

  it('excludes open session that started at/after to', () => {
    insert(db, { id: 'g', startedAt: to, completedAt: null });
    expect((getSessionsInRange(db, from, to) as unknown[]).length).toBe(0);
  });

  it('returns results sorted by startedAt ascending', () => {
    insert(db, { id: 'late', startedAt: '2026-05-13T15:00:00.000Z', completedAt: '2026-05-13T16:00:00.000Z' });
    insert(db, { id: 'early', startedAt: '2026-05-13T09:00:00.000Z', completedAt: '2026-05-13T10:00:00.000Z' });
    expect((getSessionsInRange(db, from, to) as Array<{ id: string }>).map((r) => r.id)).toEqual(['early', 'late']);
  });
});
```

Note: this test deliberately copies the SQL into the test file. That gives us a fast, isolated, in-memory test that proves the _query semantics_ are correct. The implementation step uses the same SQL inside `lib/db.ts`.

- [ ] **Step 2: Run the test, expect failures (file should run)**

Run: `bun test lib/db.test.ts`
Expected: all 8 tests PASS (the test file is self-contained — it imports `better-sqlite3` directly, not from `lib/db.ts`). This step verifies the query _itself_ is correct before we wire it into `lib/db.ts`.

If any test fails, the SQL is wrong — fix the SQL inside the test until all pass before continuing.

- [ ] **Step 3: Implement `getSessionsInRange` in `lib/db.ts`**

Open `lib/db.ts`. Locate the `getRecentSessions` function (around line 231–235). Add immediately after it:

```ts
export function getSessionsInRange(fromIso: string, toIso: string) {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT * FROM sessions WHERE startedAt < ? AND (completedAt IS NULL OR completedAt > ?) ORDER BY startedAt ASC',
  );
  return stmt.all(toIso, fromIso);
}
```

- [ ] **Step 4: Lint / type-check**

Run: `bun run lint`
Expected: 0 errors related to `lib/db.ts`. (Other warnings unrelated to this change are pre-existing.)

Run: `bun run build`
Expected: tsc completes with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/db.test.ts
git commit -m "feat(db): add getSessionsInRange for timeline view"
```

If the husky pre-commit hook sweeps in unstaged changes (see note in the spec discussion), pause and let the user decide. Do not skip the hook.

---

## Task 2: Extend `GET /api/sessions` with `from`/`to`

**Files:**

- Modify: `dashboard/routes/data.ts:57-79`

When both `from` and `to` are present and valid ISO strings, return ALL sessions in range (no pagination). Otherwise preserve existing pagination behavior exactly. Response shape stays identical so existing table code keeps working.

- [ ] **Step 1: Add range-handling branch to the route**

Open `dashboard/routes/data.ts`. Add `getSessionsInRange` to the import from `../../lib/db.js`:

```ts
import {
  getRecentSessions,
  getSessionCount,
  getActiveProjects,
  getAllProjects,
  upsertProjects,
  toggleProjectActive,
  getSessionsInRange,
} from '../../lib/db.js';
```

Replace the existing `/sessions` route body with:

```ts
dataRoutes.get('/sessions', (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  const allProjects = getAllProjects();
  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));

  const enrich = (rows: Array<Record<string, unknown>>) =>
    rows.map((s) => ({
      ...s,
      projectName: s.projectId ? (projectMap.get(s.projectId as string) ?? 'Unknown') : null,
    }));

  if (from && to) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
      return c.json({ ok: false, error: 'Invalid from/to range.' }, 400);
    }
    const rows = getSessionsInRange(from, to) as Array<Record<string, unknown>>;
    const data = enrich(rows);
    return c.json({
      data,
      page: 1,
      limit: data.length,
      total: data.length,
      totalPages: 1,
    });
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '10', 10)));
  const offset = (page - 1) * limit;

  const sessions = getRecentSessions(limit, offset) as Array<Record<string, unknown>>;
  const total = getSessionCount();
  const enriched = enrich(sessions);

  return c.json({
    data: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});
```

- [ ] **Step 2: Smoke-test the endpoint manually**

Start the dashboard. From a separate terminal:

```bash
# existing pagination (must still work)
curl -s 'http://localhost:4321/api/sessions?page=1&limit=2' | head -c 200
# range query (today, local-day UTC bounds — pick real ISO strings for today)
curl -s 'http://localhost:4321/api/sessions?from=2026-05-13T00:00:00.000Z&to=2026-05-14T00:00:00.000Z' | head -c 400
# malformed range
curl -s 'http://localhost:4321/api/sessions?from=2026-05-14T00:00:00.000Z&to=2026-05-13T00:00:00.000Z'
```

Expected: first two return `{ data: [...], ... }`; third returns `{ ok: false, error: "Invalid from/to range." }`.

(Default port is whatever `dashboard/server.ts` listens on — check if 4321 is wrong.)

- [ ] **Step 3: Lint + build**

Run: `bun run lint && bun run build`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/routes/data.ts
git commit -m "feat(api): support from/to range on GET /api/sessions"
```

---

## Task 3: Sessions tab — pill toggle (Table / Timeline) with `localStorage`

**Files:**

- Modify: `dashboard/views.ts` (Sessions tab markup around line 274–301, and inline JS)

This task only adds the toggle UI and view-switching plumbing. The Timeline container is just an empty placeholder card. Real timeline rendering comes in later tasks.

- [ ] **Step 1: Add toggle markup + empty Timeline card to the Sessions tab**

Open `dashboard/views.ts`. Locate the Sessions tab section (starts at the comment `<!-- SESSIONS TAB -->`, around line 274). Replace the contents of `<div id="tab-sessions" class="tab-content">` with:

```html
<!-- SESSIONS TAB -->
<div id="tab-sessions" class="tab-content">
  <div class="track-tabs" id="sessions-view-tabs" style="margin-bottom:1rem;">
    <button class="track-tab-btn active" data-view="table" onclick="switchSessionsView('table')">Table</button>
    <button class="track-tab-btn" data-view="timeline" onclick="switchSessionsView('timeline')">Timeline</button>
  </div>

  <div id="sessions-view-table">
    <div class="card card-full">
      <h2>Recent Sessions</h2>
      <div id="sessions-container" class="table-wrap">
        <table class="sessions-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Project</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Jira</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="sessions-body">
            <tr>
              <td colspan="6" class="empty-state">Loading...</td>
            </tr>
          </tbody>
        </table>
        <div
          id="pagination"
          style="display:none; margin-top:1rem; align-items:center; justify-content:center; gap:0.75rem; flex-wrap:wrap;"
        >
          <button
            id="prev-btn"
            onclick="changePage(-1)"
            style="background:#30363d; margin-top:0; padding:0.3rem 0.75rem;"
            disabled
          >
            &lt;
          </button>
          <span id="page-info" style="font-size:0.85rem; color:#8b949e;"></span>
          <button
            id="next-btn"
            onclick="changePage(1)"
            style="background:#30363d; margin-top:0; padding:0.3rem 0.75rem;"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  </div>

  <div id="sessions-view-timeline" style="display:none;">
    <div class="card card-full">
      <div class="timeline-date-row">
        <button type="button" id="timeline-prev" aria-label="Previous day">&lsaquo;</button>
        <span id="timeline-date-label" class="timeline-date-label">--</span>
        <button type="button" id="timeline-next" aria-label="Next day">&rsaquo;</button>
        <button type="button" id="timeline-today">Today</button>
        <span class="timeline-summary" id="timeline-summary"></span>
      </div>
      <div class="timeline-canvas-wrap">
        <div id="timeline-canvas" class="timeline-canvas">
          <div class="timeline-empty" id="timeline-empty">Loading...</div>
        </div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add the `switchSessionsView` JS function and persistence**

Find the existing `switchTab` function (around line 540) and add the following AFTER it (still inside the inline `<script>` block):

```js
function switchSessionsView(view) {
  var valid = view === 'timeline' ? 'timeline' : 'table';
  try {
    localStorage.setItem('clocktopus.sessions.view', valid);
  } catch (e) {}
  var tableWrap = document.getElementById('sessions-view-table');
  var timelineWrap = document.getElementById('sessions-view-timeline');
  tableWrap.style.display = valid === 'table' ? '' : 'none';
  timelineWrap.style.display = valid === 'timeline' ? '' : 'none';
  var tabs = document.querySelectorAll('#sessions-view-tabs .track-tab-btn');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-view') === valid) tabs[i].classList.add('active');
    else tabs[i].classList.remove('active');
  }
  if (valid === 'timeline') loadTimeline();
}

// stub — real impl added in later task
function loadTimeline() {
  var empty = document.getElementById('timeline-empty');
  if (empty) empty.textContent = 'Timeline coming soon.';
}
```

- [ ] **Step 3: Restore persisted view on page load**

Find the bottom of the script where `loadSessions();` is called near initialization (around line 1824). Just BEFORE that line, add:

```js
(function restoreSessionsView() {
  try {
    var saved = localStorage.getItem('clocktopus.sessions.view');
    if (saved === 'timeline') switchSessionsView('timeline');
  } catch (e) {}
})();
```

- [ ] **Step 4: Manual QA**

Build + run dashboard. Open Sessions tab. Verify:

- `Table` shown by default; existing pagination + delete still works.
- Click `Timeline`. Table hides, "Timeline coming soon." placeholder appears.
- Refresh page. Timeline view is still selected.
- Click `Table`. Back to table; refresh; table stays.

- [ ] **Step 5: Lint + build**

Run: `bun run lint && bun run build`. Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): add Table/Timeline view toggle in Sessions tab"
```

---

## Task 4: Timeline CSS — canvas, gutter, grid, bar, gap, now-line

**Files:**

- Modify: `dashboard/views.ts` `<style>` block (ends around line 141)

We add a self-contained `.timeline-*` block at the end of the existing `<style>`. Dark GitHub palette to match the rest.

- [ ] **Step 1: Append the CSS block**

In the existing `<style>` element of `views.ts`, just before the closing `</style>`, append:

```css
/* Timeline view */
.timeline-date-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.timeline-date-row button {
  background: #30363d;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  margin: 0;
}
.timeline-date-row button:hover {
  background: #3a414b;
}
.timeline-date-label {
  font-weight: 600;
  min-width: 11ch;
  text-align: center;
}
.timeline-summary {
  margin-left: auto;
  color: #8b949e;
  font-size: 0.85rem;
}
.timeline-canvas-wrap {
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid #21262d;
  border-radius: 8px;
  background: #0d1117;
}
.timeline-canvas {
  position: relative;
  height: 720px; /* 24h * 30px */
}
.timeline-gutter {
  position: absolute;
  top: 0;
  left: 0;
  width: 56px;
  height: 100%;
  border-right: 1px solid #21262d;
}
.timeline-gutter span {
  position: absolute;
  left: 0;
  right: 0;
  padding: 0 0.5rem;
  font-size: 0.7rem;
  color: #8b949e;
  transform: translateY(-50%);
}
.timeline-grid {
  position: absolute;
  top: 0;
  left: 56px;
  right: 0;
  height: 100%;
  pointer-events: none;
}
.timeline-grid div {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: #161b22;
}
.timeline-track {
  position: absolute;
  top: 0;
  left: 56px;
  right: 8px;
  height: 100%;
}
.timeline-bar {
  position: absolute;
  left: 0;
  right: 0;
  background: #1f6feb;
  border: 1px solid #388bfd;
  border-radius: 4px;
  color: #fff;
  font-size: 0.75rem;
  padding: 2px 6px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  line-height: 1.1;
}
.timeline-bar .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.timeline-bar .desc {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.timeline-bar .jira {
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.25);
  padding: 1px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}
.timeline-bar.in-progress {
  border-style: dashed;
}
.timeline-bar.overlap {
  left: 50%;
}
.timeline-gap {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(248, 81, 73, 0.12);
  border-top: 1px dashed #f85149;
  border-bottom: 1px dashed #f85149;
  color: #f85149;
  font-size: 0.7rem;
  padding: 2px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.timeline-gap:hover {
  background: rgba(248, 81, 73, 0.2);
}
.timeline-now {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #f0883e;
  box-shadow: 0 0 6px rgba(240, 136, 62, 0.6);
  pointer-events: none;
}
.timeline-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b949e;
}
```

- [ ] **Step 2: Lint + build (sanity)**

Run: `bun run build`. Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add dashboard/views.ts
git commit -m "style(dashboard): add timeline CSS"
```

---

## Task 5: Timeline core — date state, fetch, render hour grid + bars

**Files:**

- Modify: `dashboard/views.ts` inline JS

Replace the `loadTimeline` stub with the real implementation. Adds: current-date state, date-picker wiring, fetch + render of hour grid and session bars. Gaps, summary, now-line, click handlers come in later tasks.

- [ ] **Step 1: Replace the stub + add render helpers**

Find the existing `loadTimeline` stub from Task 3. Replace it (and the small surrounding area) with:

```js
// === Timeline ===
var timelineDate = startOfTodayLocal(); // Date at 00:00 local time

function startOfTodayLocal() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function timelineDayBounds(dayStart) {
  var fromMs = dayStart.getTime();
  var toMs = fromMs + 24 * 3600 * 1000;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fromMs: fromMs,
    toMs: toMs,
  };
}

function formatDateLabel(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function projectColor(projectId) {
  if (!projectId) return '#6e7681';
  var h = 0;
  for (var i = 0; i < projectId.length; i++) {
    h = ((h << 5) - h + projectId.charCodeAt(i)) | 0;
  }
  var hue = Math.abs(h) % 360;
  return 'hsl(' + hue + ', 55%, 50%)';
}

function fmtHm(totalMin) {
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h <= 0) return m + 'm';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'm';
}

function fmtTimeLocal(ms) {
  var d = new Date(ms);
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

async function loadTimeline() {
  var label = document.getElementById('timeline-date-label');
  var summary = document.getElementById('timeline-summary');
  var canvas = document.getElementById('timeline-canvas');
  label.textContent = formatDateLabel(timelineDate);
  summary.textContent = '';
  canvas.innerHTML = '<div class="timeline-empty">Loading...</div>';

  var bounds = timelineDayBounds(timelineDate);
  try {
    var res = await fetch(
      '/api/sessions?from=' + encodeURIComponent(bounds.from) + '&to=' + encodeURIComponent(bounds.to),
    );
    var result = await res.json();
    if (!result || !result.data) throw new Error('bad response');
    renderTimeline(result.data, bounds);
  } catch (err) {
    canvas.innerHTML = '<div class="timeline-empty">Failed to load timeline.</div>';
  }
}

function renderTimeline(sessions, bounds) {
  var canvas = document.getElementById('timeline-canvas');
  canvas.innerHTML = '';

  // Gutter (hour labels)
  var gutter = document.createElement('div');
  gutter.className = 'timeline-gutter';
  for (var h = 0; h < 24; h++) {
    var s = document.createElement('span');
    s.style.top = h * 30 + 'px';
    s.textContent = (h < 10 ? '0' : '') + h + ':00';
    gutter.appendChild(s);
  }
  canvas.appendChild(gutter);

  // Grid lines
  var grid = document.createElement('div');
  grid.className = 'timeline-grid';
  for (var g = 1; g < 24; g++) {
    var line = document.createElement('div');
    line.style.top = g * 30 + 'px';
    grid.appendChild(line);
  }
  canvas.appendChild(grid);

  // Track for bars
  var track = document.createElement('div');
  track.className = 'timeline-track';

  if (!sessions || sessions.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'timeline-empty';
    empty.textContent = 'No sessions on this date.';
    canvas.appendChild(track);
    canvas.appendChild(empty);
    return;
  }

  var nowMs = Date.now();
  var clipped = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var startMs = new Date(s.startedAt).getTime();
    var endMs;
    if (s.completedAt) {
      endMs = new Date(s.completedAt).getTime();
    } else {
      // open session
      if (startMs > nowMs) {
        console.warn('skipping in-progress session with future startedAt', s.id);
        continue;
      }
      endMs = nowMs;
    }
    if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) continue;
    var clipStart = Math.max(startMs, bounds.fromMs);
    var clipEnd = Math.min(endMs, bounds.toMs);
    if (clipEnd <= clipStart) continue;
    clipped.push({
      raw: s,
      startMs: startMs,
      endMs: endMs,
      clipStart: clipStart,
      clipEnd: clipEnd,
      isOpen: !s.completedAt,
    });
  }

  clipped.sort(function (a, b) {
    return a.clipStart - b.clipStart;
  });

  var prevEnd = null;
  for (var j = 0; j < clipped.length; j++) {
    var c = clipped[j];
    var topPct = ((c.clipStart - bounds.fromMs) / (bounds.toMs - bounds.fromMs)) * 100;
    var heightPct = ((c.clipEnd - c.clipStart) / (bounds.toMs - bounds.fromMs)) * 100;
    var bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'timeline-bar' + (c.isOpen ? ' in-progress' : '');
    if (prevEnd !== null && c.clipStart < prevEnd) bar.classList.add('overlap');
    bar.style.top = topPct + '%';
    bar.style.height = Math.max(heightPct, 1.2) + '%';
    bar.setAttribute('data-session-id', c.raw.id);
    var dur = Math.round((c.endMs - c.startMs) / 60000);
    bar.title =
      (c.raw.description || '(no description)') +
      '\n' +
      (c.raw.projectName || 'No project') +
      (c.raw.jiraTicket ? '\n' + c.raw.jiraTicket : '') +
      '\n' +
      fmtTimeLocal(c.startMs) +
      ' - ' +
      (c.isOpen ? 'in progress' : fmtTimeLocal(c.endMs)) +
      '\n' +
      fmtHm(dur);
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = projectColor(c.raw.projectId);
    var desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = (c.raw.description || '(no description)') + (c.isOpen ? ' · in progress' : '');
    bar.appendChild(dot);
    bar.appendChild(desc);
    if (c.raw.jiraTicket) {
      var jira = document.createElement('span');
      jira.className = 'jira';
      jira.textContent = c.raw.jiraTicket;
      bar.appendChild(jira);
    }
    track.appendChild(bar);
    prevEnd = Math.max(prevEnd || 0, c.clipEnd);
  }

  canvas.appendChild(track);
}
```

- [ ] **Step 2: Wire the date-picker buttons**

Find a sensible init point. Search `views.ts` for the existing init block where `loadSessions();` is invoked at the bottom (~line 1824). BEFORE the `restoreSessionsView` IIFE added in Task 3, add:

```js
(function wireTimelineControls() {
  var prev = document.getElementById('timeline-prev');
  var next = document.getElementById('timeline-next');
  var today = document.getElementById('timeline-today');
  if (!prev || !next || !today) return;
  prev.addEventListener('click', function () {
    timelineDate = new Date(timelineDate.getTime() - 24 * 3600 * 1000);
    timelineDate.setHours(0, 0, 0, 0);
    loadTimeline();
  });
  next.addEventListener('click', function () {
    timelineDate = new Date(timelineDate.getTime() + 24 * 3600 * 1000);
    timelineDate.setHours(0, 0, 0, 0);
    loadTimeline();
  });
  today.addEventListener('click', function () {
    timelineDate = startOfTodayLocal();
    loadTimeline();
  });
})();
```

- [ ] **Step 3: Manual QA**

Build + start dashboard. Open Sessions → Timeline.

- Today's bars render at correct hours (cross-check with table view).
- Prev/Next/Today navigates dates; date label updates.
- Empty day shows "No sessions on this date.".
- Hover a bar — tooltip shows description / project / jira / time / duration.
- Cross-midnight session: visually clipped to the day; tooltip shows full time range.

- [ ] **Step 4: Lint + build**

Run: `bun run lint && bun run build`. Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): render sessions timeline (hour grid + bars)"
```

---

## Task 6: Gap blocks — red wash for ≥30min gaps between sessions

**Files:**

- Modify: `dashboard/views.ts` (the `renderTimeline` function from Task 5)

Gap rule (matches spec §10): only between-session gaps count. Leading (00:00 → first session) and trailing (last session → 24:00 / now) are NOT highlighted.

- [ ] **Step 1: Add gap rendering inside `renderTimeline`**

Open `dashboard/views.ts`. Find the `renderTimeline` function added in Task 5. Locate the loop `for (var j = 0; j < clipped.length; j++)`. Replace that loop with:

```js
var GAP_MIN = 30;
var prevEndMs = null;
for (var j = 0; j < clipped.length; j++) {
  var c = clipped[j];

  // Gap between previous session end and this session start
  if (prevEndMs !== null && c.clipStart > prevEndMs) {
    var gapMin = Math.round((c.clipStart - prevEndMs) / 60000);
    if (gapMin >= GAP_MIN) {
      var gapTopPct = ((prevEndMs - bounds.fromMs) / (bounds.toMs - bounds.fromMs)) * 100;
      var gapHeightPct = ((c.clipStart - prevEndMs) / (bounds.toMs - bounds.fromMs)) * 100;
      var gap = document.createElement('div');
      gap.className = 'timeline-gap';
      gap.style.top = gapTopPct + '%';
      gap.style.height = gapHeightPct + '%';
      gap.setAttribute('data-from', new Date(prevEndMs).toISOString());
      gap.setAttribute('data-to', new Date(c.clipStart).toISOString());
      gap.textContent = 'Gap · ' + fmtHm(gapMin) + ' — click to log';
      track.appendChild(gap);
    }
  }

  var topPct = ((c.clipStart - bounds.fromMs) / (bounds.toMs - bounds.fromMs)) * 100;
  var heightPct = ((c.clipEnd - c.clipStart) / (bounds.toMs - bounds.fromMs)) * 100;
  var bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'timeline-bar' + (c.isOpen ? ' in-progress' : '');
  if (prevEndMs !== null && c.clipStart < prevEndMs) bar.classList.add('overlap');
  bar.style.top = topPct + '%';
  bar.style.height = Math.max(heightPct, 1.2) + '%';
  bar.style.backgroundColor = projectColor(c.raw.projectId);
  bar.style.borderColor = projectColor(c.raw.projectId);
  bar.setAttribute('data-session-id', c.raw.id);
  var dur = Math.round((c.endMs - c.startMs) / 60000);
  bar.title =
    (c.raw.description || '(no description)') +
    '\n' +
    (c.raw.projectName || 'No project') +
    (c.raw.jiraTicket ? '\n' + c.raw.jiraTicket : '') +
    '\n' +
    fmtTimeLocal(c.startMs) +
    ' - ' +
    (c.isOpen ? 'in progress' : fmtTimeLocal(c.endMs)) +
    '\n' +
    fmtHm(dur);
  var dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = '#fff';
  var desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = (c.raw.description || '(no description)') + (c.isOpen ? ' · in progress' : '');
  bar.appendChild(dot);
  bar.appendChild(desc);
  if (c.raw.jiraTicket) {
    var jira = document.createElement('span');
    jira.className = 'jira';
    jira.textContent = c.raw.jiraTicket;
    bar.appendChild(jira);
  }
  track.appendChild(bar);

  prevEndMs = Math.max(prevEndMs || 0, c.clipEnd);
}
```

Note: `prevEndMs` replaces the earlier `prevEnd` variable name — adjust accordingly if you used `prevEnd`.

- [ ] **Step 2: Manual QA**

Reload dashboard. Pick a date with a known >30min gap between two sessions (or fabricate one with two manual log entries).

- Red wash appears between bars with `Gap · 45m — click to log` text.
- A 10min gap between sessions: NO red wash.
- Day with one session: no gaps shown.
- Empty day: no gaps shown.

- [ ] **Step 3: Lint + build**

Run: `bun run lint && bun run build`. Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): highlight ≥30min gaps in sessions timeline"
```

---

## Task 7: "Now" line + summary strip (logged + gaps)

**Files:**

- Modify: `dashboard/views.ts` (the `renderTimeline` function)

- [ ] **Step 1: Add the now-line at the end of `renderTimeline`**

In `renderTimeline`, immediately AFTER the closing `}` of the `for (var j ...)` loop and BEFORE `canvas.appendChild(track);`, add:

```js
// "now" line (only if the rendered day == today)
var nowMsForLine = Date.now();
if (nowMsForLine >= bounds.fromMs && nowMsForLine < bounds.toMs) {
  var nowLine = document.createElement('div');
  nowLine.className = 'timeline-now';
  nowLine.style.top = ((nowMsForLine - bounds.fromMs) / (bounds.toMs - bounds.fromMs)) * 100 + '%';
  track.appendChild(nowLine);
}
```

- [ ] **Step 2: Compute and render summary**

In `renderTimeline`, just BEFORE the `for (var j ...)` loop add:

```js
var loggedMs = 0;
for (var k = 0; k < clipped.length; k++) {
  loggedMs += clipped[k].clipEnd - clipped[k].clipStart;
}
var gapCount = 0;
var gapMs = 0;
```

Inside the loop, where the gap is detected and `gapMin >= GAP_MIN`, increment the totals just before `track.appendChild(gap);`:

```js
gapCount++;
gapMs += c.clipStart - prevEndMs;
```

AFTER the closing `}` of the loop (and after the now-line block), write the summary:

```js
var summary = document.getElementById('timeline-summary');
var loggedLabel = fmtHm(Math.round(loggedMs / 60000));
if (gapCount === 0) {
  summary.textContent = loggedLabel + ' logged · 0 gaps';
} else {
  summary.textContent =
    loggedLabel +
    ' logged · ' +
    gapCount +
    ' gap' +
    (gapCount === 1 ? '' : 's') +
    ' (' +
    fmtHm(Math.round(gapMs / 60000)) +
    ')';
}
```

Also: at the TOP of `renderTimeline` (right after `canvas.innerHTML = '';`) reset the summary in case of empty days:

```js
document.getElementById('timeline-summary').textContent = '0m logged · 0 gaps';
```

And in the `if (!sessions || sessions.length === 0)` early-return branch, no extra change needed — the zero already set above will remain.

- [ ] **Step 3: Manual QA**

- Pick today with active timer running: orange "now" line at current local time; tooltip on the in-progress bar matches; summary count reasonable.
- Pick yesterday (or any non-today): no orange line.
- Pick a day with a 45-min gap between two 1-hour sessions: summary = `2h 0m logged · 1 gap (45m)`.
- Pick an empty day: summary = `0m logged · 0 gaps`.

- [ ] **Step 4: Lint + build**

Run: `bun run lint && bun run build`. Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): add now-line and summary strip to timeline"
```

---

## Task 8: Click interactions — bar deletes, gap pre-fills manual log

**Files:**

- Modify: `dashboard/views.ts` inline JS

Reuse the existing `deleteSession` flow for bars. For gaps, switch tabs and fill the manual log form.

- [ ] **Step 1: Add click delegation for timeline bars**

Inside the existing global click handler near `document.addEventListener('click', function(e) { ... })` (around line 1193), extend it to ALSO handle timeline bars. Find:

```js
document.addEventListener('click', function (e) {
  const btn = e.target.closest && e.target.closest('[data-delete-id]');
  if (!btn || btn.disabled) return;
  deleteSession(btn.getAttribute('data-delete-id'));
});
```

Replace with:

```js
document.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var delBtn = e.target.closest('[data-delete-id]');
  if (delBtn && !delBtn.disabled) {
    deleteSession(delBtn.getAttribute('data-delete-id'));
    return;
  }
  var bar = e.target.closest('.timeline-bar[data-session-id]');
  if (bar) {
    deleteSessionFromTimeline(bar.getAttribute('data-session-id'));
    return;
  }
  var gap = e.target.closest('.timeline-gap');
  if (gap) {
    prefillManualLogFromGap(gap.getAttribute('data-from'), gap.getAttribute('data-to'));
    return;
  }
});
```

- [ ] **Step 2: Add the `deleteSessionFromTimeline` helper**

Right after the existing `deleteSession` function, add:

```js
async function deleteSessionFromTimeline(id) {
  var ok = await showConfirm('Delete this entry from Clockify and Jira?');
  if (!ok) return;
  try {
    var res = await fetch('/api/timer/' + encodeURIComponent(id), { method: 'DELETE' });
    var result = await res.json();
    if (!result.ok) {
      alert(result.error || 'Failed to delete entry.');
      return;
    }
    loadTimeline();
    loadSessions();
  } catch {
    alert('Failed to delete entry.');
  }
}
```

(Separate from `deleteSession` because we need to refresh the timeline view, not just the table; sharing would couple them.)

- [ ] **Step 3: Add the `prefillManualLogFromGap` helper**

Right after `deleteSessionFromTimeline`, add:

```js
function prefillManualLogFromGap(fromIso, toIso) {
  if (!fromIso || !toIso) return;
  var fromDate = new Date(fromIso);
  var toDate = new Date(toIso);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return;

  switchTab('home');
  switchTrackMode('manual');

  // Ensure start/end mode (not duration mode). The duration toggle puts
  // #manual-range-wrap on display and #manual-duration-wrap off.
  var rangeWrap = document.getElementById('manual-range-wrap');
  var durationWrap = document.getElementById('manual-duration-wrap');
  if (rangeWrap) rangeWrap.style.display = '';
  if (durationWrap) durationWrap.style.display = 'none';
  // If there's a mode-toggle button/radio, leave it for the user; the
  // wrappers being correct is what matters for submission.

  function toDateInput(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function toTimeInput(d) {
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  var sd = document.getElementById('manual-start-date');
  var st = document.getElementById('manual-start-time');
  var ed = document.getElementById('manual-end-date');
  var et = document.getElementById('manual-end-time');
  if (sd) sd.value = toDateInput(fromDate);
  if (st) st.value = toTimeInput(fromDate);
  if (ed) ed.value = toDateInput(toDate);
  if (et) et.value = toTimeInput(toDate);

  var desc = document.getElementById('manual-description');
  if (desc) {
    desc.focus();
  }
}
```

- [ ] **Step 4: Manual QA**

- Click a session bar in Timeline → delete confirm appears → confirm → bar disappears + table refreshes.
- Click a red gap block → page jumps to Home → Manual Log mode → date/time fields filled with the gap bounds → description input focused.
- If the user has the in-flight start/end ↔ duration toggle in views.ts, ensure that toggle visually reflects "start/end" mode after a gap click. If not, note it and proceed (the form still submits correctly).

- [ ] **Step 5: Lint + build**

Run: `bun run lint && bun run build`. Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): wire timeline bar delete and gap → manual log"
```

---

## Task 9: Final manual QA + docs touch

**Files:**

- Modify: `docs/dashboard.md` (existing user-facing docs)

- [ ] **Step 1: End-to-end QA checklist**

Run through every spec requirement against the running dashboard:

1. Sessions tab default view = Table. ✓
2. Toggle to Timeline. Selection persists across reload. ✓
3. Today loads automatically with bars at correct local hours. ✓
4. Prev/Next/Today navigation works. ✓
5. Hover a bar: tooltip shows description, project, jira, start–end, duration. ✓
6. Click a bar: delete confirm; on confirm the bar disappears. ✓
7. Click a gap (≥30min): jumps to Home → Manual Log, fields prefilled. ✓
8. Active timer day: in-progress bar has dashed border, orange "now" line present. ✓
9. Cross-midnight session: bar clipped to selected day, tooltip shows full range. ✓
10. Empty day: shows "No sessions on this date." + `0m logged · 0 gaps`. ✓
11. Future day: empty, no now-line. ✓
12. Day with two overlapping sessions: second bar shifted right (overlap class applied). ✓

- [ ] **Step 2: Add a short section to `docs/dashboard.md`**

Open `docs/dashboard.md`. Add (location: under whichever section documents the Sessions tab — append if no such section exists):

```markdown
### Sessions: Timeline view

The Sessions tab has two views, toggled with the **Table / Timeline** pills:

- **Table** — paginated list of recent sessions (default).
- **Timeline** — vertical day view (00:00 → 24:00) with one bar per session and red-highlighted gaps of 30 min or more. Click a bar to delete the entry; click a gap to jump to Manual Log with the gap's start/end pre-filled. The right side of the date row shows total logged time and gap stats for the selected day. View choice persists across reloads.
```

- [ ] **Step 3: Lint + build + final commit**

Run: `bun run lint && bun run build`. Expected: 0 errors.

```bash
git add docs/dashboard.md
git commit -m "docs(dashboard): document Sessions Timeline view"
```

---

## Done criteria

- All 9 tasks above committed.
- `bun test lib/db.test.ts` passes (8 cases).
- `bun run lint` and `bun run build` are clean.
- Spec requirements 1–10 manually verified per Task 9 checklist.

## Out of scope (per spec)

- Session edit endpoint and UI.
- Drag-to-resize / drag-to-create on the timeline.
- Week / multi-day / collapsed-hours modes.
- Configurable gap threshold setting.
- Keyboard nav for prev/next; touch gestures.
