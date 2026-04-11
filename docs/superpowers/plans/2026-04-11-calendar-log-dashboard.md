# Calendar Log Dashboard Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Calendar" tab to the web dashboard that lets users fetch Google Calendar events, map them to Clockify projects, and log them as time entries.

**Architecture:** New API route file `dashboard/routes/calendar.ts` for backend endpoints. Calendar tab HTML/JS added to `dashboard/views.ts` following existing tab patterns. Uses existing `lib/google.ts` for auth/token management, `lib/db.ts` for event-project mappings, and `clockify.ts` for time logging.

**Tech Stack:** Hono (API routes), googleapis (Google Calendar API), existing Clockify client, SQLite (event_projects table), vanilla JS frontend.

---

### File Structure

| File                           | Action | Responsibility                               |
| ------------------------------ | ------ | -------------------------------------------- |
| `dashboard/routes/calendar.ts` | Create | API endpoints: fetch events, log to Clockify |
| `dashboard/views.ts`           | Modify | Add Calendar nav tab, HTML, and JS           |
| `dashboard/server.ts`          | Modify | Register calendar routes                     |

---

### Task 1: Create Calendar API Routes

**Files:**

- Create: `dashboard/routes/calendar.ts`
- Modify: `dashboard/server.ts`

- [ ] **Step 1: Create `dashboard/routes/calendar.ts` with the events endpoint**

```typescript
import { Hono } from 'hono';
import { google } from 'googleapis';
import { getAuthenticatedClient, getRefreshedToken } from '../../lib/google.js';
import { getLatestToken, storeToken, getEventProject, getActiveProjects } from '../../lib/db.js';

const calendarRoutes = new Hono();

calendarRoutes.get('/calendar/events', async (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!start || !end) {
    return c.json({ ok: false, error: 'Start and end dates are required.' }, 400);
  }

  let token = getLatestToken();
  if (!token) {
    return c.json({ ok: false, error: 'Google Calendar not connected. Go to Settings to connect.' }, 401);
  }

  const oAuth2Client = getAuthenticatedClient('http://localhost:4001/api/google/callback');
  oAuth2Client.setCredentials(token);

  if (new Date(token.expiry_date) < new Date()) {
    try {
      token = await getRefreshedToken(token);
      storeToken(token);
      oAuth2Client.setCredentials(token);
    } catch {
      return c.json({ ok: false, error: 'Google token expired. Reconnect in Settings.' }, 401);
    }
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const timeMin = new Date(start).toISOString();
    const endOfDay = new Date(end);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const timeMax = endOfDay.toISOString();

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (res.data.items || [])
      .filter((e) => e.start?.dateTime && e.end?.dateTime && e.summary)
      .map((e) => ({
        summary: e.summary!,
        start: e.start!.dateTime!,
        end: e.end!.dateTime!,
        projectId: getEventProject(e.summary!) ?? '',
      }));

    const projects = getActiveProjects();

    return c.json({ ok: true, events, projects });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: 'Failed to fetch calendar events: ' + msg }, 500);
  }
});

export default calendarRoutes;
```

- [ ] **Step 2: Add the log endpoint to `dashboard/routes/calendar.ts`**

Append before `export default calendarRoutes;`:

```typescript
import { setEventProject } from '../../lib/db.js';
import { Clockify } from '../../clockify.js';

calendarRoutes.post('/calendar/log', async (c) => {
  const { entries } = await c.req.json<{
    entries: Array<{ summary: string; start: string; end: string; projectId: string }>;
  }>();

  if (!entries || entries.length === 0) {
    return c.json({ ok: false, error: 'No entries to log.' }, 400);
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    let logged = 0;
    let failed = 0;

    for (const entry of entries) {
      setEventProject(entry.summary, entry.projectId);
      const result = await clockify.logTime(
        user.defaultWorkspace,
        entry.projectId,
        entry.start,
        entry.end,
        entry.summary,
      );
      if (result) {
        logged++;
      } else {
        failed++;
      }
    }

    return c.json({ ok: true, logged, failed });
  } catch {
    return c.json({ ok: false, error: 'Failed to log events.' }, 500);
  }
});
```

Note: Merge the imports at the top of the file — the final file should have a single import block with `setEventProject` added to the `db.js` import, and `Clockify` imported from `clockify.js`.

- [ ] **Step 3: Register calendar routes in `dashboard/server.ts`**

Add import and route registration following the existing pattern:

```typescript
import calendarRoutes from './routes/calendar.js';
```

Add after the last `app.route('/api', ...)` line:

```typescript
app.route('/api', calendarRoutes);
```

- [ ] **Step 4: Build and verify no compile errors**

Run: `bun run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/calendar.ts dashboard/server.ts
git commit -m "feat: add calendar API routes for fetching events and logging to Clockify"
```

---

### Task 2: Add Calendar Tab to Dashboard UI

**Files:**

- Modify: `dashboard/views.ts`

- [ ] **Step 1: Add "Calendar" nav button**

In `dashboard/views.ts`, find the nav buttons section (around line 96-99):

```html
<button class="nav-btn" onclick="switchTab('settings')" id="nav-settings">Settings</button>
```

Add after it:

```html
<button class="nav-btn" onclick="switchTab('calendar')" id="nav-calendar">Calendar</button>
```

- [ ] **Step 2: Add Calendar tab HTML**

In `dashboard/views.ts`, find the closing `</div>` of the projects tab (`<!-- PROJECTS TAB -->` section ends around line 263). Add the calendar tab HTML after it, before the `<script>` tag:

```html
<!-- CALENDAR TAB -->
<div id="tab-calendar" class="tab-content">
  <div class="card card-full">
    <h2>Log Calendar Events</h2>
    <div class="form-row" style="margin-bottom:1rem;">
      <div>
        <label for="cal-start">From</label>
        <input type="date" id="cal-start" />
      </div>
      <div>
        <label for="cal-end">To</label>
        <input type="date" id="cal-end" />
      </div>
    </div>
    <button id="cal-fetch-btn" onclick="fetchCalendarEvents()" style="margin-top:0;">Fetch Events</button>
    <div class="msg" id="cal-msg"></div>

    <div id="cal-table-wrap" class="table-wrap" style="display:none; margin-top:1rem;">
      <table class="sessions-table">
        <thead>
          <tr>
            <th style="width:2rem;">
              <input type="checkbox" id="cal-select-all" checked onchange="toggleCalSelectAll(this.checked)" />
            </th>
            <th>Event</th>
            <th>Start</th>
            <th>End</th>
            <th>Duration</th>
            <th>Project</th>
          </tr>
        </thead>
        <tbody id="cal-events-body"></tbody>
      </table>
      <button id="cal-log-btn" onclick="logCalendarEvents()" style="margin-top:1rem;">Log to Clockify</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add Calendar tab JavaScript**

In `dashboard/views.ts`, find the `// --- Init ---` comment in the `<script>` section. Add the following calendar functions before that comment:

```javascript
// --- Calendar ---
var calendarEvents = [];
var calendarProjects = [];

(function setCalendarDefaults() {
  var today = new Date().toISOString().split('T')[0];
  setTimeout(function () {
    var startEl = document.getElementById('cal-start');
    var endEl = document.getElementById('cal-end');
    if (startEl) startEl.value = today;
    if (endEl) endEl.value = today;
  }, 0);
})();

async function fetchCalendarEvents() {
  var startDate = document.getElementById('cal-start').value;
  var endDate = document.getElementById('cal-end').value;
  if (!startDate || !endDate) return setMsg('cal-msg', 'Please select both dates.', false);

  var btn = document.getElementById('cal-fetch-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  setMsg('cal-msg', '', true);

  try {
    var res = await fetch('/api/calendar/events?start=' + startDate + '&end=' + endDate);
    var data = await res.json();

    if (!data.ok) {
      setMsg('cal-msg', data.error || 'Failed to fetch events.', false);
      document.getElementById('cal-table-wrap').style.display = 'none';
      btn.disabled = false;
      btn.textContent = 'Fetch Events';
      return;
    }

    calendarEvents = data.events;
    calendarProjects = data.projects;

    if (calendarEvents.length === 0) {
      setMsg('cal-msg', 'No timed events found for this date range.', false);
      document.getElementById('cal-table-wrap').style.display = 'none';
      btn.disabled = false;
      btn.textContent = 'Fetch Events';
      return;
    }

    renderCalendarTable();
    document.getElementById('cal-table-wrap').style.display = 'block';
    setMsg('cal-msg', calendarEvents.length + ' event(s) found.', true);
  } catch {
    setMsg('cal-msg', 'Request failed.', false);
  }
  btn.disabled = false;
  btn.textContent = 'Fetch Events';
}

function renderCalendarTable() {
  var tbody = document.getElementById('cal-events-body');
  tbody.innerHTML = calendarEvents
    .map(function (ev, i) {
      var start = new Date(ev.start);
      var end = new Date(ev.end);
      var durationMs = end.getTime() - start.getTime();
      var projectOptions =
        '<option value="">— Select project —</option>' +
        calendarProjects
          .map(function (p) {
            var selected = p.id === ev.projectId ? ' selected' : '';
            return '<option value="' + p.id + '"' + selected + '>' + escapeHtml(p.name) + '</option>';
          })
          .join('');

      return (
        '<tr>' +
        '<td><input type="checkbox" class="cal-row-check" data-index="' +
        i +
        '" checked /></td>' +
        '<td>' +
        escapeHtml(ev.summary) +
        '</td>' +
        '<td>' +
        formatDate(ev.start) +
        '</td>' +
        '<td>' +
        formatDate(ev.end) +
        '</td>' +
        '<td>' +
        formatDuration(durationMs) +
        '</td>' +
        '<td><select class="cal-project-select" data-index="' +
        i +
        '" style="min-width:140px;">' +
        projectOptions +
        '</select></td>' +
        '</tr>'
      );
    })
    .join('');

  // Sync project selections back to data
  tbody.querySelectorAll('.cal-project-select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      calendarEvents[parseInt(sel.dataset.index)].projectId = sel.value;
    });
  });

  document.getElementById('cal-select-all').checked = true;
}

function toggleCalSelectAll(checked) {
  document.querySelectorAll('.cal-row-check').forEach(function (cb) {
    cb.checked = checked;
  });
}

async function logCalendarEvents() {
  var entries = [];
  document.querySelectorAll('.cal-row-check').forEach(function (cb) {
    if (!cb.checked) return;
    var idx = parseInt(cb.dataset.index);
    var ev = calendarEvents[idx];
    if (ev && ev.projectId) {
      entries.push({ summary: ev.summary, start: ev.start, end: ev.end, projectId: ev.projectId });
    }
  });

  if (entries.length === 0) {
    return setMsg('cal-msg', 'Select at least one event with a project assigned.', false);
  }

  // Check all selected rows have projects
  var selectedCount = 0;
  var missingProject = false;
  document.querySelectorAll('.cal-row-check').forEach(function (cb) {
    if (!cb.checked) return;
    selectedCount++;
    var idx = parseInt(cb.dataset.index);
    if (!calendarEvents[idx].projectId) missingProject = true;
  });

  if (missingProject) {
    return setMsg('cal-msg', 'All selected events must have a project assigned.', false);
  }

  var btn = document.getElementById('cal-log-btn');
  btn.disabled = true;
  btn.textContent = 'Logging...';
  setMsg('cal-msg', '', true);

  try {
    var res = await fetch('/api/calendar/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: entries }),
    });
    var data = await res.json();

    if (data.ok) {
      var msg = data.logged + ' event(s) logged to Clockify.';
      if (data.failed > 0) msg += ' ' + data.failed + ' failed.';
      setMsg('cal-msg', msg, data.failed === 0);
    } else {
      setMsg('cal-msg', data.error || 'Failed to log events.', false);
    }
  } catch {
    setMsg('cal-msg', 'Request failed.', false);
  }
  btn.disabled = false;
  btn.textContent = 'Log to Clockify';
}
```

- [ ] **Step 4: Build and verify**

Run: `bun run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat: add Calendar tab to dashboard for logging Google Calendar events"
```

---

### Task 3: Manual Testing

- [ ] **Step 1: Start the dashboard**

Run: `bun run dashboard`

- [ ] **Step 2: Verify Calendar tab appears**

Open http://localhost:4001, verify "Calendar" tab appears in the nav bar.

- [ ] **Step 3: Test event fetching**

Click Calendar tab, verify date defaults to today, click "Fetch Events". Verify:

- Events display in table with checkboxes, names, times, durations
- Project dropdowns are populated with active projects
- Previously mapped events have their project pre-selected
- All-day events are excluded

- [ ] **Step 4: Test logging**

Select events, assign projects, click "Log to Clockify". Verify:

- Success banner shows count
- Events appear in Clockify
- Event-project mappings are saved (re-fetch shows them pre-selected)
- Deselecting an event excludes it from logging
- Cannot log when a selected event has no project

- [ ] **Step 5: Test error states**

- Disconnect Google (clear token) → verify helpful error message
- Try with no events in range → verify "No timed events found" message
