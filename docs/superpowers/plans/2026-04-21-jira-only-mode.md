# Jira-only Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Clocktopus function when the user has configured only Jira (no Clockify API key), while keeping the full Clockify + Jira flow unchanged when both are configured.

**Architecture:** Inline guards at each Clockify-touching call site via a new `isClockifyEnabled()` helper. The `Clockify` class is unchanged; it is simply never instantiated without a key. Session rows get a nullable `projectId`. UI reads `GET /status` and conditionally hides or disables Clockify-dependent surfaces. Calendar sync and Google Connect stay Clockify-gated but remain visibly present with explanatory copy.

**Tech Stack:** TypeScript (ESM), Hono, `bun:sqlite` via `better-sqlite3` wrapper in `lib/db.ts`, zod, Commander (CLI), PM2 (monitor daemon), `bun:test` (built-in) for the handful of pure-logic unit tests this plan introduces.

**Spec:** `docs/superpowers/specs/2026-04-21-jira-only-mode-design.md`

**Testing strategy:** The repo has no existing test suite. One unit test is added for the `isClockifyEnabled` helper using `bun:test` (built in, no new dep). Everything else is verified manually against the four-state matrix from the spec:

- (C+, J+) full mode
- (C+, J-) Clockify-only
- (C-, J+) Jira-only (new)
- (C-, J-) bootstrap / no provider

To flip Clockify off in a dev DB without losing the key: run `bun -e "import('./dist/lib/db.js').then(m=>m.setCredential('CLOCKIFY_API_KEY',''))"` (store an empty string, which `resolveCredential` treats as falsy). Restore with the real key via the Settings UI.

---

## File map

- `lib/credentials.ts` — add `isClockifyEnabled()`.
- `lib/db.ts` — loosen `SessionSchema.projectId` + `logSessionStart` / `logCompletedSession` signatures; add DDL migration for existing `sessions.projectId NOT NULL`.
- `dashboard/routes/timer.ts` — guard every route.
- `dashboard/routes/data.ts` — guard `/projects/fetch`.
- `dashboard/routes/calendar.ts` — guard all endpoints.
- `dashboard/routes/monitor.ts` — no change needed (it just proxies; real monitor lives in `index.ts`).
- `scripts/log-calendar-events.ts` — exit early when Clockify disabled.
- `index.ts` — lazy Clockify instantiation; guard `start`, `stop`, `status`, `monitor:run`.
- `clockify.ts` — **no change**.
- `dashboard/views.ts` — conditional render based on `status.clockify`.
- `lib/credentials.test.ts` — new, tiny unit test.

---

## Task 1: `isClockifyEnabled()` helper

**Files:**

- Modify: `lib/credentials.ts`
- Test: `lib/credentials.test.ts` (new)

- [ ] **Step 1: Write the failing test**

To keep the test from touching the real SQLite dev DB, split the helper in two: a pure predicate `isClockifyKeyValid(value)` (covered by the test) and a thin wrapper `isClockifyEnabled()` that calls `resolveCredential` first (not covered directly — it is exercised via manual verification in later tasks).

Create `lib/credentials.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { isClockifyKeyValid } from './credentials.js';

describe('isClockifyKeyValid', () => {
  it('returns false when value is undefined', () => {
    expect(isClockifyKeyValid(undefined)).toBe(false);
  });

  it('returns false when value is an empty string', () => {
    expect(isClockifyKeyValid('')).toBe(false);
  });

  it('returns true when value is a non-empty string', () => {
    expect(isClockifyKeyValid('abc123')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test lib/credentials.test.ts`

Expected: fails because `isClockifyEnabled` does not exist.

- [ ] **Step 3: Implement the helper**

Edit `lib/credentials.ts`. Current file:

```ts
import { getCredential, setCredential } from './db.js';

export function resolveCredential(key: string): string | undefined {
  const dbValue = getCredential(key);
  if (dbValue) return dbValue;
  return process.env[key];
}

export function saveCredential(key: string, value: string) {
  setCredential(key, value);
}
```

Add at the end:

```ts
export function isClockifyKeyValid(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

export function isClockifyEnabled(): boolean {
  return isClockifyKeyValid(resolveCredential('CLOCKIFY_API_KEY'));
}
```

Note: `resolveCredential` treats empty string from DB as falsy because of the `if (dbValue)` guard, so the DB-backed empty-string trick works. The env-var branch can still be an empty string, which is why `isClockifyKeyValid` re-checks length.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test lib/credentials.test.ts`

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/credentials.ts lib/credentials.test.ts
git commit -m "feat: add isClockifyEnabled credential helper"
```

---

## Task 2: Make `sessions.projectId` nullable

**Files:**

- Modify: `lib/db.ts` (lines around the `SessionSchema` declaration, the `CREATE TABLE sessions` DDL, and `logSessionStart` / `logCompletedSession`).

- [ ] **Step 1: Relax the zod schema**

Find this block in `lib/db.ts`:

```ts
const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  description: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  isAutoCompleted: z.number(),
  jiraTicket: z.string().nullable(),
  jiraWorklogId: z.string().nullable().optional(),
});
```

Change `projectId` to:

```ts
  projectId: z.string().nullable(),
```

- [ ] **Step 2: Loosen `logSessionStart` and `logCompletedSession` signatures**

Find:

```ts
export function logSessionStart(
  id: string,
  projectId: string,
  description: string,
  startedAt: string,
  jiraTicket?: string,
) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO sessions (id, projectId, description, startedAt, isAutoCompleted, jiraTicket) VALUES (?, ?, ?, ?, ?, ?)',
  );

  stmt.run(id, projectId, description, startedAt, 0, jiraTicket ?? null);
}
```

Replace with:

```ts
export function logSessionStart(
  id: string,
  projectId: string | null,
  description: string,
  startedAt: string,
  jiraTicket?: string,
) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO sessions (id, projectId, description, startedAt, isAutoCompleted, jiraTicket) VALUES (?, ?, ?, ?, ?, ?)',
  );

  stmt.run(id, projectId ?? null, description, startedAt, 0, jiraTicket ?? null);
}
```

Find:

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

Replace with:

```ts
export function logCompletedSession(
  id: string,
  projectId: string | null,
  description: string,
  startedAt: string,
  completedAt: string,
  jiraTicket?: string,
) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO sessions (id, projectId, description, startedAt, completedAt, isAutoCompleted, jiraTicket) VALUES (?, ?, ?, ?, ?, 0, ?)',
  );
  stmt.run(id, projectId ?? null, description, startedAt, completedAt, jiraTicket ?? null);
}
```

- [ ] **Step 3: Add the DDL migration**

Find this block inside `getDb()`:

```ts
// Migration: add jiraWorklogId to pre-existing sessions tables
const sessionCols = dbInstance.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
if (!sessionCols.some((c) => c.name === 'jiraWorklogId')) {
  dbInstance.exec('ALTER TABLE sessions ADD COLUMN jiraWorklogId TEXT');
}
```

Immediately after it, add:

```ts
// Migration: drop NOT NULL on sessions.projectId if it was created with the old schema
const projectIdCol = (sessionCols as Array<{ name: string; notnull: number }>).find((c) => c.name === 'projectId');
if (projectIdCol && projectIdCol.notnull === 1) {
  dbInstance.exec('BEGIN');
  try {
    dbInstance.exec(`
          CREATE TABLE sessions_new (
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
    dbInstance.exec(
      'INSERT INTO sessions_new (id, projectId, description, startedAt, completedAt, isAutoCompleted, jiraTicket, jiraWorklogId) ' +
        'SELECT id, projectId, description, startedAt, completedAt, isAutoCompleted, jiraTicket, jiraWorklogId FROM sessions',
    );
    dbInstance.exec('DROP TABLE sessions');
    dbInstance.exec('ALTER TABLE sessions_new RENAME TO sessions');
    dbInstance.exec('COMMIT');
  } catch (err) {
    dbInstance.exec('ROLLBACK');
    throw err;
  }
}
```

Also update the original `CREATE TABLE IF NOT EXISTS sessions` DDL further up in the same function so fresh installs create the nullable column from the start. Change:

```ts
        projectId TEXT NOT NULL,
```

to:

```ts
        projectId TEXT,
```

Inside that `CREATE TABLE IF NOT EXISTS sessions (...)` statement.

- [ ] **Step 4: Build and run the app once against an existing dev DB**

Run:

```bash
bun run build
bun run dash &
```

Open the dashboard in a browser, let it hit `/status`, then stop the process. Confirm in the logs that no schema error is printed. Then run:

```bash
bun -e "import('./dist/lib/db.js').then(m => { const rows = m.getRecentSessions(3, 0); console.log(JSON.stringify(rows, null, 2)); })"
```

Expected: existing sessions print with their `projectId` values preserved. If the migration ran, subsequent `PRAGMA table_info(sessions)` would show `projectId` with `notnull: 0`. Verify manually:

```bash
bun -e "import('./dist/lib/db.js').then(m => { const cols = m.getRecentSessions(0, 0); }); import('bun:sqlite').then(s => { const db = new s.Database(process.env.HOME + '/.clocktopus/data/sessions.db'); console.log(db.prepare('PRAGMA table_info(sessions)').all()); })"
```

Expected: `projectId` row shows `notnull: 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts
git commit -m "feat(db): allow null projectId on sessions"
```

---

## Task 3: Guard `POST /timer/start`

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Import the helper and uuid**

At the top of `dashboard/routes/timer.ts`, confirm these imports exist (add if missing):

```ts
import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Clockify } from '../../clockify.js';
import {
  completeLatestSession,
  deleteSessionById,
  getOpenSession,
  getSessionById,
  logCompletedSession,
  logSessionStart,
  setSessionJiraWorklogId,
} from '../../lib/db.js';
import { deleteJiraWorklog, stopJiraTimer } from '../../lib/jira.js';
import { isClockifyEnabled } from '../../lib/credentials.js';
```

(The only new line is the `isClockifyEnabled` import.)

- [ ] **Step 2: Rewrite `POST /timer/start`**

Find:

```ts
timerRoutes.post('/timer/start', async (c) => {
  const { projectId, description, jiraTicket, billable } = await c.req.json<{
    projectId: string;
    description: string;
    jiraTicket?: string;
    billable?: boolean;
  }>();

  if (!projectId || !description) {
    return c.json({ ok: false, error: 'Project and description are required.' }, 400);
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const result = await clockify.startTimer(
      user.defaultWorkspace,
      projectId,
      description,
      jiraTicket,
      billable ?? true,
    );
    if (!result) return c.json({ ok: false, error: 'Failed to start timer.' }, 500);

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
  }
});
```

Replace with:

```ts
timerRoutes.post('/timer/start', async (c) => {
  const { projectId, description, jiraTicket, billable } = await c.req.json<{
    projectId?: string | null;
    description: string;
    jiraTicket?: string;
    billable?: boolean;
  }>();

  const cleanDescription = (description ?? '').trim();
  const cleanJira = jiraTicket?.trim() || undefined;
  const clockifyOn = isClockifyEnabled();

  if (clockifyOn) {
    if (!projectId || !cleanDescription) {
      return c.json({ ok: false, error: 'Project and description are required.' }, 400);
    }
    try {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

      const result = await clockify.startTimer(
        user.defaultWorkspace,
        projectId,
        cleanDescription,
        cleanJira,
        billable ?? true,
      );
      if (!result) return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
    }
  }

  // Jira-only mode
  if (!cleanJira) {
    return c.json({ ok: false, error: 'Jira ticket required in Jira-only mode.' }, 400);
  }
  const finalDescription = cleanDescription || cleanJira;
  const sessionId = uuidv4();
  const startedAt = new Date().toISOString();
  logSessionStart(sessionId, projectId ?? null, finalDescription, startedAt, cleanJira);
  return c.json({ ok: true });
});
```

Rationale: in Clockify mode `clockify.startTimer` handles both the remote call and `logSessionStart`. Jira-only path writes the session directly. Description falls back to the ticket key when the user leaves it blank, so the sessions list has something readable.

- [ ] **Step 3: Manual verification — Clockify mode happy path**

Ensure Clockify key is set. Build and start the dashboard:

```bash
bun run build
bun run dash &
```

In the dashboard, start a timer with a project + description. Expected: Clockify shows a running entry, session appears in the DB with the Clockify entry id.

- [ ] **Step 4: Manual verification — Jira-only mode**

Clear the Clockify key:

```bash
bun -e "import('./dist/lib/db.js').then(m => m.setCredential('CLOCKIFY_API_KEY',''))"
```

Restart the dashboard. `curl` the endpoint:

```bash
curl -s -XPOST http://localhost:4001/api/timer/start \
  -H 'content-type: application/json' \
  -d '{"jiraTicket":"PROJ-1","description":"test"}'
```

Expected: `{"ok":true}`. `GET /api/timer/active` returns the open session with `jiraTicket: "PROJ-1"`.

Then try without ticket:

```bash
curl -s -XPOST http://localhost:4001/api/timer/start \
  -H 'content-type: application/json' \
  -d '{"description":"test"}'
```

Expected: 400 with `"Jira ticket required in Jira-only mode."`.

Restore the Clockify key via the Settings UI before the next task.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): guard /timer/start for Jira-only mode"
```

---

## Task 4: Guard `GET /timer/active`

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Rewrite the handler**

Find:

```ts
timerRoutes.get('/timer/active', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ active: false });

    const timer = await clockify.getActiveTimer(user.defaultWorkspace, user.id);
    if (!timer) {
      // Timer stopped externally (e.g. in Clockify app) — close any lingering open session
      const openSession = getOpenSession();
      if (openSession) {
        const completedAt = new Date().toISOString();
        completeLatestSession(completedAt, false);
        if (openSession.jiraTicket) {
          const timeSpentSeconds = Math.round(
            (new Date(completedAt).getTime() - new Date(openSession.startedAt).getTime()) / 1000,
          );
          if (timeSpentSeconds >= 60) {
            try {
              const worklog = await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
              if (worklog?.id) setSessionJiraWorklogId(openSession.id, worklog.id);
            } catch (err) {
              console.error('Error stopping Jira timer on external stop:', err);
            }
          }
        }
      }
      return c.json({ active: false });
    }

    // Sync externally-started timers (e.g. from Clockify app or Jira plugin) to DB
    const timerStart = timer.timeInterval.start as string;
    const jiraTicket = extractJiraTicket(timer.description ?? '');
    const openSession = getOpenSession();
    const alreadyTracked = openSession && openSession.startedAt.slice(0, 19) === timerStart.slice(0, 19);
    if (!alreadyTracked) {
      logSessionStart(timer.id ?? uuidv4(), timer.projectId, timer.description ?? '', timerStart, jiraTicket);
    }

    return c.json({
      active: true,
      description: timer.description,
      projectId: timer.projectId,
      start: timerStart,
      ...(jiraTicket ? { jiraTicket } : {}),
    });
  } catch {
    return c.json({ active: false });
  }
});
```

Replace with:

```ts
timerRoutes.get('/timer/active', async (c) => {
  if (!isClockifyEnabled()) {
    const openSession = getOpenSession();
    if (!openSession) return c.json({ active: false });
    return c.json({
      active: true,
      description: openSession.description,
      projectId: openSession.projectId,
      start: openSession.startedAt,
      ...(openSession.jiraTicket ? { jiraTicket: openSession.jiraTicket } : {}),
    });
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ active: false });

    const timer = await clockify.getActiveTimer(user.defaultWorkspace, user.id);
    if (!timer) {
      const openSession = getOpenSession();
      if (openSession) {
        const completedAt = new Date().toISOString();
        completeLatestSession(completedAt, false);
        if (openSession.jiraTicket) {
          const timeSpentSeconds = Math.round(
            (new Date(completedAt).getTime() - new Date(openSession.startedAt).getTime()) / 1000,
          );
          if (timeSpentSeconds >= 60) {
            try {
              const worklog = await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
              if (worklog?.id) setSessionJiraWorklogId(openSession.id, worklog.id);
            } catch (err) {
              console.error('Error stopping Jira timer on external stop:', err);
            }
          }
        }
      }
      return c.json({ active: false });
    }

    const timerStart = timer.timeInterval.start as string;
    const jiraTicket = extractJiraTicket(timer.description ?? '');
    const openSession = getOpenSession();
    const alreadyTracked = openSession && openSession.startedAt.slice(0, 19) === timerStart.slice(0, 19);
    if (!alreadyTracked) {
      logSessionStart(timer.id ?? uuidv4(), timer.projectId, timer.description ?? '', timerStart, jiraTicket);
    }

    return c.json({
      active: true,
      description: timer.description,
      projectId: timer.projectId,
      start: timerStart,
      ...(jiraTicket ? { jiraTicket } : {}),
    });
  } catch {
    return c.json({ active: false });
  }
});
```

- [ ] **Step 2: Manual verify — Jira-only open session visible**

Still with Clockify key cleared, and with the session from Task 3 still open:

```bash
curl -s http://localhost:4001/api/timer/active
```

Expected: `{"active":true,"description":"test","projectId":null,"start":"...","jiraTicket":"PROJ-1"}`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): read active timer from DB in Jira-only mode"
```

---

## Task 5: Guard `POST /timer/stop`

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Rewrite the handler**

Find:

```ts
timerRoutes.post('/timer/stop', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const openSession = getOpenSession();
    const result = await clockify.stopTimer(user.defaultWorkspace, user.id);
    if (!result) return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);

    const completedAt = new Date().toISOString();
    completeLatestSession(completedAt, false);

    if (openSession?.jiraTicket) {
      const timeSpentSeconds = Math.round(
        (new Date(completedAt).getTime() - new Date(openSession.startedAt).getTime()) / 1000,
      );
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(openSession.id, worklog.id);
        } catch (err) {
          console.error('Error stopping Jira timer:', err);
        }
      }
    }

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);
  }
});
```

Replace with:

```ts
timerRoutes.post('/timer/stop', async (c) => {
  try {
    const openSession = getOpenSession();

    if (isClockifyEnabled()) {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);
      const result = await clockify.stopTimer(user.defaultWorkspace, user.id);
      if (!result) return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);
    } else if (!openSession) {
      return c.json({ ok: false, error: 'No active timer.' }, 404);
    }

    const completedAt = new Date().toISOString();
    completeLatestSession(completedAt, false);

    if (openSession?.jiraTicket) {
      const timeSpentSeconds = Math.round(
        (new Date(completedAt).getTime() - new Date(openSession.startedAt).getTime()) / 1000,
      );
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(openSession.id, worklog.id);
        } catch (err) {
          console.error('Error stopping Jira timer:', err);
        }
      }
    }

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);
  }
});
```

- [ ] **Step 2: Manual verify — Jira-only stop posts worklog**

With the Jira-only session still open from earlier, wait at least 60s then:

```bash
curl -s -XPOST http://localhost:4001/api/timer/stop
```

Expected: `{"ok":true}`. Inspect Jira for a new worklog on `PROJ-1` matching the duration.

- [ ] **Step 3: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): allow stop in Jira-only mode"
```

---

## Task 6: Guard `POST /timer/log`

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Rewrite the handler**

Find:

```ts
timerRoutes.post('/timer/log', async (c) => {
  const { projectId, description, start, end, jiraTicket, billable } = await c.req.json<{
    projectId: string;
    description: string;
    start: string;
    end: string;
    jiraTicket?: string;
    billable?: boolean;
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

    const entry = await clockify.logTime(
      user.defaultWorkspace,
      projectId,
      startIso,
      endIso,
      finalDescription,
      billable ?? true,
    );
    if (!entry) return c.json({ ok: false, error: 'Failed to log time in Clockify.' }, 500);

    const entryId = (entry as { id?: string }).id ?? uuidv4();
    logCompletedSession(entryId, projectId, finalDescription, startIso, endIso, cleanJira);

    if (cleanJira) {
      const timeSpentSeconds = Math.round((endMs - startMs) / 1000);
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(cleanJira, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(entryId, worklog.id);
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

Replace with:

```ts
timerRoutes.post('/timer/log', async (c) => {
  const { projectId, description, start, end, jiraTicket, billable } = await c.req.json<{
    projectId?: string | null;
    description: string;
    start: string;
    end: string;
    jiraTicket?: string;
    billable?: boolean;
  }>();

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
  const clockifyOn = isClockifyEnabled();

  if (clockifyOn) {
    if (!projectId) {
      return c.json({ ok: false, error: 'Project is required.' }, 400);
    }
    if (!cleanDescription && !cleanJira) {
      return c.json({ ok: false, error: 'Description or Jira ticket is required.' }, 400);
    }
  } else {
    if (!cleanJira) {
      return c.json({ ok: false, error: 'Jira ticket required in Jira-only mode.' }, 400);
    }
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const finalDescription = cleanDescription || cleanJira!;
  let entryId: string;

  try {
    if (clockifyOn) {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

      const entry = await clockify.logTime(
        user.defaultWorkspace,
        projectId!,
        startIso,
        endIso,
        finalDescription,
        billable ?? true,
      );
      if (!entry) return c.json({ ok: false, error: 'Failed to log time in Clockify.' }, 500);
      entryId = (entry as { id?: string }).id ?? uuidv4();
    } else {
      entryId = uuidv4();
    }

    logCompletedSession(entryId, projectId ?? null, finalDescription, startIso, endIso, cleanJira);

    if (cleanJira) {
      const timeSpentSeconds = Math.round((endMs - startMs) / 1000);
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(cleanJira, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(entryId, worklog.id);
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

- [ ] **Step 2: Manual verify — Jira-only manual log**

With Clockify key cleared:

```bash
curl -s -XPOST http://localhost:4001/api/timer/log \
  -H 'content-type: application/json' \
  -d '{"jiraTicket":"PROJ-1","description":"manual","start":"2026-04-21T09:00:00Z","end":"2026-04-21T09:30:00Z"}'
```

Expected: `{"ok":true}`. A new session row exists with `projectId: null`; Jira worklog posted for 30 min.

Now without ticket:

```bash
curl -s -XPOST http://localhost:4001/api/timer/log \
  -H 'content-type: application/json' \
  -d '{"description":"manual","start":"2026-04-21T09:00:00Z","end":"2026-04-21T09:30:00Z"}'
```

Expected: 400 `"Jira ticket required in Jira-only mode."`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): allow manual log in Jira-only mode"
```

---

## Task 7: Guard `DELETE /timer/:id`

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Rewrite the handler**

Find:

```ts
timerRoutes.delete('/timer/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'Missing id.' }, 400);

  const session = getSessionById(id);
  if (!session) return c.json({ ok: false, error: 'Session not found.' }, 404);

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const clockifyOk = await clockify.deleteTimeEntry(user.defaultWorkspace, id);
    // Continue even if Clockify delete fails — the entry may already be gone remotely.
    if (!clockifyOk) console.warn(`Clockify delete returned failure for ${id}; removing local record anyway.`);

    if (session.jiraTicket && session.jiraWorklogId) {
      try {
        await deleteJiraWorklog(session.jiraTicket, session.jiraWorklogId);
      } catch (err) {
        console.error('Error deleting Jira worklog:', err);
      }
    }

    deleteSessionById(id);
    return c.json({ ok: true });
  } catch (err) {
    console.error('Error deleting entry:', err);
    return c.json({ ok: false, error: 'Failed to delete entry.' }, 500);
  }
});
```

Replace with:

```ts
timerRoutes.delete('/timer/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'Missing id.' }, 400);

  const session = getSessionById(id);
  if (!session) return c.json({ ok: false, error: 'Session not found.' }, 404);

  try {
    if (isClockifyEnabled()) {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (user) {
        const clockifyOk = await clockify.deleteTimeEntry(user.defaultWorkspace, id);
        if (!clockifyOk) console.warn(`Clockify delete returned failure for ${id}; removing local record anyway.`);
      } else {
        console.warn('Clockify enabled but getUser failed; skipping remote delete.');
      }
    }

    if (session.jiraTicket && session.jiraWorklogId) {
      try {
        await deleteJiraWorklog(session.jiraTicket, session.jiraWorklogId);
      } catch (err) {
        console.error('Error deleting Jira worklog:', err);
      }
    }

    deleteSessionById(id);
    return c.json({ ok: true });
  } catch (err) {
    console.error('Error deleting entry:', err);
    return c.json({ ok: false, error: 'Failed to delete entry.' }, 500);
  }
});
```

- [ ] **Step 2: Manual verify — delete in Jira-only mode**

Grab the id of the session created in Task 6 (from `/api/sessions?page=1&limit=5`) and:

```bash
curl -s -XDELETE http://localhost:4001/api/timer/<id>
```

Expected: `{"ok":true}`. Session disappears from DB. If the session had a `jiraWorklogId`, the worklog is gone in Jira.

- [ ] **Step 3: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): allow delete in Jira-only mode"
```

---

## Task 8: Guard `/projects/fetch` in `data.ts`

**Files:**

- Modify: `dashboard/routes/data.ts`

- [ ] **Step 1: Import helper**

At the top of `dashboard/routes/data.ts`, add:

```ts
import { isClockifyEnabled } from '../../lib/credentials.js';
```

- [ ] **Step 2: Guard the fetch route**

Find:

```ts
dataRoutes.post('/projects/fetch', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const projects = await clockify.getProjects(user.defaultWorkspace);
    if (projects.length === 0) return c.json({ ok: false, error: 'No projects found.' }, 404);

    upsertProjects(projects);
    return c.json({ ok: true, count: projects.length });
  } catch {
    return c.json({ ok: false, error: 'Failed to fetch projects.' }, 500);
  }
});
```

Replace with:

```ts
dataRoutes.post('/projects/fetch', async (c) => {
  if (!isClockifyEnabled()) {
    return c.json({ ok: false, error: 'Clockify not configured.' }, 400);
  }
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const projects = await clockify.getProjects(user.defaultWorkspace);
    if (projects.length === 0) return c.json({ ok: false, error: 'No projects found.' }, 404);

    upsertProjects(projects);
    return c.json({ ok: true, count: projects.length });
  } catch {
    return c.json({ ok: false, error: 'Failed to fetch projects.' }, 500);
  }
});
```

- [ ] **Step 3: Manual verify**

With Clockify key cleared:

```bash
curl -s -XPOST http://localhost:4001/api/projects/fetch
```

Expected: `{"ok":false,"error":"Clockify not configured."}` with HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add dashboard/routes/data.ts
git commit -m "feat(data): block /projects/fetch when Clockify is not configured"
```

---

## Task 9: Guard calendar routes

**Files:**

- Modify: `dashboard/routes/calendar.ts`

- [ ] **Step 1: Import helper**

Add at the top:

```ts
import { isClockifyEnabled } from '../../lib/credentials.js';
```

- [ ] **Step 2: Guard `/calendar/events`**

Inside the `calendarRoutes.get('/calendar/events', ...)` handler, add this as the very first line of the handler body (before `const start = c.req.query(...)`):

```ts
if (!isClockifyEnabled()) {
  return c.json({ ok: false, error: 'Calendar sync requires Clockify.' }, 400);
}
```

- [ ] **Step 3: Guard `/calendar/log`**

Same treatment inside the `calendarRoutes.post('/calendar/log', ...)` handler — first line of the body:

```ts
if (!isClockifyEnabled()) {
  return c.json({ ok: false, error: 'Calendar sync requires Clockify.' }, 400);
}
```

- [ ] **Step 4: Manual verify**

With Clockify key cleared:

```bash
curl -s "http://localhost:4001/api/calendar/events?start=2026-04-21&end=2026-04-21"
```

Expected: `{"ok":false,"error":"Calendar sync requires Clockify."}`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/calendar.ts
git commit -m "feat(calendar): gate endpoints on Clockify configuration"
```

---

## Task 10: Guard `scripts/log-calendar-events.ts`

**Files:**

- Modify: `scripts/log-calendar-events.ts`

- [ ] **Step 1: Add early-exit**

At the top of `main()` (immediately after `async function main() {`), insert:

```ts
const { isClockifyEnabled } = await import('../lib/credentials.js');
if (!isClockifyEnabled()) {
  console.log('Calendar sync requires Clockify. Configure Clockify API key and re-run.');
  return;
}
```

The dynamic import avoids dragging the DB open before the dotenv section at the top of the file has a chance to populate `process.env`.

- [ ] **Step 2: Manual verify**

With Clockify key cleared:

```bash
bun run log-calendar -t
```

Expected: prints "Calendar sync requires Clockify..." and exits 0 without touching Google.

- [ ] **Step 3: Commit**

```bash
git add scripts/log-calendar-events.ts
git commit -m "feat(scripts): exit log-calendar early when Clockify is not configured"
```

---

## Task 11: CLI — lazy Clockify + guard `start`, `stop`, `status`

**Files:**

- Modify: `index.ts`

The module currently constructs `const clockify = new Clockify();` at import time. The class itself is harmless without a key (methods just return null on failure), but `getWorkspaceAndUser()` calls `getUser()` and exits the process when it returns null. We need those paths to be skipped in Jira-only mode.

- [ ] **Step 1: Import helper**

Near the top of `index.ts`, add:

```ts
import { isClockifyEnabled } from './lib/credentials.js';
```

(Do not remove the `const clockify = new Clockify();` line — it stays.)

- [ ] **Step 2: Rewrite the `start` command**

Find the whole `program.command('start')` block. Inside its `.action(async (message, options) => { ... })`, change:

```ts
    const { workspaceId } = await getWorkspaceAndUser();

    let projects: Project[] = await clockify.getProjects(workspaceId);
    let localProjects = await getLocalProjects();
    ...
    const entry = await clockify.startTimer(workspaceId, selectedProjectId, message, options.jira, options.billable);
    if (entry) {
      const projectName = projects.find((p: { name: string; id: string }) => p.id === selectedProjectId)?.name;
      console.log(chalk.green(`Timer started for project: ${chalk.bold(projectName)}`));
    }
```

To (add the Jira-only short-circuit before the Clockify flow):

```ts
    if (!isClockifyEnabled()) {
      if (!options.jira) {
        console.error(chalk.red('Jira-only mode requires --jira <ticket>.'));
        process.exit(1);
      }
      const sessionId = (await import('uuid')).v4();
      const startedAt = new Date().toISOString();
      const description = (message && String(message).trim()) || options.jira;
      const { logSessionStart } = await import('./lib/db.js');
      logSessionStart(sessionId, null, description, startedAt, options.jira);
      console.log(chalk.green(`Timer started for ${chalk.bold(options.jira)} (Jira-only mode).`));
      return;
    }

    const { workspaceId } = await getWorkspaceAndUser();

    let projects: Project[] = await clockify.getProjects(workspaceId);
    let localProjects = await getLocalProjects();
    ...
    const entry = await clockify.startTimer(workspaceId, selectedProjectId, message, options.jira, options.billable);
    if (entry) {
      const projectName = projects.find((p: { name: string; id: string }) => p.id === selectedProjectId)?.name;
      console.log(chalk.green(`Timer started for project: ${chalk.bold(projectName)}`));
    }
```

(The `...` preserves the existing interior logic that filters `localProjects` and runs the inquirer prompt. Keep that as-is.)

- [ ] **Step 3: Rewrite the `stop` command**

Find:

```ts
program
  .command('stop')
  .description('Stop the currently running time entry.')
  .action(async () => {
    const { workspaceId, userId } = await getWorkspaceAndUser();
    const latestSession = getLatestSession();
    const stoppedEntry = await clockify.stopTimer(workspaceId, userId);
    if (stoppedEntry) {
      const completedAt = new Date().toISOString();
      completeLatestSession(completedAt);
      if (latestSession.jiraTicket) {
        const timeSpentSeconds = Math.round(
          (new Date(completedAt).getTime() - new Date(latestSession.startedAt).getTime()) / 1000,
        );
        if (timeSpentSeconds >= 60) {
          try {
            const worklog = await stopJiraTimer(latestSession.jiraTicket, timeSpentSeconds);
            if (worklog?.id) setSessionJiraWorklogId(latestSession.id, worklog.id);
          } catch (error) {
            console.error('Error stopping Jira timer:', error);
          }
        }
      }
      console.log(chalk.red('Timer stopped.'));
    } else {
      console.log(chalk.yellow('No timer was running.'));
    }
  });
```

Replace with:

```ts
program
  .command('stop')
  .description('Stop the currently running time entry.')
  .action(async () => {
    const latestSession = getLatestSession();

    if (isClockifyEnabled()) {
      const { workspaceId, userId } = await getWorkspaceAndUser();
      const stoppedEntry = await clockify.stopTimer(workspaceId, userId);
      if (!stoppedEntry) {
        console.log(chalk.yellow('No timer was running.'));
        return;
      }
    } else {
      if (!latestSession || latestSession.completedAt) {
        console.log(chalk.yellow('No timer was running.'));
        return;
      }
    }

    const completedAt = new Date().toISOString();
    completeLatestSession(completedAt);

    if (latestSession?.jiraTicket) {
      const timeSpentSeconds = Math.round(
        (new Date(completedAt).getTime() - new Date(latestSession.startedAt).getTime()) / 1000,
      );
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(latestSession.jiraTicket, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(latestSession.id, worklog.id);
        } catch (error) {
          console.error('Error stopping Jira timer:', error);
        }
      }
    }
    console.log(chalk.red('Timer stopped.'));
  });
```

- [ ] **Step 4: Rewrite the `status` command**

Find:

```ts
program
  .command('status')
  .description('Check the status of the current timer.')
  .action(async () => {
    const { workspaceId, userId } = await getWorkspaceAndUser();
    const activeEntry = await clockify.getActiveTimer(workspaceId, userId);

    if (activeEntry) {
      const startTime = new Date(activeEntry.timeInterval.start);
      const duration = (new Date().getTime() - startTime.getTime()) / 1000; // in seconds
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);

      console.log(chalk.green('🕒 A timer is currently running.'));
      console.log(`   - ${chalk.bold('Project:')} ${activeEntry.project.name}`);
      console.log(`   - ${chalk.bold('Running for:')} ${hours}h ${minutes}m`);
    } else {
      console.log(chalk.yellow('No timer is currently running.'));
    }
  });
```

Replace with:

```ts
program
  .command('status')
  .description('Check the status of the current timer.')
  .action(async () => {
    if (isClockifyEnabled()) {
      const { workspaceId, userId } = await getWorkspaceAndUser();
      const activeEntry = await clockify.getActiveTimer(workspaceId, userId);

      if (activeEntry) {
        const startTime = new Date(activeEntry.timeInterval.start);
        const duration = (new Date().getTime() - startTime.getTime()) / 1000;
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);

        console.log(chalk.green('🕒 A timer is currently running.'));
        console.log(`   - ${chalk.bold('Project:')} ${activeEntry.project.name}`);
        console.log(`   - ${chalk.bold('Running for:')} ${hours}h ${minutes}m`);
        return;
      }
      console.log(chalk.yellow('No timer is currently running.'));
      return;
    }

    // Jira-only mode: read from DB
    const { getOpenSession } = await import('./lib/db.js');
    const open = getOpenSession();
    if (!open) {
      console.log(chalk.yellow('No timer is currently running.'));
      return;
    }
    const startTime = new Date(open.startedAt);
    const duration = (new Date().getTime() - startTime.getTime()) / 1000;
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    console.log(chalk.green('🕒 A timer is currently running (Jira-only mode).'));
    if (open.jiraTicket) console.log(`   - ${chalk.bold('Jira:')} ${open.jiraTicket}`);
    console.log(`   - ${chalk.bold('Description:')} ${open.description}`);
    console.log(`   - ${chalk.bold('Running for:')} ${hours}h ${minutes}m`);
  });
```

- [ ] **Step 5: Manual verify — CLI in Jira-only mode**

With Clockify key cleared, rebuild and run:

```bash
bun run build
bun run clock start "feature work" -j PROJ-42
bun run clock status
# wait >60s
bun run clock stop
```

Expected:

- `start` prints "Timer started for PROJ-42 (Jira-only mode)."
- `status` shows Jira-only timer details.
- `stop` prints "Timer stopped." and Jira worklog appears for `PROJ-42`.

Also:

```bash
bun run clock start "no ticket"
```

Expected: exits 1 with "Jira-only mode requires --jira <ticket>.".

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat(cli): support Jira-only mode for start/stop/status"
```

---

## Task 12: CLI — guard `monitor:run`

**Files:**

- Modify: `index.ts`

- [ ] **Step 1: Rewrite `stopTimerAndLog` and `safeRestartTimerIfNeeded`**

Locate the `program.command('monitor:run', { hidden: true })` action. Inside it, find the `stopTimerAndLog(reason)` function. Replace:

```ts
    async function stopTimerAndLog(reason: string) {
      const activeEntry = await clockify.getActiveTimer(workspaceId, userId);
      if (!activeEntry) return false;

      console.log(chalk.yellow(reason));
      const completedAt = new Date().toISOString();
      const latestSession = getLatestSession();

      const stoppedEntry = await clockify.stopTimer(workspaceId, userId);
      if (!stoppedEntry) return false;

      completeLatestSession(completedAt, true);
      ...
    }
```

With a version that branches on `isClockifyEnabled()`:

```ts
    async function stopTimerAndLog(reason: string) {
      const clockifyOn = isClockifyEnabled();
      const latestSession = getLatestSession();

      if (clockifyOn) {
        const activeEntry = await clockify.getActiveTimer(workspaceId, userId);
        if (!activeEntry) return false;
      } else {
        if (!latestSession || latestSession.completedAt) return false;
      }

      console.log(chalk.yellow(reason));
      const completedAt = new Date().toISOString();

      if (clockifyOn) {
        const stoppedEntry = await clockify.stopTimer(workspaceId, userId);
        if (!stoppedEntry) return false;
      }

      completeLatestSession(completedAt, true);
      // ...rest of existing Jira worklog block stays as-is
```

Keep the existing Jira worklog logic below (posting `stopJiraTimer` + `setSessionJiraWorklogId`, logging the `chalk.red('Timer stopped.')`, `return true;`) intact.

Next, find `safeRestartTimerIfNeeded` in the same action. Its current job is to detect an auto-completed session and resume by creating a fresh Clockify entry. For Jira-only mode, it creates a new DB session with a new uuid and the same ticket. Update the function:

```ts
async function safeRestartTimerIfNeeded() {
  const now = Date.now();
  if (now - lastResumeAt < RESUME_COOLDOWN_MS) return;
  const latest = getLatestSession();
  if (!latest || !latest.isAutoCompleted || !latest.completedAt) return;

  if (isClockifyEnabled()) {
    // existing Clockify resume flow — keep as-is
    lastResumeAt = now;
    await clockify.startTimer(workspaceId, latest.projectId!, latest.description, latest.jiraTicket ?? undefined, true);
    return;
  }

  // Jira-only resume: new DB session with a fresh uuid
  if (!latest.jiraTicket) return;
  lastResumeAt = now;
  const { v4: uuidv4 } = await import('uuid');
  const { logSessionStart } = await import('./lib/db.js');
  const sessionId = uuidv4();
  const startedAt = new Date().toISOString();
  logSessionStart(sessionId, latest.projectId ?? null, latest.description, startedAt, latest.jiraTicket);
  console.log(chalk.green(`Resumed Jira timer for ${latest.jiraTicket}.`));
}
```

Keep the surrounding `let lastResumeAt = 0;` and `const RESUME_COOLDOWN_MS = 10_000;` declarations exactly as they are.

Additionally, the outer `monitor:run` action calls `getWorkspaceAndUser()` at the top. Wrap that call so it is skipped entirely in Jira-only mode (and only runs once in Clockify mode):

```ts
const creds = isClockifyEnabled() ? await getWorkspaceAndUser() : { workspaceId: '', userId: '' };
const { workspaceId, userId } = creds;
```

(Functions that use these vars only reach the Clockify branches anyway — the empty strings are never dereferenced against the API when Clockify is disabled.)

- [ ] **Step 2: Manual verify — monitor in Jira-only mode**

Start the monitor in the foreground so the logs are visible:

```bash
bun dist/index.js monitor:run
```

(Skip PM2 for this verification.) Start a Jira-only timer with `clock start -j PROJ-42 "work"`, then lock the screen (or wait past the idle threshold). Expected logs:

- "Screen is locked/off. Stopping timer..."
- "Timer stopped."
- Jira worklog appears on PROJ-42 for the elapsed time.

Unlock / become active. Expected: "Resumed Jira timer for PROJ-42." and a fresh open session in the DB.

Kill the monitor with Ctrl-C after verifying.

- [ ] **Step 3: Commit**

```bash
git add index.ts
git commit -m "feat(monitor): support Jira-only mode for idle stop/resume"
```

---

## Task 13: Dashboard UI — conditional rendering in `views.ts`

**Files:**

- Modify: `dashboard/views.ts`

`views.ts` is ~1300 lines. The dashboard fetches `/api/status` on load and on settings save; it already stores the result in a top-level `state` object. We are adding render branches that consult `state.clockify`.

- [ ] **Step 1: Identify the render entry points**

Before editing, search for the following tokens in `views.ts` and confirm each exists (they anchor the changes below). If any is missing, stop and report which one.

```bash
grep -n "api/status" dashboard/views.ts
grep -n "Pull from Clockify" dashboard/views.ts
grep -n "Jira" dashboard/views.ts
grep -n "calendar" dashboard/views.ts
grep -n "project" dashboard/views.ts | head
```

Record the surrounding function/handler names. Every change below refers to those anchors.

- [ ] **Step 2: Home timer form — hide project select when Clockify is off**

Locate the timer form render in `views.ts` (the element containing the project `<select>` and the description/Jira inputs). Add a wrapper `style="display:none"` toggle that turns on when `state.clockify === false`. The simplest mechanism is a classlist flip in the function that consumes the status payload (look for `setStatus` or similar).

When `state.clockify === false`, do all of the following:

- Hide the `<select name="projectId">` parent container.
- Show a small chip (create a new `<span class="mode-chip">Jira-only mode</span>` adjacent to the form title).
- Add `required` to the Jira ticket input and remove `required` from project select.
- If `state.jira === false` as well, hide the form entirely and render a `<div class="empty-state">Configure Clockify or Jira in Settings to start tracking.</div>`.

Use simple DOM toggles inside the existing status-handler function — no framework. Example pattern (adapt names to the actual ids in the file):

```ts
const form = document.querySelector('#timer-form') as HTMLFormElement;
const projectWrap = document.querySelector('#timer-project-wrap') as HTMLElement;
const jiraInput = document.querySelector('#timer-jira') as HTMLInputElement;
const modeChip = document.querySelector('#timer-mode-chip') as HTMLElement;
const emptyState = document.querySelector('#no-provider') as HTMLElement;

if (state.clockify) {
  projectWrap.style.display = '';
  modeChip.style.display = 'none';
  jiraInput.required = false;
  form.style.display = '';
  emptyState.style.display = 'none';
} else if (state.jira) {
  projectWrap.style.display = 'none';
  modeChip.style.display = '';
  jiraInput.required = true;
  form.style.display = '';
  emptyState.style.display = 'none';
} else {
  form.style.display = 'none';
  emptyState.style.display = '';
}
```

If the referenced ids do not exist yet, add them to the existing markup (add `id="timer-form"`, `id="timer-project-wrap"`, `id="timer-jira"`, `id="timer-mode-chip"`). Add the empty-state element once inside the Home tab container.

- [ ] **Step 3: Projects tab — hide "Pull from Clockify" button when Clockify is off**

Find the element containing the text `Pull from Clockify`. Add an id like `id="pull-clockify-btn"` if not present. In the status handler:

```ts
const pullBtn = document.querySelector('#pull-clockify-btn') as HTMLButtonElement | null;
if (pullBtn) pullBtn.style.display = state.clockify ? '' : 'none';
```

- [ ] **Step 4: Calendar tab — disable when Clockify is off**

Find the nav link / tab button for Calendar. Add `id="calendar-tab-link"` if missing, and a caption element beneath (or as a `title` attribute). In the status handler:

```ts
const calTab = document.querySelector('#calendar-tab-link') as HTMLElement | null;
if (calTab) {
  if (state.clockify) {
    calTab.removeAttribute('aria-disabled');
    calTab.classList.remove('is-disabled');
    calTab.title = '';
  } else {
    calTab.setAttribute('aria-disabled', 'true');
    calTab.classList.add('is-disabled');
    calTab.title = 'Calendar sync requires Clockify.';
  }
}
```

Also guard the tab click handler: if `aria-disabled` is set, `event.preventDefault()` and do not switch tabs.

Add a CSS rule in the existing `<style>` block:

```css
.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}
```

- [ ] **Step 5: Settings — disable Google Connect button when Clockify is off**

Find the Google Connect button. Add `id="google-connect-btn"` if missing, and a helper-text element beneath with `id="google-connect-note"`. In the status handler:

```ts
const gBtn = document.querySelector('#google-connect-btn') as HTMLButtonElement | null;
const gNote = document.querySelector('#google-connect-note') as HTMLElement | null;
if (gBtn) gBtn.disabled = !state.clockify;
if (gNote) gNote.textContent = state.clockify ? '' : 'Calendar sync requires Clockify. Connect Clockify first.';
```

- [ ] **Step 6: Sessions list — render "—" when `projectName` is unknown**

Find where sessions render (look for the `projectName` property on session rows). Where it currently prints the name, fall back to `session.projectName || '—'`. Sessions with `projectId: null` already come back with `projectName: 'Unknown'` from `data.ts`; change that default too:

In `dashboard/routes/data.ts`, change:

```ts
projectName: projectMap.get(s.projectId as string) ?? 'Unknown',
```

to:

```ts
projectName: s.projectId ? (projectMap.get(s.projectId as string) ?? 'Unknown') : null,
```

In `views.ts`, render `s.projectName ?? '—'`.

- [ ] **Step 7: Header status indicator — show "Jira-only" label**

Find the connection-indicator markup. When `state.clockify === false && state.jira === true`, render a small pill `Jira-only` next to the connection dots. Reuse the existing dot element classes for styling consistency.

- [ ] **Step 8: Manual verify — UI matrix**

Build and run the dashboard. For each state, load the Home, Projects, Calendar, and Settings tabs, and confirm:

- `(C+ J+)`: everything renders as today.
- `(C+ J-)`: everything renders as today (Jira section shows "Not configured").
- `(C- J+)`: project dropdown hidden, "Jira-only mode" chip shown, Jira ticket required, Calendar tab disabled with tooltip, Google Connect disabled with helper text, "Pull from Clockify" button hidden, header shows "Jira-only" pill.
- `(C- J-)`: Home form hidden, empty-state shown.

Use the DB credential trick to flip states:

```bash
bun -e "import('./dist/lib/db.js').then(m => m.setCredential('CLOCKIFY_API_KEY',''))"
# reload the dashboard
```

Restore the key via the Settings UI after each toggle.

- [ ] **Step 9: Commit**

```bash
git add dashboard/views.ts dashboard/routes/data.ts
git commit -m "feat(ui): render Jira-only mode conditionals in dashboard"
```

---

## Task 14: End-to-end matrix sweep + lint

**Files:**

- None edited. Final verification.

- [ ] **Step 1: Lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 2: Build**

```bash
bun run build
```

Expected: clean.

- [ ] **Step 3: Run the four-state matrix end-to-end**

For each of `(C+ J+)`, `(C+ J-)`, `(C- J+)`, `(C- J-)`:

- Start the dashboard.
- Exercise: start timer, status, stop, manual log, delete entry.
- For monitor: exercise lock/unlock (or wait past the idle threshold) and confirm expected auto-stop + resume behavior.
- Confirm Jira worklogs are created/removed as expected.

Record any failures as follow-up tickets.

- [ ] **Step 4: Final commit (only if prior commits missed anything)**

```bash
git status
# if clean, stop. Otherwise commit whatever was missed.
```

---

## Self-review checklist for the implementor

Before opening a PR:

- Spec coverage — every bullet of `docs/superpowers/specs/2026-04-21-jira-only-mode-design.md` is implemented or explicitly marked out of scope.
- No `TODO` / `TBD` left.
- `bun run lint` clean.
- `bun test lib/credentials.test.ts` passes.
- Matrix sweep exercised; worklogs verified in Jira directly.
- Commit history reads as a linear sequence of feat/fix commits. Squash if requested by the reviewer.
