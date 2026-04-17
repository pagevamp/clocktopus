# Manual Log Time Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Log Time" card on the Home tab next to the Idle Monitor that logs a completed time range to Clockify, persists a completed session row, and posts a Jira worklog when a ticket is provided.

**Architecture:** New DB helper inserts a pre-completed session so manual entries don't interfere with any open auto-tracker session. New Hono route wires Clockify `logTime` + DB insert + optional Jira worklog. New UI card mirrors the Start Timer card with datetime-local inputs.

**Tech Stack:** TypeScript (ESM), Hono, `bun:sqlite`, vanilla HTML/JS embedded in `dashboard/views.ts`, existing `clockify.ts` and `lib/jira.ts`.

Repo has no automated test suite (package.json has no `test` script). Verification is `bun run build`, `bun run lint`, and manual dashboard testing via browser + `curl`.

---

## File Structure

- `lib/db.ts` — add `logCompletedSession(id, projectId, description, startedAt, completedAt, jiraTicket?)` that inserts a sessions row with `completedAt` set and `isAutoCompleted = 0`.
- `dashboard/routes/timer.ts` — add `POST /timer/log` that calls `clockify.logTime`, `logCompletedSession`, and optional `stopJiraTimer`.
- `dashboard/views.ts` — add the "Log Time" card markup in the Home tab `.cards` grid (placed after the Idle Monitor card), plus the `logManualTime()` handler and a datetime-local defaults initializer.

---

## Task 1: Add `logCompletedSession` DB helper

**Files:**

- Modify: `lib/db.ts`

- [ ] **Step 1: Add the helper function**

Open `lib/db.ts`. Locate the `completeLatestSession` export (near the other session helpers). Add the following function directly below `logSessionStart`:

```ts
export function logCompletedSession(
  id: string,
  projectId: string,
  description: string,
  startedAt: string,
  completedAt: string,
  jiraTicket?: string,
) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO sessions (id, projectId, description, startedAt, completedAt, isAutoCompleted, jiraTicket) VALUES (?, ?, ?, ?, ?, 0, ?)',
  );
  stmt.run(id, projectId, description, startedAt, completedAt, jiraTicket ?? null);
}
```

- [ ] **Step 2: Verify TypeScript build**

Run: `bun run build`
Expected: exit 0, no `dist/` diagnostics errors relating to `lib/db.ts`.

- [ ] **Step 3: Verify lint**

Run: `bun run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts
git commit -m "feat(db): add logCompletedSession helper for manual entries"
```

---

## Task 2: Add `POST /timer/log` route

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Import `logCompletedSession`**

In `dashboard/routes/timer.ts`, update the `lib/db.js` import to include the new helper:

```ts
import { completeLatestSession, getOpenSession, logCompletedSession, logSessionStart } from '../../lib/db.js';
```

- [ ] **Step 2: Add the route below the existing `/timer/stop` handler**

Append this route above `export default timerRoutes;`:

```ts
timerRoutes.post('/timer/log', async (c) => {
  const { projectId, description, start, end, jiraTicket } = await c.req.json<{
    projectId: string;
    description: string;
    start: string;
    end: string;
    jiraTicket?: string;
  }>();

  if (!projectId) {
    return c.json({ ok: false, error: 'Project is required.' }, 400);
  }
  if (!start || !end) {
    return c.json({ ok: false, error: 'Start and end are required.' }, 400);
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return c.json({ ok: false, error: 'Invalid start or end date.' }, 400);
  }
  if (endMs <= startMs) {
    return c.json({ ok: false, error: 'End must be after start.' }, 400);
  }

  const cleanDescription = (description ?? '').trim();
  const cleanJira = jiraTicket?.trim() || undefined;
  if (!cleanDescription && !cleanJira) {
    return c.json({ ok: false, error: 'Description or Jira ticket is required.' }, 400);
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    const finalDescription = cleanDescription || cleanJira!;

    const entry = await clockify.logTime(user.defaultWorkspace, projectId, startIso, endIso, finalDescription);
    if (!entry) return c.json({ ok: false, error: 'Failed to log time in Clockify.' }, 500);

    const entryId = (entry as { id?: string }).id ?? uuidv4();
    logCompletedSession(entryId, projectId, finalDescription, startIso, endIso, cleanJira);

    if (cleanJira) {
      const timeSpentSeconds = Math.round((endMs - startMs) / 1000);
      if (timeSpentSeconds >= 60) {
        try {
          await stopJiraTimer(cleanJira, timeSpentSeconds);
        } catch (err) {
          console.error('Error posting Jira worklog for manual entry:', err);
        }
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error('Error logging manual time:', err);
    return c.json({ ok: false, error: 'Failed to log time.' }, 500);
  }
});
```

- [ ] **Step 3: Verify build and lint**

Run: `bun run build && bun run lint`
Expected: exit 0 from both.

- [ ] **Step 4: Smoke-test the route**

Start the dashboard in another terminal: `bun run dashboard`
Then run:

```bash
curl -s -X POST http://localhost:4001/api/timer/log \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"","description":"","start":"","end":""}'
```

Expected: `{"ok":false,"error":"Project is required."}` with HTTP 400. Validates the guard before we hit Clockify.

Stop the dashboard (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): add POST /timer/log for manual entries"
```

---

## Task 3: Add the "Log Time" card UI

**Files:**

- Modify: `dashboard/views.ts`

- [ ] **Step 1: Insert the card markup in the Home tab grid**

In `dashboard/views.ts`, locate the Idle Monitor card in the Home tab (the `<div class="card">` whose header contains `Idle Monitor`, ends at its closing `</div>` before the Session History card). Insert the following card directly after the Idle Monitor card's closing `</div>` and before the `<!-- Session History -->` comment:

```html
<!-- Manual Log -->
<div class="card">
  <h2>Log Time</h2>
  <label for="manual-project">Project</label>
  <select id="manual-project">
    <option value="">Loading projects...</option>
  </select>
  <div class="form-row">
    <div>
      <label for="manual-start">Start</label>
      <input type="datetime-local" id="manual-start" />
    </div>
    <div>
      <label for="manual-end">End</label>
      <input type="datetime-local" id="manual-end" />
    </div>
  </div>
  <div class="form-row">
    <div>
      <label for="manual-description">Description</label>
      <input type="text" id="manual-description" placeholder="What did you work on?" />
    </div>
    <div>
      <label for="manual-jira">Jira Ticket (optional)</label>
      <input type="text" id="manual-jira" placeholder="e.g. PROJ-123" />
    </div>
  </div>
  <button id="manual-log-btn" onclick="logManualTime()">Log Time</button>
  <div class="msg" id="manual-msg"></div>
</div>
```

- [ ] **Step 2: Populate the project dropdown alongside the existing one**

In the `loadProjects()` function (inside the `<script>` block), replace the body so it fills both `#project-select` and `#manual-project`:

```js
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const selects = [document.getElementById('project-select'), document.getElementById('manual-project')];
    selects.forEach(function (select) {
      if (!select) return;
      select.innerHTML = '<option value="">Select a project</option>';
      if (projects.length === 0) {
        select.innerHTML = '<option value="">No active projects \u2014 pull from Clockify in Settings</option>';
        return;
      }
      projects.forEach(function (p) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    });
  } catch {
    const select = document.getElementById('project-select');
    if (select) select.innerHTML = '<option value="">Failed to load projects</option>';
    const manual = document.getElementById('manual-project');
    if (manual) manual.innerHTML = '<option value="">Failed to load projects</option>';
  }
}
```

- [ ] **Step 3: Add datetime-local defaults helper and the `logManualTime` handler**

Add the following helpers in the `<script>` block, grouped near the other timer functions (e.g. right after `stopTimer`):

```js
function toLocalInputValue(date) {
  const pad = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

function setManualDefaults() {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const startEl = document.getElementById('manual-start');
  const endEl = document.getElementById('manual-end');
  if (startEl) startEl.value = toLocalInputValue(hourAgo);
  if (endEl) endEl.value = toLocalInputValue(now);
}

async function logManualTime() {
  const projectId = document.getElementById('manual-project').value;
  const startVal = document.getElementById('manual-start').value;
  const endVal = document.getElementById('manual-end').value;
  const description = document.getElementById('manual-description').value.trim();
  const jiraTicket = document.getElementById('manual-jira').value.trim();

  if (!projectId) return setMsg('manual-msg', 'Please select a project.', false);
  if (!startVal || !endVal) return setMsg('manual-msg', 'Please set start and end.', false);

  const startMs = new Date(startVal).getTime();
  const endMs = new Date(endVal).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return setMsg('manual-msg', 'Invalid date.', false);
  if (endMs <= startMs) return setMsg('manual-msg', 'End must be after start.', false);
  if (!description && !jiraTicket) return setMsg('manual-msg', 'Please enter a description or Jira ticket.', false);

  const btn = document.getElementById('manual-log-btn');
  btn.disabled = true;
  btn.textContent = 'Logging...';

  try {
    const res = await fetch('/api/timer/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: projectId,
        description: description,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        jiraTicket: jiraTicket || undefined,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setMsg('manual-msg', 'Time logged.', true);
      document.getElementById('manual-description').value = '';
      document.getElementById('manual-jira').value = '';
      setManualDefaults();
      loadSessions();
    } else {
      setMsg('manual-msg', data.error || 'Failed to log time.', false);
    }
  } catch {
    setMsg('manual-msg', 'Request failed.', false);
  }
  btn.disabled = false;
  btn.textContent = 'Log Time';
}
```

- [ ] **Step 4: Call `setManualDefaults()` on init**

At the bottom of the `<script>` block, in the init section (right after `loadAllProjects();`), add:

```js
setManualDefaults();
```

- [ ] **Step 5: Verify build and lint**

Run: `bun run build && bun run lint`
Expected: exit 0 from both.

- [ ] **Step 6: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): add manual log time card on home tab"
```

---

## Task 4: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dashboard**

Run: `bun run dashboard`
Open `http://localhost:4001` in a browser.

- [ ] **Step 2: Verify card renders**

Confirm a "Log Time" card appears on the Home tab next to "Idle Monitor" with Project dropdown (populated with active projects), Start and End datetime fields defaulted to `now - 1h` and `now`, Description and Jira Ticket inputs, and a "Log Time" button.

- [ ] **Step 3: Verify client validation**

Click "Log Time" with no project selected — expect inline error "Please select a project." Select a project, clear description and Jira — expect "Please enter a description or Jira ticket." Set end before start — expect "End must be after start."

- [ ] **Step 4: Log a real entry without Jira**

Select a project, enter description `manual log test`, keep default 1-hour window, click "Log Time". Expect "Time logged." message. Confirm the entry appears in Recent Sessions with the correct duration and in the Clockify web app under the same date range.

- [ ] **Step 5: Log a real entry with a Jira ticket**

Use a project and a valid Jira ticket you can write to (e.g. a sandbox ticket). Submit. Confirm the entry appears in Recent Sessions with the Jira column populated, in Clockify, and that a worklog exists on the Jira ticket via the Atlassian UI (or `curl` the Jira worklog endpoint).

- [ ] **Step 6: Confirm active timer is untouched**

Start an auto timer from the existing "Start Timer" card. Then log a manual entry. Confirm the active timer banner still shows the original timer (not prematurely stopped). Stop the auto timer and confirm both entries exist correctly.

- [ ] **Step 7: Commit if any fixes were required**

If verification surfaced issues, fix them, re-run `bun run build && bun run lint`, and commit with a descriptive message. Otherwise no commit needed.

---

## Self-Review Notes

- Spec coverage: Card placement (Task 3), project dropdown (Task 3), start/end defaults (Task 3), description + jira fields (Task 3), validation (Task 3), backend route (Task 2), `logTime` + DB insert + Jira worklog (Task 2), `logCompletedSession` helper (Task 1), manual verification (Task 4).
- No placeholders; all code blocks fully specified.
- Type consistency: `logCompletedSession` signature used in Task 2 matches Task 1. Import list updated to include it. Request/response shapes match between client (Task 3) and server (Task 2).
