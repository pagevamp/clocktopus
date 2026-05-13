# End-of-Day Timer Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in end-of-day reminder that pops a desktop notification on weekdays at a user-configured time when a Clockify timer is running, with Stop and one-time 15-minute Snooze actions.

**Architecture:** A new `settings` SQLite table holds the toggle, time, and per-day fire state. A pure function (`lib/eod.ts`) decides per minute-tick whether to fire. The existing PM2 monitor daemon (`index.ts` `monitor:run`) runs the tick. A shared notifier (`lib/notifier.ts`) wraps `node-notifier` with actions + callback. The Hono dashboard exposes `/api/settings/eod` and adds a card to the Settings tab.

**Tech Stack:** TypeScript (ESM, strict), Bun runtime, `bun:sqlite`, `bun:test`, Hono, `node-notifier`, PM2.

---

## File Structure

| File                           | Action | Responsibility                                                           |
| ------------------------------ | ------ | ------------------------------------------------------------------------ |
| `lib/db.ts`                    | edit   | Add `settings` table + generic `getSetting`/`setSetting`/`deleteSetting` |
| `lib/settings.ts`              | create | Typed EOD accessors over the generic settings table                      |
| `lib/eod.ts`                   | create | Pure `shouldFireEod` decision logic (no I/O)                             |
| `lib/eod.test.ts`              | create | Unit tests for `shouldFireEod` decision matrix                           |
| `lib/notifier.ts`              | create | Shared `node-notifier` wrapper with logo + actions                       |
| `clockify.ts`                  | edit   | Replace inline notifier with `lib/notifier.ts`                           |
| `dashboard/routes/settings.ts` | create | GET/POST `/api/settings/eod`                                             |
| `dashboard/server.ts`          | edit   | Register settings route                                                  |
| `dashboard/views.ts`           | edit   | Add EOD card to Settings tab + client JS                                 |
| `index.ts`                     | edit   | Add EOD tick interval inside `monitor:run` action                        |

---

## Task 1: Settings table + generic accessors

**Files:**

- Modify: `lib/db.ts`

- [ ] **Step 1: Add the `settings` table to `getDb()`**

In `lib/db.ts`, inside the `getDb()` function, after the existing `CREATE TABLE IF NOT EXISTS atlassian_tokens (…)` block, add:

```ts
dbInstance.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);
```

- [ ] **Step 2: Add generic accessors at the bottom of `lib/db.ts`**

Append (next to `getCredential` / `setCredential`):

```ts
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)');
  stmt.run(key, value, new Date().toISOString());
}

export function deleteSetting(key: string) {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
```

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts
git commit -m "feat(db): add settings table and generic accessors"
```

---

## Task 2: Pure EOD decision logic

**Files:**

- Create: `lib/eod.ts`
- Create: `lib/eod.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/eod.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { shouldFireEod, type EodState } from './eod.js';

const base: EodState = {
  enabled: true,
  time: '18:00',
  lastFiredDate: null,
  snoozeUntil: null,
  hasOpenSession: true,
};

// Mon 2026-05-11 17:59 local
const beforeTime = new Date(2026, 4, 11, 17, 59, 0);
// Mon 2026-05-11 18:00 local
const atTime = new Date(2026, 4, 11, 18, 0, 0);
// Mon 2026-05-11 18:30 local
const afterTime = new Date(2026, 4, 11, 18, 30, 0);
// Sat 2026-05-09 18:30 local
const weekend = new Date(2026, 4, 9, 18, 30, 0);

describe('shouldFireEod', () => {
  it('returns skip when disabled', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, enabled: false } })).toBe('skip');
  });

  it('returns skip on Saturday', () => {
    expect(shouldFireEod({ now: weekend, state: base })).toBe('skip');
  });

  it('returns skip when before configured time', () => {
    expect(shouldFireEod({ now: beforeTime, state: base })).toBe('skip');
  });

  it('returns fire-primary at the configured time with open session', () => {
    expect(shouldFireEod({ now: atTime, state: base })).toBe('fire-primary');
  });

  it('returns fire-primary after the configured time with open session', () => {
    expect(shouldFireEod({ now: afterTime, state: base })).toBe('fire-primary');
  });

  it('returns skip-mark-fired when after time but no open session', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, hasOpenSession: false } })).toBe('skip-mark-fired');
  });

  it('returns skip when already fired today', () => {
    expect(
      shouldFireEod({
        now: afterTime,
        state: { ...base, lastFiredDate: '2026-05-11' },
      }),
    ).toBe('skip');
  });

  it('returns skip when snooze pending and now < snoozeUntil', () => {
    const snoozeUntil = new Date(2026, 4, 11, 18, 45, 0).toISOString();
    expect(
      shouldFireEod({
        now: afterTime,
        state: { ...base, lastFiredDate: '2026-05-11', snoozeUntil },
      }),
    ).toBe('skip');
  });

  it('returns fire-snooze when snooze elapsed, same day, open session', () => {
    const snoozeUntil = new Date(2026, 4, 11, 18, 15, 0).toISOString();
    const now = new Date(2026, 4, 11, 18, 20, 0);
    expect(
      shouldFireEod({
        now,
        state: { ...base, lastFiredDate: '2026-05-11', snoozeUntil },
      }),
    ).toBe('fire-snooze');
  });

  it('returns skip-mark-fired when snooze elapsed but no open session', () => {
    const snoozeUntil = new Date(2026, 4, 11, 18, 15, 0).toISOString();
    const now = new Date(2026, 4, 11, 18, 20, 0);
    expect(
      shouldFireEod({
        now,
        state: { ...base, lastFiredDate: '2026-05-11', snoozeUntil, hasOpenSession: false },
      }),
    ).toBe('skip-mark-fired');
  });

  it('returns skip when snooze elapsed but date is yesterday', () => {
    const snoozeUntil = new Date(2026, 4, 10, 18, 15, 0).toISOString();
    const now = new Date(2026, 4, 11, 18, 20, 0);
    expect(
      shouldFireEod({
        now,
        state: { ...base, lastFiredDate: '2026-05-10', snoozeUntil },
      }),
    ).toBe('skip');
  });

  it('returns skip when time string is malformed', () => {
    expect(shouldFireEod({ now: afterTime, state: { ...base, time: 'oops' } })).toBe('skip');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/eod.test.ts`
Expected: FAIL — `Cannot find module './eod.js'` or similar.

- [ ] **Step 3: Implement `lib/eod.ts`**

Create `lib/eod.ts`:

```ts
export interface EodState {
  enabled: boolean;
  time: string | null;
  lastFiredDate: string | null;
  snoozeUntil: string | null;
  hasOpenSession: boolean;
}

export type EodDecision = 'fire-primary' | 'fire-snooze' | 'skip-mark-fired' | 'skip';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToTodayDate(now: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

export function shouldFireEod(args: { now: Date; state: EodState }): EodDecision {
  const { now, state } = args;

  if (!state.enabled) return 'skip';
  if (!isWeekday(now)) return 'skip';
  if (!state.time || !TIME_RE.test(state.time)) return 'skip';

  if (state.snoozeUntil) {
    const snoozeDate = new Date(state.snoozeUntil);
    if (now < snoozeDate) return 'skip';
    if (localDateString(snoozeDate) !== localDateString(now)) return 'skip';
    return state.hasOpenSession ? 'fire-snooze' : 'skip-mark-fired';
  }

  const today = localDateString(now);
  if (state.lastFiredDate === today) return 'skip';

  const fireAt = timeToTodayDate(now, state.time);
  if (now < fireAt) return 'skip';

  return state.hasOpenSession ? 'fire-primary' : 'skip-mark-fired';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/eod.test.ts`
Expected: 12 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/eod.ts lib/eod.test.ts
git commit -m "feat(eod): add pure shouldFireEod decision logic"
```

---

## Task 3: Typed EOD settings accessors

**Files:**

- Create: `lib/settings.ts`

- [ ] **Step 1: Create `lib/settings.ts`**

```ts
import { getSetting, setSetting, deleteSetting } from './db.js';
import type { EodState } from './eod.js';

const KEY = {
  enabled: 'eodReminderEnabled',
  time: 'eodReminderTime',
  lastFiredDate: 'eodLastFiredDate',
  snoozeUntil: 'eodSnoozeUntil',
} as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface EodSettingsForUi {
  enabled: boolean;
  time: string | null;
}

export function getEodSettings(): EodSettingsForUi {
  const enabled = getSetting(KEY.enabled) === 'true';
  const rawTime = getSetting(KEY.time);
  const time = rawTime && TIME_RE.test(rawTime) ? rawTime : null;
  return { enabled, time };
}

export function setEodSettings(input: { enabled: boolean; time: string }) {
  if (!TIME_RE.test(input.time)) {
    throw new Error(`Invalid time: ${input.time}`);
  }
  setSetting(KEY.enabled, input.enabled ? 'true' : 'false');
  setSetting(KEY.time, input.time);
}

export function readEodState(hasOpenSession: boolean): EodState {
  const ui = getEodSettings();
  return {
    enabled: ui.enabled,
    time: ui.time,
    lastFiredDate: getSetting(KEY.lastFiredDate),
    snoozeUntil: getSetting(KEY.snoozeUntil),
    hasOpenSession,
  };
}

export function markEodFired(localDate: string) {
  setSetting(KEY.lastFiredDate, localDate);
  deleteSetting(KEY.snoozeUntil);
}

export function setEodSnoozeUntil(iso: string) {
  setSetting(KEY.snoozeUntil, iso);
}

export function clearEodSnoozeUntil() {
  deleteSetting(KEY.snoozeUntil);
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/settings.ts
git commit -m "feat(settings): add typed EOD settings accessors"
```

---

## Task 4: Shared notifier wrapper

**Files:**

- Create: `lib/notifier.ts`

- [ ] **Step 1: Create `lib/notifier.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { NotificationCenter } from 'node-notifier';

function resolveLogoPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here, prev = ''; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'assets', 'logo.png');
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const LOGO_PATH = resolveLogoPath();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const notifier: any = new NotificationCenter();

export interface NotifyOptions {
  subtitle: string;
  message: string;
  actions?: string[];
  sound?: boolean;
  wait?: boolean;
}

export type NotifyCallback = (err: unknown, response: unknown, metadata: { activationValue?: string }) => void;

export function notify(opts: NotifyOptions, callback?: NotifyCallback): void {
  notifier.notify(
    {
      title: 'Clocktopus',
      subtitle: opts.subtitle,
      message: opts.message,
      sound: opts.sound ?? true,
      wait: opts.wait ?? true,
      actions: opts.actions,
      contentImage: LOGO_PATH,
    },
    callback ??
      ((err: unknown) => {
        if (err) console.error('Notification error:', err);
      }),
  );
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/notifier.ts
git commit -m "feat(notifier): add shared node-notifier wrapper"
```

---

## Task 5: Refactor Clockify to use shared notifier

**Files:**

- Modify: `clockify.ts`

- [ ] **Step 1: Replace inline notifier in `clockify.ts`**

In `clockify.ts`:

1. Remove the imports for `* as fs`, `* as path`, `fileURLToPath`, and `NotificationCenter` from `node-notifier` if they are only used by `resolveLogoPath` / the notifier (they likely are — verify by reading the file).
2. Remove the `resolveLogoPath` function and `LOGO_PATH` constant.
3. Replace the `notifier` field, its constructor init, and `sendNotification` method with a thin call to the shared `notify`.

Add at the top of `clockify.ts` (with existing imports):

```ts
import { notify, type NotifyCallback } from './lib/notifier.js';
```

Remove from `Clockify` class:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
private readonly notifier: any;
```

And remove its assignment in the constructor:

```ts
this.notifier = new NotificationCenter();
```

Replace the `sendNotification` method body with:

```ts
private sendNotification(
  subtitle: string,
  message: string,
  actions?: string[],
  callback?: NotifyCallback,
) {
  notify({ subtitle, message, actions }, callback);
}
```

- [ ] **Step 2: Verify build and lint**

Run: `bun run build && bun run lint`
Expected: exit 0 for both.

- [ ] **Step 3: Smoke test**

Run: `bun run clock start --help`
Expected: command help prints without errors. (Ensures the file still loads.)

- [ ] **Step 4: Commit**

```bash
git add clockify.ts
git commit -m "refactor(clockify): use shared notifier wrapper"
```

---

## Task 6: Dashboard route for EOD settings

**Files:**

- Create: `dashboard/routes/settings.ts`
- Modify: `dashboard/server.ts`

- [ ] **Step 1: Create `dashboard/routes/settings.ts`**

```ts
import { Hono } from 'hono';
import { getEodSettings, setEodSettings } from '../../lib/settings.js';

const settingsRoutes = new Hono();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

settingsRoutes.get('/settings/eod', (c) => {
  const s = getEodSettings();
  return c.json(s);
});

settingsRoutes.post('/settings/eod', async (c) => {
  let body: { enabled?: unknown; time?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const enabled = body.enabled === true;
  const time = typeof body.time === 'string' ? body.time : '';
  if (enabled && !TIME_RE.test(time)) {
    return c.json({ ok: false, error: 'Time must be HH:mm (24h).' }, 400);
  }
  // When disabling, still persist whatever (valid) time was sent, or default 18:00.
  const finalTime = TIME_RE.test(time) ? time : '18:00';
  setEodSettings({ enabled, time: finalTime });
  return c.json({ ok: true });
});

export default settingsRoutes;
```

- [ ] **Step 2: Register route in `dashboard/server.ts`**

Add the import next to the other route imports:

```ts
import settingsRoutes from './routes/settings.js';
```

And add the route registration next to the others:

```ts
app.route('/api', settingsRoutes);
```

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: exit 0.

- [ ] **Step 4: Smoke test the endpoint**

Start the dashboard (`bun run dashboard` in one terminal — note: the script uses `dist/`, so build first), then in another:

```bash
curl -s http://localhost:$(node -e "console.log(require('./dist/lib/constants.js').DASHBOARD_PORT)")/api/settings/eod
```

Expected: `{"enabled":false,"time":null}` (or current state).

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"enabled":true,"time":"18:00"}' \
  http://localhost:$(node -e "console.log(require('./dist/lib/constants.js').DASHBOARD_PORT)")/api/settings/eod
```

Expected: `{"ok":true}`.

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"enabled":true,"time":"99:99"}' \
  http://localhost:$(node -e "console.log(require('./dist/lib/constants.js').DASHBOARD_PORT)")/api/settings/eod
```

Expected: HTTP 400 with `{"ok":false,"error":"Time must be HH:mm (24h)."}`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/settings.ts dashboard/server.ts
git commit -m "feat(dashboard): add /api/settings/eod route"
```

---

## Task 7: Dashboard UI — Settings card

**Files:**

- Modify: `dashboard/views.ts`

- [ ] **Step 1: Locate the Settings tab**

Open `dashboard/views.ts`. Find the `<!-- SETTINGS TAB -->` comment (around line 312) and its `<div class="cards">` container. The new card must go inside that container.

- [ ] **Step 2: Add the EOD card markup**

Add the following card inside the Settings tab's `<div class="cards">`, after the existing Jira card (or as the last card before the closing `</div>` of `cards`):

```html
<!-- End-of-Day Reminder -->
<div class="card">
  <div class="card-header">
    <div class="dot gray" id="eod-dot"></div>
    <h2>End-of-Day Reminder</h2>
  </div>
  <div class="guide">
    <p>
      Pop a notification on weekdays at a chosen time. Click <strong>Stop</strong> to end the timer or
      <strong>Snooze 15m</strong> for one more reminder.
    </p>
  </div>
  <label style="display:flex; align-items:center; gap:0.6rem; margin-top:0.5rem;">
    <input type="checkbox" id="eod-enabled" />
    <span>Enable end-of-day reminder</span>
  </label>
  <label for="eod-time" style="margin-top:0.75rem;">Time (24h)</label>
  <input type="time" id="eod-time" value="18:00" />
  <button onclick="saveEod()">Save</button>
  <div class="msg" id="eod-msg"></div>
</div>
```

- [ ] **Step 3: Add the client JS for load/save**

In the same file, find where other settings tabs hydrate from the API (look for `loadClockify` / `saveClockify` patterns). Add these functions:

```js
async function loadEod() {
  try {
    const r = await fetch('/api/settings/eod');
    const data = await r.json();
    document.getElementById('eod-enabled').checked = !!data.enabled;
    if (data.time) document.getElementById('eod-time').value = data.time;
    const dot = document.getElementById('eod-dot');
    if (dot) dot.className = 'dot ' + (data.enabled ? 'green' : 'gray');
  } catch (err) {
    console.error('Failed to load EOD settings', err);
  }
}

async function saveEod() {
  const enabled = document.getElementById('eod-enabled').checked;
  const time = document.getElementById('eod-time').value;
  const msg = document.getElementById('eod-msg');
  msg.textContent = '';
  try {
    const r = await fetch('/api/settings/eod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, time }),
    });
    const data = await r.json();
    if (!r.ok) {
      msg.textContent = data.error || 'Save failed.';
      msg.className = 'msg err';
      return;
    }
    msg.textContent = 'Saved.';
    msg.className = 'msg ok';
    const dot = document.getElementById('eod-dot');
    if (dot) dot.className = 'dot ' + (enabled ? 'green' : 'gray');
  } catch (err) {
    msg.textContent = 'Network error.';
    msg.className = 'msg err';
  }
}
```

Then call `loadEod()` from the same place the other `load*()` settings calls are invoked on settings tab activation or page load. Look for an existing `loadClockify()` call and add `loadEod()` next to it.

- [ ] **Step 4: Verify build**

Run: `bun run build`
Expected: exit 0.

- [ ] **Step 5: Manual UI check**

Run: `bun run dashboard` then open `http://localhost:<DASHBOARD_PORT>` in a browser, switch to Settings tab. Verify:

- The "End-of-Day Reminder" card appears.
- Checkbox + time input render.
- Save with valid time → "Saved." message, dot turns green.
- Reload page → values persist.
- Save with empty time while enabled → server returns 400, error message shown.

- [ ] **Step 6: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): add end-of-day reminder settings card"
```

---

## Task 8: EOD tick in monitor

**Files:**

- Modify: `index.ts`

- [ ] **Step 1: Add imports near the top of `index.ts`**

Where other `lib/*` imports live, add (use `import type` for the type):

```ts
import { shouldFireEod, type EodState } from './lib/eod.js';
import { readEodState, markEodFired, setEodSnoozeUntil, clearEodSnoozeUntil } from './lib/settings.js';
import { notify } from './lib/notifier.js';
```

Note: `EodState` is imported but not directly referenced; keep only if needed. If TS flags unused, drop the type import.

- [ ] **Step 2: Add the EOD tick inside the `monitor:run` action**

Inside the `monitor:run` action body, after the existing `idleInterval = setInterval(...)` block and before the `cleanupAndExit` function, add:

```ts
const EOD_TICK_MS = 60_000;

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const eodInterval = setInterval(async () => {
  try {
    const { getOpenSession } = await import('./lib/db.js');
    const open = getOpenSession();
    const state = readEodState(!!open);
    const decision = shouldFireEod({ now: new Date(), state });
    if (decision === 'skip') return;

    const today = localDateString(new Date());

    if (decision === 'skip-mark-fired') {
      markEodFired(today);
      return;
    }

    const isPrimary = decision === 'fire-primary';
    const actions = isPrimary ? ['Stop', 'Snooze 15m'] : ['Stop'];

    if (isPrimary) markEodFired(today);

    notify(
      {
        subtitle: 'End of day',
        message: 'Timer still running. Stop now?',
        actions,
      },
      async (err, _resp, meta) => {
        if (err) {
          console.error('EOD notification error:', err);
          return;
        }
        const choice = meta?.activationValue;
        if (choice === 'Stop') {
          try {
            await stopTimerAndLog('End-of-day reminder.');
          } catch (e) {
            console.error('EOD stop failed:', e);
          }
          clearEodSnoozeUntil();
        } else if (choice === 'Snooze 15m') {
          const snoozeUntil = new Date(Date.now() + 15 * 60_000).toISOString();
          setEodSnoozeUntil(snoozeUntil);
        }
      },
    );

    if (!isPrimary) {
      // fire-snooze: second popup has already been shown; clear the snooze flag
      clearEodSnoozeUntil();
    }
  } catch (e) {
    console.error('EOD tick error:', e);
  }
}, EOD_TICK_MS);
```

- [ ] **Step 3: Clear the EOD interval in `cleanupAndExit`**

In the same action body, locate `cleanupAndExit(code = 0)` and add a `clearInterval(eodInterval)` block matching the existing pattern:

```ts
function cleanupAndExit(code = 0) {
  try {
    clearInterval(idleInterval);
  } catch {}
  try {
    clearInterval(eodInterval);
  } catch {}
  try {
    if (pollInterval) clearInterval(pollInterval);
  } catch {}
  process.exit(code);
}
```

- [ ] **Step 4: Verify build and lint**

Run: `bun run build && bun run lint`
Expected: exit 0 for both.

- [ ] **Step 5: Re-run unit tests**

Run: `bun test`
Expected: all tests pass (EOD unit tests + existing tests).

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat(monitor): fire end-of-day reminder via tick interval"
```

---

## Task 9: End-to-end manual verification

**Files:** none

- [ ] **Step 1: Rebuild and restart monitor**

```bash
bun run build
bun run monitor:restart
```

- [ ] **Step 2: Configure EOD via dashboard**

Open dashboard. In Settings, enable EOD with time set to `<current_local_time + 2 min>`. Save.

- [ ] **Step 3: Start a timer**

Use the dashboard or `bun run clock start` to start a timer for any project.

- [ ] **Step 4: Wait for the primary popup**

Within ~60 s of the configured time, a macOS notification appears with **Stop** and **Snooze 15m** actions. Click **Snooze 15m**.

- [ ] **Step 5: Verify snooze persisted**

Run:

```bash
bun -e "import('./dist/lib/db.js').then(m => console.log({ snooze: m.getSetting('eodSnoozeUntil'), lastFired: m.getSetting('eodLastFiredDate') }))"
```

Expected: `snooze` is an ISO timestamp ~15 min in the future, `lastFired` is today's date.

- [ ] **Step 6: Wait for the snooze popup (~15 min)**

A second notification appears with **Stop** only (no Snooze). Click **Stop**.

- [ ] **Step 7: Verify timer stopped**

Check the dashboard or run `bun run clock status`. Timer should be stopped. Confirm in Clockify web UI if Clockify is enabled.

- [ ] **Step 8: Verify no further popups**

Wait several minutes. No more popups for the remainder of the day (`lastFiredDate` blocks them).

- [ ] **Step 9: Verify dismiss path**

Re-enable EOD with a fresh time (the next minute), start a new timer, let the popup appear, ignore it. After 60 s no further popups today.

- [ ] **Step 10: Verify weekend skip**

(Optional, if the test day is a weekday.) Temporarily edit the system date to a Saturday (or wait for one) and confirm no popup fires even with a running timer at the EOD time. Skip if not feasible.

- [ ] **Step 11: Final commit (only if no fixes needed)**

If steps 1–10 require code adjustments, fix them and commit individually. Otherwise no commit needed here.

---

## Self-review notes

- Spec requirement 1 (settable time + toggle) → Tasks 1, 3, 6, 7.
- Spec requirement 2 (disabled by default) → covered by `getSetting` returning `null` ⇒ `enabled === false`.
- Spec requirement 3 (weekday popup with two actions) → Tasks 2, 8.
- Spec requirement 4 (Stop calls `stopTimerAndLog`) → Task 8 callback.
- Spec requirement 5 (single 15-min snooze with Stop-only second popup) → Task 8 action-list switch.
- Spec requirement 6 (dismiss → no further popups today) → covered by setting `lastFiredDate` on primary fire.
- Spec requirement 7 (no popup when daemon down; idle covers wake) → no code; documented.
- Spec requirement 8 (no popup when no open session) → `skip-mark-fired` branch in Tasks 2 and 8.
- All `EodState` field names match between `lib/eod.ts`, `lib/settings.ts`, and the tick code.
- All file paths are exact; no TBDs or "similar to" references.
