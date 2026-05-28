# Self-update feature implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-28-self-update-design.md`

**Goal:** Let users update the globally-installed `clocktopus` npm package and download newer desktop `.dmg` releases from within the app, with periodic background detection.

**Architecture:** A shared `lib/updater.ts` core handles npm registry lookups, semver compare, and the `bun i -g clocktopus --trust` spawn. A dedicated `lib/update-cache.ts` persists the latest-seen version in SQLite so monitor daemon and dashboard can share state. New Hono routes expose check / install / SSE-log endpoints; a CLI subcommand and Tauri Rust commands reuse the same core. Tauri additionally surfaces a desktop-app updater that downloads `.dmg` assets from GitHub Releases. Monitor daemon polls every 6 h and fires an OS notification; the dashboard polls as a fallback when monitor is off; the Tauri webview polls for tray indicator state.

**Tech Stack:** TypeScript (ESM), Hono, `bun:sqlite`, `bun:test`, commander, node-notifier, Tauri (Rust), SSE.

---

## File map

**Create:**

- `lib/updater.ts` — current version, latest npm fetch, runUpdate spawn, semver compare.
- `lib/updater.test.ts` — unit tests for the core.
- `lib/update-cache.ts` — SQLite-backed cache row accessors.
- `lib/update-cache.test.ts` — cache accessor tests.
- `lib/desktop-version.ts` — GitHub Releases fetch + dmg asset resolver.
- `lib/desktop-version.test.ts` — desktop-version unit tests.
- `dashboard/routes/update.ts` — `/api/version`, `/api/update`, SSE stream, dismiss.
- `dashboard/routes/update.test.ts` — route tests.
- `dashboard/routes/desktop-version.ts` — `/api/desktop-version`.
- `dashboard/routes/desktop-version.test.ts` — route tests.
- `desktop/src-tauri/icons/tray-update.png` — dot-variant tray icon (copy of existing tray with badge).

**Modify:**

- `lib/db.ts` — add `update_check` table + accessors via `update-cache.ts`.
- `lib/settings.ts` — add `updates.autoCheck`, `updates.notify` accessors.
- `dashboard/server.ts` — register the two new route modules.
- `dashboard/views.ts` — add "About" sub-tab inside Settings; modal markup + JS.
- `dashboard/routes/settings.ts` — expose update settings GET/PUT.
- `index.ts` — add `clocktopus update` subcommand; wire periodic checker into `monitor:run`.
- `desktop/src-tauri/src/lib.rs` — extract `run_bun_install_clocktopus`, add `update_clocktopus` + `download_desktop_update` commands; tray menu refresh logic.
- `desktop/src-tauri/Cargo.toml` — add `reqwest` (download) and `futures-util` if not present.
- `desktop/src-tauri/capabilities/default.json` — allow the new commands.

---

## Task 1: Settings keys + getters

**Files:**

- Modify: `lib/settings.ts`
- Test: `lib/settings.ts` (add to existing tests if file exists, otherwise create `lib/settings.test.ts`)

- [ ] **Step 1: Write the failing test**

Create `lib/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

const TMP = path.join(import.meta.dir, '__tmp_settings__');
process.env.CLOCKTOPUS_DATA_DIR = TMP;

import { getUpdateSettings, setUpdateSettings } from './settings.js';

describe('update settings', () => {
  beforeEach(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  it('returns defaults when nothing stored', () => {
    expect(getUpdateSettings()).toEqual({ autoCheck: true, notify: true });
  });

  it('round-trips written values', () => {
    setUpdateSettings({ autoCheck: false, notify: true });
    expect(getUpdateSettings()).toEqual({ autoCheck: false, notify: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/settings.test.ts`
Expected: FAIL — `getUpdateSettings is not a function`.

- [ ] **Step 3: Implement the accessors**

Append to `lib/settings.ts`:

```ts
const UPDATE_KEY = {
  autoCheck: 'updatesAutoCheck',
  notify: 'updatesNotify',
} as const;

export interface UpdateSettings {
  autoCheck: boolean;
  notify: boolean;
}

export function getUpdateSettings(): UpdateSettings {
  const autoRaw = getSetting(UPDATE_KEY.autoCheck);
  const notifyRaw = getSetting(UPDATE_KEY.notify);
  return {
    autoCheck: autoRaw === null ? true : autoRaw === 'true',
    notify: notifyRaw === null ? true : notifyRaw === 'true',
  };
}

export function setUpdateSettings(input: UpdateSettings) {
  setSetting(UPDATE_KEY.autoCheck, input.autoCheck ? 'true' : 'false');
  setSetting(UPDATE_KEY.notify, input.notify ? 'true' : 'false');
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test lib/settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/settings.ts lib/settings.test.ts
git commit -m "feat(settings): add update auto-check + notify toggles"
```

---

## Task 2: `update_check` table + cache accessors

**Files:**

- Create: `lib/update-cache.ts`
- Create: `lib/update-cache.test.ts`
- Modify: `lib/db.ts` (add CREATE TABLE in `getDb()`)

- [ ] **Step 1: Write the failing test**

Create `lib/update-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

const TMP = path.join(import.meta.dir, '__tmp_updcache__');
process.env.CLOCKTOPUS_DATA_DIR = TMP;

import { getUpdateCache, setUpdateCache, markNotifiedVersion } from './update-cache.js';

describe('update_check cache', () => {
  beforeEach(() => {
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  it('returns null when nothing stored', () => {
    expect(getUpdateCache()).toBeNull();
  });

  it('round-trips a write', () => {
    setUpdateCache({
      latestVersion: '1.13.0',
      publishedAt: '2026-05-28T10:00:00Z',
      checkedAt: '2026-05-28T11:00:00Z',
    });
    expect(getUpdateCache()).toEqual({
      latestVersion: '1.13.0',
      publishedAt: '2026-05-28T10:00:00Z',
      checkedAt: '2026-05-28T11:00:00Z',
      notifiedVersion: null,
    });
  });

  it('markNotifiedVersion records the version without clobbering others', () => {
    setUpdateCache({
      latestVersion: '1.13.0',
      publishedAt: '2026-05-28T10:00:00Z',
      checkedAt: '2026-05-28T11:00:00Z',
    });
    markNotifiedVersion('1.13.0');
    expect(getUpdateCache()?.notifiedVersion).toBe('1.13.0');
    expect(getUpdateCache()?.latestVersion).toBe('1.13.0');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test lib/update-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add table to `lib/db.ts`**

Inside `getDb()`, after the existing `CREATE TABLE IF NOT EXISTS settings` block (around line 138), insert:

```ts
dbInstance.exec(`
  CREATE TABLE IF NOT EXISTS update_check (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    latest_version TEXT,
    published_at TEXT,
    checked_at TEXT,
    notified_version TEXT
  )
`);
dbInstance.exec(`INSERT OR IGNORE INTO update_check (id) VALUES (1)`);
```

- [ ] **Step 4: Create `lib/update-cache.ts`**

```ts
// SQLite-backed single-row cache shared across monitor daemon and dashboard.
// One row, id=1, seeded by lib/db.ts on first open.

import { Database } from 'bun:sqlite';
import * as path from 'path';

function getDbInstance(): Database {
  // Reuse the same DB the rest of the app opens. We import lazily to avoid a
  // circular dependency between lib/db.ts and this file.
  const { __dbInternal } = require('./db.js') as { __dbInternal: () => Database };
  return __dbInternal();
}

export interface UpdateCacheRow {
  latestVersion: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  notifiedVersion: string | null;
}

export function getUpdateCache(): UpdateCacheRow | null {
  const row = getDbInstance()
    .prepare('SELECT latest_version, published_at, checked_at, notified_version FROM update_check WHERE id = 1')
    .get() as
    | {
        latest_version: string | null;
        published_at: string | null;
        checked_at: string | null;
        notified_version: string | null;
      }
    | undefined;
  if (!row) return null;
  if (!row.latest_version && !row.checked_at) return null;
  return {
    latestVersion: row.latest_version,
    publishedAt: row.published_at,
    checkedAt: row.checked_at,
    notifiedVersion: row.notified_version,
  };
}

export function setUpdateCache(input: { latestVersion: string; publishedAt: string; checkedAt: string }) {
  getDbInstance()
    .prepare('UPDATE update_check SET latest_version = ?, published_at = ?, checked_at = ? WHERE id = 1')
    .run(input.latestVersion, input.publishedAt, input.checkedAt);
}

export function markNotifiedVersion(version: string) {
  getDbInstance().prepare('UPDATE update_check SET notified_version = ? WHERE id = 1').run(version);
}
```

- [ ] **Step 5: Export `__dbInternal` from `lib/db.ts`**

Bottom of `lib/db.ts`, add:

```ts
// Internal: exposed so sibling modules in lib/ can share the singleton without
// each opening their own connection.
export const __dbInternal = getDb;
```

- [ ] **Step 6: Run tests, verify pass**

Run: `bun test lib/update-cache.test.ts`
Expected: PASS (3 tests).
Also run: `bun test lib/db.test.ts` — Expected: still PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts lib/update-cache.ts lib/update-cache.test.ts
git commit -m "feat(db): add update_check cache table + accessors"
```

---

## Task 3: `lib/updater.ts` — version + semver

**Files:**

- Create: `lib/updater.ts`
- Create: `lib/updater.test.ts`

- [ ] **Step 1: Write the failing tests**

`lib/updater.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

describe('isUpdateAvailable', () => {
  it('true when latest is strictly greater', async () => {
    const { isUpdateAvailable } = await import('./updater.js');
    expect(isUpdateAvailable('1.12.3', '1.13.0')).toBe(true);
    expect(isUpdateAvailable('1.12.3', '2.0.0')).toBe(true);
  });

  it('false when equal or downgrade', async () => {
    const { isUpdateAvailable } = await import('./updater.js');
    expect(isUpdateAvailable('1.12.3', '1.12.3')).toBe(false);
    expect(isUpdateAvailable('2.0.0', '1.99.99')).toBe(false);
  });

  it('treats prerelease as lower than its base release', async () => {
    const { isUpdateAvailable } = await import('./updater.js');
    expect(isUpdateAvailable('1.13.0-rc.1', '1.13.0')).toBe(true);
    expect(isUpdateAvailable('1.13.0', '1.13.0-rc.1')).toBe(false);
  });
});

describe('getCurrentVersion', () => {
  it('returns a non-empty semver-ish string', async () => {
    const { getCurrentVersion } = await import('./updater.js');
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('fetchLatestVersion', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });
  beforeEach(async () => {
    // Reset module so the in-memory cache starts fresh per test.
    const mod = await import('./updater.js');
    mod.__resetFetchCacheForTests();
  });

  it('caches the result for 5 minutes', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response(JSON.stringify({ version: '1.13.0', time: { '1.13.0': '2026-05-28T00:00:00Z' } }), {
        status: 200,
      });
    }) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    await fetchLatestVersion();
    await fetchLatestVersion();
    expect(calls).toBe(1);
  });

  it('force=true bypasses the cache', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response(JSON.stringify({ version: '1.13.0', time: { '1.13.0': '2026-05-28T00:00:00Z' } }), {
        status: 200,
      });
    }) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    await fetchLatestVersion();
    await fetchLatestVersion({ force: true });
    expect(calls).toBe(2);
  });

  it('returns null on 5xx', async () => {
    globalThis.fetch = mock(async () => new Response('boom', { status: 503 })) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null on network error', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    expect(await fetchLatestVersion()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test lib/updater.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/updater.ts` (version + semver only — install spawn in Task 4)**

```ts
// Shared core for self-update across CLI, dashboard, and Tauri.
// This file only covers version lookup + semver compare. The install spawn
// lives in the same file but is added in Task 4.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REGISTRY_URL = 'https://registry.npmjs.org/clocktopus/latest';
const REGISTRY_CACHE_MS = 5 * 60 * 1000;

interface RegistryFetchCache {
  at: number;
  value: LatestVersion | null;
}

let registryCache: RegistryFetchCache | null = null;

export interface LatestVersion {
  version: string;
  publishedAt: string;
}

export function getCurrentVersion(): string {
  // Resolve our own package.json regardless of where the binary lives.
  // From dist/lib/updater.js, the package.json is at ../../package.json.
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here, prev = ''; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as { name?: string; version?: string };
        if (pkg.name === 'clocktopus' && typeof pkg.version === 'string') return pkg.version;
      } catch {
        // keep walking up
      }
    }
  }
  return '0.0.0';
}

export async function fetchLatestVersion(opts: { force?: boolean } = {}): Promise<LatestVersion | null> {
  if (!opts.force && registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) {
    return registryCache.value;
  }
  let value: LatestVersion | null = null;
  try {
    const res = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json()) as { version?: string; time?: Record<string, string> };
      if (body.version) {
        value = {
          version: body.version,
          publishedAt: body.time?.[body.version] ?? new Date().toISOString(),
        };
      }
    }
  } catch {
    value = null;
  }
  registryCache = { at: Date.now(), value };
  return value;
}

export function __resetFetchCacheForTests() {
  registryCache = null;
}

// Tiny semver compare. Returns 1 if a>b, -1 if a<b, 0 if equal. Treats a
// release with prerelease tag as lower than the same release without one,
// matching npm-style precedence (1.0.0-rc.1 < 1.0.0).
function cmpSemver(a: string, b: string): number {
  const parse = (s: string) => {
    const [main, pre] = s.split('-', 2);
    const nums = main.split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1; // release > prerelease
  if (pb.pre === '') return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return cmpSemver(latest, current) > 0;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test lib/updater.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/updater.ts lib/updater.test.ts
git commit -m "feat(updater): npm registry lookup + semver compare"
```

---

## Task 4: `lib/updater.ts` — install spawn

**Files:**

- Modify: `lib/updater.ts` (append `runUpdate`, `stopMonitorIfRunning`)
- Modify: `lib/updater.test.ts` (append tests)

- [ ] **Step 1: Add failing tests**

Append to `lib/updater.test.ts`:

```ts
describe('runUpdate', () => {
  it('spawns bun with the expected args and resolves on exit 0', async () => {
    const calls: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
    const fakeSpawn = (cmd: string, args: string[], opts: { env: Record<string, string> }) => {
      calls.push({ cmd, args, env: opts.env });
      // minimal EventEmitter-shaped fake
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emitter = {
        stdout: { on: (e: string, cb: (b: Buffer) => void) => (listeners['out-' + e] = [cb]) },
        stderr: { on: (e: string, cb: (b: Buffer) => void) => (listeners['err-' + e] = [cb]) },
        on: (e: string, cb: (code: number) => void) => {
          if (e === 'close') setTimeout(() => cb(0), 5);
          return emitter;
        },
      };
      // emit one stdout line
      setTimeout(() => listeners['out-data']?.[0](Buffer.from('installing\n')), 1);
      return emitter as unknown;
    };
    const { runUpdate, __setSpawnerForTests } = await import('./updater.js');
    __setSpawnerForTests(fakeSpawn);
    const logs: string[] = [];
    await runUpdate({ onLog: (l) => logs.push(l) });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['i', '-g', 'clocktopus', '--trust']);
    expect(calls[0].env.PATH.startsWith(`${process.env.HOME}/.bun/bin:`)).toBe(true);
    expect(logs).toContain('installing');
    __setSpawnerForTests(null);
  });

  it('rejects with combined stderr on non-zero exit', async () => {
    const fakeSpawn = () => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emitter = {
        stdout: { on: () => {} },
        stderr: { on: (e: string, cb: (b: Buffer) => void) => (listeners['err-' + e] = [cb]) },
        on: (e: string, cb: (code: number) => void) => {
          if (e === 'close') setTimeout(() => cb(1), 5);
          return emitter;
        },
      };
      setTimeout(() => listeners['err-data']?.[0](Buffer.from('permission denied\n')), 1);
      return emitter as unknown;
    };
    const { runUpdate, __setSpawnerForTests } = await import('./updater.js');
    __setSpawnerForTests(fakeSpawn);
    await expect(runUpdate({ onLog: () => {} })).rejects.toThrow(/permission denied/);
    __setSpawnerForTests(null);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test lib/updater.test.ts`
Expected: FAIL — `runUpdate` not exported.

- [ ] **Step 3: Implement spawn + stopMonitor helpers**

Append to `lib/updater.ts`:

```ts
import { spawn as nodeSpawn } from 'child_process';
import type { ChildProcess } from 'child_process';

type Spawner = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv },
) => Pick<ChildProcess, 'stdout' | 'stderr' | 'on'>;

let spawner: Spawner | null = null;

export function __setSpawnerForTests(fn: Spawner | null) {
  spawner = fn;
}

function resolveBun(): string {
  const home = process.env.HOME ?? '';
  const candidates = [path.join(home, '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('bun not found');
}

export interface RunUpdateOpts {
  onLog: (line: string) => void;
}

export async function runUpdate({ onLog }: RunUpdateOpts): Promise<void> {
  const bun = resolveBun();
  const home = process.env.HOME ?? '';
  const env = {
    ...process.env,
    PATH: `${path.join(home, '.bun', 'bin')}:${process.env.PATH ?? ''}`,
  };
  const useSpawn = spawner ?? (nodeSpawn as unknown as Spawner);
  const child = useSpawn(bun, ['i', '-g', 'clocktopus', '--trust'], { env });
  const stderrBuf: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line) onLog(line);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line) {
        stderrBuf.push(line);
        onLog(line);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    child.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(stderrBuf.join('\n') || `bun exited with code ${code}`));
    });
  });
}

// Best-effort: call into the existing monitor:stop CLI subcommand. Used by
// dashboard route + CLI subcommand before running the install.
export async function stopMonitorIfRunning(): Promise<void> {
  const bun = (() => {
    try {
      return resolveBun();
    } catch {
      return null;
    }
  })();
  if (!bun) return;
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
  if (!fs.existsSync(cliPath)) return;
  await new Promise<void>((resolve) => {
    const child = nodeSpawn(bun, [cliPath, 'monitor:stop'], { stdio: 'ignore' });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test lib/updater.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/updater.ts lib/updater.test.ts
git commit -m "feat(updater): runUpdate spawn + monitor stop helper"
```

---

## Task 5: GitHub Releases desktop lookup

**Files:**

- Create: `lib/desktop-version.ts`
- Create: `lib/desktop-version.test.ts`

- [ ] **Step 1: Write failing tests**

`lib/desktop-version.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

beforeEach(async () => {
  const mod = await import('./desktop-version.js');
  mod.__resetCacheForTests();
});

describe('fetchLatestDesktopRelease', () => {
  it('returns the latest dmg asset url', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.0.3',
            name: 'Clocktopus 1.0.3',
            html_url: 'https://github.com/pagevamp/clocktopus/releases/tag/v1.0.3',
            published_at: '2026-05-20T00:00:00Z',
            assets: [
              { name: 'Clocktopus_1.0.3_aarch64.dmg', browser_download_url: 'https://example.com/dmg' },
              { name: 'sig.txt', browser_download_url: 'https://example.com/sig' },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    const out = await fetchLatestDesktopRelease();
    expect(out).toEqual({
      version: '1.0.3',
      htmlUrl: 'https://github.com/pagevamp/clocktopus/releases/tag/v1.0.3',
      publishedAt: '2026-05-20T00:00:00Z',
      downloadUrl: 'https://example.com/dmg',
    });
  });

  it('returns downloadUrl=null when no dmg asset', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.0.3',
            html_url: 'h',
            published_at: 'p',
            assets: [{ name: 'foo.zip', browser_download_url: 'z' }],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    const out = await fetchLatestDesktopRelease();
    expect(out?.downloadUrl).toBeNull();
  });

  it('returns null on 5xx', async () => {
    globalThis.fetch = mock(async () => new Response('x', { status: 502 })) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    expect(await fetchLatestDesktopRelease()).toBeNull();
  });

  it('caches for 6 hours', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response(JSON.stringify({ tag_name: 'v1.0.3', html_url: '', published_at: '', assets: [] }), {
        status: 200,
      });
    }) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    await fetchLatestDesktopRelease();
    await fetchLatestDesktopRelease();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test lib/desktop-version.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// GitHub Releases lookup for the Tauri-shipped desktop app.

const RELEASE_URL = 'https://api.github.com/repos/pagevamp/clocktopus/releases/latest';
const CACHE_MS = 6 * 60 * 60 * 1000;

interface DesktopReleaseCache {
  at: number;
  value: DesktopRelease | null;
}

let cache: DesktopReleaseCache | null = null;

export interface DesktopRelease {
  version: string;
  htmlUrl: string;
  publishedAt: string;
  downloadUrl: string | null;
}

export async function fetchLatestDesktopRelease(opts: { force?: boolean } = {}): Promise<DesktopRelease | null> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: DesktopRelease | null = null;
  try {
    const res = await fetch(RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'clocktopus' },
    });
    if (res.ok) {
      const body = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        published_at?: string;
        assets?: { name: string; browser_download_url: string }[];
      };
      const tag = body.tag_name ?? '';
      const version = tag.startsWith('v') ? tag.slice(1) : tag;
      const dmg = body.assets?.find((a) => a.name.toLowerCase().endsWith('.dmg'));
      value = {
        version,
        htmlUrl: body.html_url ?? '',
        publishedAt: body.published_at ?? '',
        downloadUrl: dmg?.browser_download_url ?? null,
      };
    }
  } catch {
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}

export function __resetCacheForTests() {
  cache = null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `bun test lib/desktop-version.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/desktop-version.ts lib/desktop-version.test.ts
git commit -m "feat(desktop-version): GitHub Releases lookup for .dmg"
```

---

## Task 6: `/api/version` route

**Files:**

- Create: `dashboard/routes/update.ts`
- Create: `dashboard/routes/update.test.ts`
- Modify: `dashboard/server.ts`

- [ ] **Step 1: Write failing test**

`dashboard/routes/update.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('GET /api/version', () => {
  beforeEach(async () => {
    const mod = await import('../../lib/updater.js');
    mod.__resetFetchCacheForTests();
  });

  it('returns current + latest + updateAvailable', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: '999.0.0', time: { '999.0.0': '2026-05-28T00:00:00Z' } }), {
        status: 200,
      })) as typeof fetch;
    const updateRoutes = (await import('./update.js')).default;
    const app = new Hono().route('/api', updateRoutes);
    const res = await app.request('/api/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      current: string;
      latest: string;
      updateAvailable: boolean;
    };
    expect(body.current).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.latest).toBe('999.0.0');
    expect(body.updateAvailable).toBe(true);
  });

  it('returns latest=null when registry fails', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 503 })) as typeof fetch;
    const updateRoutes = (await import('./update.js')).default;
    const app = new Hono().route('/api', updateRoutes);
    const res = await app.request('/api/version');
    const body = (await res.json()) as { latest: string | null; updateAvailable: boolean };
    expect(body.latest).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test dashboard/routes/update.test.ts`
Expected: FAIL — `./update.js` not found.

- [ ] **Step 3: Implement route**

`dashboard/routes/update.ts`:

```ts
import { Hono } from 'hono';
import { getCurrentVersion, fetchLatestVersion, isUpdateAvailable } from '../../lib/updater.js';

const updateRoutes = new Hono();

updateRoutes.get('/version', async (c) => {
  const force = c.req.query('refresh') === '1';
  const current = getCurrentVersion();
  const latest = await fetchLatestVersion({ force });
  return c.json({
    current,
    latest: latest?.version ?? null,
    publishedAt: latest?.publishedAt ?? null,
    updateAvailable: latest ? isUpdateAvailable(current, latest.version) : false,
    checkedAt: latest ? new Date().toISOString() : null,
  });
});

export default updateRoutes;
```

- [ ] **Step 4: Wire into `dashboard/server.ts`**

Add import:

```ts
import updateRoutes from './routes/update.js';
```

And register after the existing routes:

```ts
app.route('/api', updateRoutes);
```

- [ ] **Step 5: Run tests, verify pass**

Run: `bun test dashboard/routes/update.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard/routes/update.ts dashboard/routes/update.test.ts dashboard/server.ts
git commit -m "feat(dashboard): GET /api/version"
```

---

## Task 7: `POST /api/update` + SSE log stream

**Files:**

- Modify: `dashboard/routes/update.ts`
- Modify: `dashboard/routes/update.test.ts`

- [ ] **Step 1: Add failing test**

Append to `dashboard/routes/update.test.ts`:

```ts
describe('POST /api/update + SSE stream', () => {
  it('creates a job and streams a fake install to completion', async () => {
    const updaterMod = await import('../../lib/updater.js');
    updaterMod.__setSpawnerForTests((cmd, args) => {
      // Reuse the same fake shape from updater.test.ts
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emitter = {
        stdout: { on: (e: string, cb: (b: Buffer) => void) => (listeners['out-' + e] = [cb]) },
        stderr: { on: () => {} },
        on: (e: string, cb: (code: number) => void) => {
          if (e === 'close') setTimeout(() => cb(0), 10);
          return emitter;
        },
      };
      setTimeout(() => listeners['out-data']?.[0](Buffer.from('hello\n')), 2);
      return emitter as unknown as ReturnType<typeof updaterMod.__setSpawnerForTests>;
    });
    // Make stopMonitorIfRunning a no-op for test
    process.env.HOME = process.env.HOME ?? '/tmp';

    const updateRoutes = (await import('./update.js')).default;
    const app = new Hono().route('/api', updateRoutes);

    const post = await app.request('/api/update', { method: 'POST' });
    expect(post.status).toBe(200);
    const { jobId } = (await post.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    const stream = await app.request(`/api/update/${jobId}/stream`);
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
      if (chunks.join('').includes('event: done')) break;
    }
    const text = chunks.join('');
    expect(text).toContain('event: log');
    expect(text).toContain('hello');
    expect(text).toContain('event: done');
    updaterMod.__setSpawnerForTests(null);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test dashboard/routes/update.test.ts`
Expected: FAIL — `/api/update` route 404.

- [ ] **Step 3: Implement job + SSE**

Append to `dashboard/routes/update.ts`:

```ts
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'crypto';
import { runUpdate, stopMonitorIfRunning } from '../../lib/updater.js';
import { markNotifiedVersion } from '../../lib/update-cache.js';

type JobState =
  | { status: 'running'; logs: string[]; subscribers: Set<(line: string) => void> }
  | { status: 'done'; logs: string[]; subscribers: Set<(line: string) => void> }
  | { status: 'error'; logs: string[]; subscribers: Set<(line: string) => void>; error: string };

const jobs = new Map<string, JobState>();

function pushLog(job: JobState, line: string) {
  job.logs.push(line);
  for (const cb of job.subscribers) cb(line);
}

updateRoutes.post('/update', async (c) => {
  const jobId = randomUUID();
  const job: JobState = { status: 'running', logs: [], subscribers: new Set() };
  jobs.set(jobId, job);

  // Run async; route returns immediately so the client can subscribe to the SSE.
  (async () => {
    try {
      await stopMonitorIfRunning();
      await runUpdate({ onLog: (line) => pushLog(job, line) });
      const done: JobState = { status: 'done', logs: job.logs, subscribers: job.subscribers };
      jobs.set(jobId, done);
      pushLog(done, '__DONE__');
      // Defer self-exit so the SSE has time to flush 'done' to the client.
      setTimeout(() => process.exit(0), 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errJob: JobState = {
        status: 'error',
        logs: job.logs,
        subscribers: job.subscribers,
        error: message,
      };
      jobs.set(jobId, errJob);
      pushLog(errJob, '__ERROR__' + message);
    }
  })();

  return c.json({ jobId });
});

updateRoutes.get('/update/:jobId/stream', (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return c.text('job not found', 404);
  return streamSSE(c, async (stream) => {
    for (const line of job.logs) {
      if (line.startsWith('__DONE__')) {
        await stream.writeSSE({ event: 'done', data: '' });
        return;
      }
      if (line.startsWith('__ERROR__')) {
        await stream.writeSSE({ event: 'error', data: line.slice('__ERROR__'.length) });
        return;
      }
      await stream.writeSSE({ event: 'log', data: line });
    }
    if (job.status !== 'running') {
      await stream.writeSSE({
        event: job.status === 'done' ? 'done' : 'error',
        data: job.status === 'error' ? job.error : '',
      });
      return;
    }
    await new Promise<void>((resolve) => {
      const cb = async (line: string) => {
        if (line.startsWith('__DONE__')) {
          await stream.writeSSE({ event: 'done', data: '' });
          job.subscribers.delete(cb);
          resolve();
          return;
        }
        if (line.startsWith('__ERROR__')) {
          await stream.writeSSE({ event: 'error', data: line.slice('__ERROR__'.length) });
          job.subscribers.delete(cb);
          resolve();
          return;
        }
        await stream.writeSSE({ event: 'log', data: line });
      };
      job.subscribers.add(cb);
    });
  });
});

updateRoutes.post('/update/dismiss', async (c) => {
  const { version } = (await c.req.json().catch(() => ({}))) as { version?: string };
  if (!version) return c.json({ ok: false, error: 'version required' }, 400);
  markNotifiedVersion(version);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run, verify pass**

Run: `bun test dashboard/routes/update.test.ts`
Expected: PASS (3 tests). Note: the test should NOT actually call process.exit — confirm by setting `process.exit` to a spy before the request, or skip the timer-driven self-exit in test by checking `process.env.NODE_ENV === 'test'`. Add this guard inside the success branch:

```ts
if (process.env.NODE_ENV !== 'test') setTimeout(() => process.exit(0), 500);
```

And update the test to set `process.env.NODE_ENV = 'test'` in its `beforeEach`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/update.ts dashboard/routes/update.test.ts
git commit -m "feat(dashboard): POST /api/update + SSE stream + dismiss"
```

---

## Task 8: `/api/desktop-version` route

**Files:**

- Create: `dashboard/routes/desktop-version.ts`
- Create: `dashboard/routes/desktop-version.test.ts`
- Modify: `dashboard/server.ts`

- [ ] **Step 1: Write failing test**

`dashboard/routes/desktop-version.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

beforeEach(async () => {
  const mod = await import('../../lib/desktop-version.js');
  mod.__resetCacheForTests();
});

describe('GET /api/desktop-version', () => {
  it('returns updateAvailable=true when latest > current', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v1.0.3',
          html_url: 'https://x/y',
          published_at: '2026-05-20T00:00:00Z',
          assets: [{ name: 'Clocktopus_1.0.3.dmg', browser_download_url: 'https://x/dmg' }],
        }),
        { status: 200 },
      )) as typeof fetch;
    const routes = (await import('./desktop-version.js')).default;
    const app = new Hono().route('/api', routes);
    const res = await app.request('/api/desktop-version?currentDesktopVersion=1.0.2');
    const body = (await res.json()) as {
      current: string;
      latest: string;
      updateAvailable: boolean;
      downloadUrl: string;
      htmlUrl: string;
    };
    expect(body.current).toBe('1.0.2');
    expect(body.latest).toBe('1.0.3');
    expect(body.updateAvailable).toBe(true);
    expect(body.downloadUrl).toBe('https://x/dmg');
  });

  it('returns latest=null on GitHub 5xx', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 503 })) as typeof fetch;
    const routes = (await import('./desktop-version.js')).default;
    const app = new Hono().route('/api', routes);
    const res = await app.request('/api/desktop-version?currentDesktopVersion=1.0.2');
    const body = (await res.json()) as { latest: string | null };
    expect(body.latest).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test dashboard/routes/desktop-version.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`dashboard/routes/desktop-version.ts`:

```ts
import { Hono } from 'hono';
import { fetchLatestDesktopRelease } from '../../lib/desktop-version.js';
import { isUpdateAvailable } from '../../lib/updater.js';

const desktopVersionRoutes = new Hono();

desktopVersionRoutes.get('/desktop-version', async (c) => {
  const force = c.req.query('refresh') === '1';
  const current = c.req.query('currentDesktopVersion') ?? '0.0.0';
  const latest = await fetchLatestDesktopRelease({ force });
  return c.json({
    current,
    latest: latest?.version ?? null,
    publishedAt: latest?.publishedAt ?? null,
    htmlUrl: latest?.htmlUrl ?? null,
    downloadUrl: latest?.downloadUrl ?? null,
    updateAvailable: latest ? isUpdateAvailable(current, latest.version) : false,
    checkedAt: latest ? new Date().toISOString() : null,
  });
});

export default desktopVersionRoutes;
```

- [ ] **Step 4: Register in `dashboard/server.ts`**

```ts
import desktopVersionRoutes from './routes/desktop-version.js';
// ...
app.route('/api', desktopVersionRoutes);
```

- [ ] **Step 5: Run, verify pass**

Run: `bun test dashboard/routes/desktop-version.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard/routes/desktop-version.ts dashboard/routes/desktop-version.test.ts dashboard/server.ts
git commit -m "feat(dashboard): GET /api/desktop-version"
```

---

## Task 9: Update settings GET/PUT

**Files:**

- Modify: `dashboard/routes/settings.ts`

- [ ] **Step 1: Inspect existing settings route**

Run: `cat dashboard/routes/settings.ts`
Look for the pattern used to expose other settings (e.g. EOD reminder).

- [ ] **Step 2: Add update settings routes**

Append inside the same `settingsRoutes` Hono instance:

```ts
import { getUpdateSettings, setUpdateSettings } from '../../lib/settings.js';

settingsRoutes.get('/settings/updates', (c) => c.json(getUpdateSettings()));

settingsRoutes.put('/settings/updates', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { autoCheck?: boolean; notify?: boolean };
  const current = getUpdateSettings();
  setUpdateSettings({
    autoCheck: typeof body.autoCheck === 'boolean' ? body.autoCheck : current.autoCheck,
    notify: typeof body.notify === 'boolean' ? body.notify : current.notify,
  });
  return c.json(getUpdateSettings());
});
```

- [ ] **Step 3: Smoke test manually**

```bash
bun run build && bun run clock dash &
sleep 2
curl -s http://localhost:4001/api/settings/updates
curl -sX PUT http://localhost:4001/api/settings/updates -H 'Content-Type: application/json' -d '{"autoCheck":false}'
curl -s http://localhost:4001/api/settings/updates
kill %1
```

Expected first GET: `{"autoCheck":true,"notify":true}`.
PUT and follow-up GET: `{"autoCheck":false,"notify":true}`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/routes/settings.ts
git commit -m "feat(dashboard): update settings GET/PUT"
```

---

## Task 10: CLI `clocktopus update` subcommand

**Files:**

- Modify: `index.ts`

- [ ] **Step 1: Add the subcommand**

Insert before the `monitor` command (around line 572) in `index.ts`:

```ts
program
  .command('update')
  .description('Check for and install a newer clocktopus npm release.')
  .option('--yes', 'Install without prompting.', false)
  .option('--check', 'Only print current + latest, do not install.', false)
  .action(async (opts: { yes: boolean; check: boolean }) => {
    const { getCurrentVersion, fetchLatestVersion, isUpdateAvailable, runUpdate, stopMonitorIfRunning } = await import(
      './lib/updater.js'
    );
    const current = getCurrentVersion();
    process.stdout.write(`Current: ${current}\n`);
    const latest = await fetchLatestVersion({ force: true });
    if (!latest) {
      console.error(chalk.red('Could not reach the npm registry.'));
      process.exit(1);
    }
    process.stdout.write(`Latest:  ${latest.version}\n`);
    if (!isUpdateAvailable(current, latest.version)) {
      console.log(chalk.green('Already up to date.'));
      return;
    }
    if (opts.check) return;
    if (!opts.yes) {
      const { simplePrompt } = await import('./lib/simple-prompt.js');
      const answer = await simplePrompt(`Install clocktopus ${latest.version}? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Cancelled.');
        return;
      }
    }
    console.log(chalk.blue('Stopping monitor (if running)…'));
    await stopMonitorIfRunning();
    console.log(chalk.blue('Installing…'));
    try {
      await runUpdate({ onLog: (line) => process.stdout.write(line + '\n') });
    } catch (err) {
      console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
    console.log(chalk.green(`Updated to ${latest.version}. Restart monitor with: mrestart`));
  });
```

- [ ] **Step 2: Confirm `simplePrompt` signature**

Run: `grep -n "export" lib/simple-prompt.ts`
If the export name differs, adjust the import in the step above.

- [ ] **Step 3: Build + smoke test**

```bash
bun run build
bun run clock update --check
```

Expected output:

```
Current: 1.12.3
Latest:  <whatever-latest-is>
```

(Or `Could not reach the npm registry.` if offline.)

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat(cli): add clocktopus update subcommand"
```

---

## Task 11: Periodic checker in monitor daemon

**Files:**

- Modify: `index.ts` (inside `monitor:run` action)

- [ ] **Step 1: Add the checker function**

At the top of `index.ts`, near other imports, add:

```ts
import { getUpdateSettings } from './lib/settings.js';
import { getUpdateCache, setUpdateCache, markNotifiedVersion } from './lib/update-cache.js';
import { notify } from './lib/notifier.js';
```

(Skip any that are already imported.)

Inside the `monitor:run` action body, after the `closeStaleOpenSessions` block and before the `stopTimerAndLog` definition (around line 263), insert:

```ts
async function runUpdateCheck() {
  const settings = getUpdateSettings();
  if (!settings.autoCheck) return;
  const { getCurrentVersion, fetchLatestVersion, isUpdateAvailable } = await import('./lib/updater.js');
  const latest = await fetchLatestVersion({ force: true });
  if (!latest) return;
  setUpdateCache({
    latestVersion: latest.version,
    publishedAt: latest.publishedAt,
    checkedAt: new Date().toISOString(),
  });
  const current = getCurrentVersion();
  if (!isUpdateAvailable(current, latest.version)) return;
  if (!settings.notify) return;
  const cache = getUpdateCache();
  if (cache?.notifiedVersion === latest.version) return;
  notify({
    subtitle: 'Update available',
    message: `Clocktopus ${latest.version} available — open dashboard to update`,
    sound: false,
    wait: false,
    timeout: 8,
  });
  markNotifiedVersion(latest.version);
}

// Fire once on boot, then every 6 hours.
runUpdateCheck().catch((err) => console.error(chalk.red('Update check failed:'), err));
const updateCheckInterval = setInterval(
  () => {
    runUpdateCheck().catch((err) => console.error(chalk.red('Update check failed:'), err));
  },
  6 * 60 * 60 * 1000,
);
process.on('SIGTERM', () => clearInterval(updateCheckInterval));
process.on('SIGINT', () => clearInterval(updateCheckInterval));
```

- [ ] **Step 2: Build, restart monitor, observe logs**

```bash
bun run build
bun run monitor:stop || true
bun run monitor
sleep 3
bun run monitor:logs --lines 20
```

Expected: no errors. The check runs once; if a newer version exists, `update_check` row is populated.

To verify the row:

```bash
bunx --bun sqlite3 data/db/sessions.db 'SELECT * FROM update_check'
```

(Use whichever sqlite CLI you have; the DB path is `data/db/sessions.db` in dev.)

- [ ] **Step 3: Commit**

```bash
git add index.ts
git commit -m "feat(monitor): periodic update check + OS notification"
```

---

## Task 12: Extract Tauri install helper

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Read the existing `install_clocktopus`**

Lines 204-229 in `desktop/src-tauri/src/lib.rs`. Note the PATH injection logic.

- [ ] **Step 2: Extract into a private helper**

Replace the body of `install_clocktopus` and add a private helper above it:

```rust
fn run_bun_install_clocktopus(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let bun = first_matching(&bun_candidates(&home), |p| std::path::Path::new(p).exists())
        .ok_or_else(|| "bun not found".to_string())?;
    let bun_bin = format!("{home}/.bun/bin");
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{bun_bin}:{current_path}");

    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    let mut child = std::process::Command::new(&bun)
        .args(["i", "-g", "clocktopus", "--trust"])
        .env("PATH", new_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch bun: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.cloned();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                if let Some(a) = &app_clone {
                    let _ = a.emit("update://log", line);
                }
            }
        });
    }
    let mut stderr_buf = String::new();
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().flatten() {
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
            if let Some(a) = app {
                let _ = a.emit("update://log", line);
            }
        }
    }
    let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("clocktopus install failed: {}", stderr_buf.trim()))
    }
}

#[tauri::command]
fn install_clocktopus() -> Result<(), String> {
    run_bun_install_clocktopus(None)
}
```

Add `use tauri::Emitter;` near the top of the file alongside other `use` statements (the `emit` method requires this trait in Tauri 2).

- [ ] **Step 3: Build the Tauri app**

```bash
cd desktop && bunx tauri build --debug
```

Expected: build succeeds with no warnings about unused imports. Existing `install_clocktopus` invocation from the Setup UI still works.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "refactor(desktop): extract run_bun_install_clocktopus helper"
```

---

## Task 13: Tauri `update_clocktopus` command

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the command**

In `desktop/src-tauri/src/lib.rs`, alongside `install_clocktopus`:

```rust
#[tauri::command]
fn update_clocktopus(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerChild>,
) -> Result<(), String> {
    kill_server_child(&state);
    kill_server_by_port();
    run_bun_install_clocktopus(Some(&app))?;
    spawn_server(&state);
    Ok(())
}
```

Register in the existing `tauri::generate_handler!` macro call (around line 290):

```rust
.invoke_handler(tauri::generate_handler![
    start_server,
    stop_server,
    check_server,
    check_bun_installed,
    install_bun,
    check_clocktopus_installed,
    install_clocktopus,
    update_clocktopus,
])
```

- [ ] **Step 2: Allow it in the capabilities file**

Open `desktop/src-tauri/capabilities/default.json`. Find the `permissions` array. Add an entry shaped like the existing `install_clocktopus` allowance — for example:

```json
{ "identifier": "core:default" },
{ "identifier": "core:webview:default" },
"app:allow-app-emit"
```

If `install_clocktopus` is already covered by a generic command allow, no change needed. The exact entry depends on the file's current shape; if the file uses an inline allowlist of command names, add `"update_clocktopus"`.

- [ ] **Step 3: Build, smoke test from the webview**

```bash
cd desktop && bunx tauri dev
```

In the Tauri webview devtools console:

```js
await window.__TAURI__.core.invoke('update_clocktopus');
```

Expected: server is killed, install runs (stdout streamed via `update://log` event — subscribe to verify), server respawns. If you just want to confirm wiring without re-installing, replace the inner call with a placeholder that emits one log line.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/lib.rs desktop/src-tauri/capabilities/default.json
git commit -m "feat(desktop): update_clocktopus command"
```

---

## Task 14: Tauri `download_desktop_update` command

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Add `reqwest` if not present**

In `desktop/src-tauri/Cargo.toml`, under `[dependencies]`, ensure:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
futures-util = "0.3"
```

(Skip whichever already exists.)

- [ ] **Step 2: Add the command**

In `desktop/src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn download_desktop_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let home = std::env::var("HOME").unwrap_or_default();
    let downloads = std::path::PathBuf::from(home).join("Downloads");
    if !downloads.exists() {
        std::fs::create_dir_all(&downloads).map_err(|e| format!("mkdir Downloads: {e}"))?;
    }
    // Filename = last URL segment, defaulting to clocktopus.dmg.
    let filename = url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("clocktopus.dmg")
        .to_string();
    let dest = downloads.join(&filename);
    let tmp = downloads.join(format!("{filename}.partial"));

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("read chunk: {e}")
        })?;
        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("write chunk: {e}")
        })?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "desktop-update://progress",
            serde_json::json!({ "downloaded": downloaded, "total": total }),
        );
    }
    drop(file);
    std::fs::rename(&tmp, &dest).map_err(|e| format!("rename: {e}"))?;

    // Reveal in Finder.
    let _ = std::process::Command::new("open").args(["-R", dest.to_str().unwrap_or("")]).spawn();

    Ok(dest.to_string_lossy().into_owned())
}
```

Register in `generate_handler!` alongside the others.

- [ ] **Step 3: Capability allow**

Same file as Task 13. Add `"download_desktop_update"` to the allow-list if your capabilities use an explicit list.

- [ ] **Step 4: Build + smoke test**

```bash
cd desktop && bunx tauri dev
```

In webview devtools:

```js
const path = await window.__TAURI__.core.invoke('download_desktop_update', {
  url: 'https://github.com/pagevamp/clocktopus/releases/latest/download/Clocktopus.dmg',
});
console.log(path);
```

Expected: a Finder window pops up with the downloaded `.dmg` selected. Console prints the absolute path. (If the latest release doesn't have a `Clocktopus.dmg` exact name, use a known asset URL from the Releases page.)

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/src/lib.rs desktop/src-tauri/capabilities/default.json
git commit -m "feat(desktop): download_desktop_update command"
```

---

## Task 15: Dashboard "About" sub-tab

**Files:**

- Modify: `dashboard/views.ts`

- [ ] **Step 1: Add the sub-tab button**

In `dashboard/views.ts` around line 388 (the `track-tabs` row inside the Settings tab), add a new button:

```html
<button class="track-tab-btn" data-section="about" onclick="switchSettingsSection('about')">About</button>
```

- [ ] **Step 2: Add the About section markup**

After the existing `settings-git` section, add:

```html
<div id="settings-about" class="settings-section" style="display:none;">
  <div class="cards">
    <div class="card">
      <div class="card-header">
        <div class="dot gray" id="about-dot"></div>
        <h2>About</h2>
      </div>

      <div class="about-row" id="about-cli-row">
        <div>
          <strong>Clocktopus CLI</strong>
          <div class="muted"><span id="about-cli-current">…</span></div>
        </div>
        <div>
          <span id="about-cli-badge" style="display:none;" class="badge"></span>
          <button id="about-cli-check" onclick="checkCliUpdate()">Check for updates</button>
          <button id="about-cli-update" onclick="startCliUpdate()" style="display:none;">Update</button>
        </div>
      </div>

      <div class="about-row" id="about-desktop-row" style="display:none;">
        <div>
          <strong>Desktop app</strong>
          <div class="muted"><span id="about-desktop-current">…</span></div>
        </div>
        <div>
          <span id="about-desktop-badge" style="display:none;" class="badge"></span>
          <button id="about-desktop-check" onclick="checkDesktopUpdate()">Check for updates</button>
          <button id="about-desktop-update" onclick="startDesktopDownload()" style="display:none;">Download</button>
          <a id="about-desktop-notes" href="#" target="_blank" style="display:none;margin-left:0.5rem;"
            >Release notes</a
          >
        </div>
      </div>

      <div style="margin-top:1rem;">
        <label class="toggle-row">
          <input type="checkbox" id="updates-autocheck" onchange="saveUpdateSettings()" />
          Check for updates automatically
        </label>
        <label class="toggle-row">
          <input type="checkbox" id="updates-notify" onchange="saveUpdateSettings()" />
          Notify when an update is available
        </label>
      </div>
    </div>
  </div>
</div>

<div id="update-modal" class="modal" style="display:none;">
  <div class="modal-body">
    <h3 id="update-modal-title">Updating…</h3>
    <pre
      id="update-modal-log"
      style="max-height:200px;overflow:auto;font-family:ui-monospace,monospace;font-size:0.75rem;"
    ></pre>
    <div id="update-modal-progress" style="display:none;">
      <progress id="update-modal-progress-bar" value="0" max="100"></progress>
      <span id="update-modal-progress-label"></span>
    </div>
    <div id="update-modal-actions">
      <button id="update-modal-close" onclick="closeUpdateModal()" style="display:none;">Close</button>
      <button id="update-modal-retry" onclick="retryUpdate()" style="display:none;">Retry</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add the matching JS handlers**

Inside the page's script block (search for an existing handler like `saveJira` and add nearby):

```js
let pendingRetry = null;

async function checkCliUpdate() {
  document.getElementById('about-cli-check').disabled = true;
  const res = await fetch('/api/version?refresh=1');
  const v = await res.json();
  document.getElementById('about-cli-current').textContent = v.current;
  const badge = document.getElementById('about-cli-badge');
  const updateBtn = document.getElementById('about-cli-update');
  if (v.updateAvailable) {
    badge.textContent = `${v.latest} available`;
    badge.style.display = 'inline-block';
    updateBtn.style.display = 'inline-block';
    updateBtn.dataset.version = v.latest;
  } else if (v.latest) {
    badge.textContent = 'Up to date';
    badge.style.display = 'inline-block';
    updateBtn.style.display = 'none';
  } else {
    badge.textContent = "Couldn't reach registry";
    badge.style.display = 'inline-block';
    updateBtn.style.display = 'none';
  }
  document.getElementById('about-cli-check').disabled = false;
}

async function startCliUpdate() {
  openUpdateModal(`Updating CLI…`);
  pendingRetry = startCliUpdate;
  const isTauri = !!window.__TAURI__;
  if (isTauri) {
    const unlisten = await window.__TAURI__.event.listen('update://log', (e) => {
      appendUpdateLog(e.payload);
    });
    try {
      await window.__TAURI__.core.invoke('update_clocktopus');
      finishUpdateModal({ ok: true, message: 'Updated. Reloading…' });
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      finishUpdateModal({ ok: false, message: String(err) });
    } finally {
      unlisten();
    }
    return;
  }
  // Browser / CLI dashboard path
  const resp = await fetch('/api/update', { method: 'POST' });
  const { jobId } = await resp.json();
  const evt = new EventSource(`/api/update/${jobId}/stream`);
  evt.addEventListener('log', (e) => appendUpdateLog(e.data));
  evt.addEventListener('done', () => {
    evt.close();
    finishUpdateModal({ ok: true, message: 'Updated. Reloading…' });
    setTimeout(() => location.reload(), 1500);
  });
  evt.addEventListener('error', (e) => {
    evt.close();
    finishUpdateModal({ ok: false, message: e.data || 'Update failed' });
  });
}

async function checkDesktopUpdate() {
  if (!window.__TAURI__) return;
  document.getElementById('about-desktop-check').disabled = true;
  const { getVersion } = window.__TAURI__.app;
  const current = await getVersion();
  const res = await fetch(`/api/desktop-version?refresh=1&currentDesktopVersion=${encodeURIComponent(current)}`);
  const v = await res.json();
  document.getElementById('about-desktop-current').textContent = current;
  const badge = document.getElementById('about-desktop-badge');
  const updateBtn = document.getElementById('about-desktop-update');
  const notes = document.getElementById('about-desktop-notes');
  if (v.updateAvailable) {
    badge.textContent = `${v.latest} available`;
    badge.style.display = 'inline-block';
    if (v.downloadUrl) {
      updateBtn.style.display = 'inline-block';
      updateBtn.dataset.url = v.downloadUrl;
    } else {
      updateBtn.style.display = 'none';
    }
    if (v.htmlUrl) {
      notes.href = v.htmlUrl;
      notes.style.display = 'inline';
    }
  } else if (v.latest) {
    badge.textContent = 'Up to date';
    badge.style.display = 'inline-block';
    updateBtn.style.display = 'none';
    notes.style.display = 'none';
  } else {
    badge.textContent = "Couldn't reach GitHub";
    badge.style.display = 'inline-block';
  }
  document.getElementById('about-desktop-check').disabled = false;
}

async function startDesktopDownload() {
  const url = document.getElementById('about-desktop-update').dataset.url;
  if (!url) return;
  openUpdateModal('Downloading…');
  pendingRetry = startDesktopDownload;
  document.getElementById('update-modal-progress').style.display = 'block';
  const unlisten = await window.__TAURI__.event.listen('desktop-update://progress', (e) => {
    const { downloaded, total } = e.payload;
    const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    document.getElementById('update-modal-progress-bar').value = pct;
    document.getElementById('update-modal-progress-label').textContent =
      total > 0 ? `${pct}%` : `${(downloaded / 1024 / 1024).toFixed(1)} MB`;
  });
  try {
    const path = await window.__TAURI__.core.invoke('download_desktop_update', { url });
    finishUpdateModal({
      ok: true,
      message: `Saved to ${path} — opened in Finder. Drag Clocktopus to Applications to finish updating.`,
    });
  } catch (err) {
    finishUpdateModal({ ok: false, message: String(err) });
  } finally {
    unlisten();
  }
}

function openUpdateModal(title) {
  document.getElementById('update-modal-title').textContent = title;
  document.getElementById('update-modal-log').textContent = '';
  document.getElementById('update-modal-progress').style.display = 'none';
  document.getElementById('update-modal-close').style.display = 'none';
  document.getElementById('update-modal-retry').style.display = 'none';
  document.getElementById('update-modal').style.display = 'flex';
}

function appendUpdateLog(line) {
  const el = document.getElementById('update-modal-log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

function finishUpdateModal({ ok, message }) {
  document.getElementById('update-modal-title').textContent = ok ? '✅ Done' : '❌ Failed';
  appendUpdateLog(message);
  document.getElementById('update-modal-close').style.display = 'inline-block';
  if (!ok) document.getElementById('update-modal-retry').style.display = 'inline-block';
}

function closeUpdateModal() {
  document.getElementById('update-modal').style.display = 'none';
}

function retryUpdate() {
  closeUpdateModal();
  if (pendingRetry) pendingRetry();
}

async function loadUpdateSettings() {
  const res = await fetch('/api/settings/updates');
  const s = await res.json();
  document.getElementById('updates-autocheck').checked = s.autoCheck;
  document.getElementById('updates-notify').checked = s.notify;
}

async function saveUpdateSettings() {
  const body = {
    autoCheck: document.getElementById('updates-autocheck').checked,
    notify: document.getElementById('updates-notify').checked,
  };
  await fetch('/api/settings/updates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function initAboutSection() {
  await checkCliUpdate();
  await loadUpdateSettings();
  if (window.__TAURI__) {
    document.getElementById('about-desktop-row').style.display = 'flex';
    await checkDesktopUpdate();
  }
}
```

Hook `initAboutSection()` into the page's existing initialization (look for a `DOMContentLoaded` listener or an `init()` block — call from there).

- [ ] **Step 4: Minimal CSS for the new elements**

Inside the existing `<style>` block:

```css
.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.about-row:last-child {
  border-bottom: none;
}
.badge {
  background: rgba(210, 153, 34, 0.2);
  color: #d29922;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  margin-right: 0.5rem;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.3rem 0;
  font-size: 0.85rem;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-body {
  background: var(--card-bg, #1a1d23);
  padding: 1.5rem;
  border-radius: 8px;
  min-width: 420px;
  max-width: 600px;
}
```

(Adjust `--card-bg` to whatever variable the existing cards use.)

- [ ] **Step 5: Smoke test in browser**

```bash
bun run build && bun run clock dash &
open http://localhost:4001
```

- Navigate to Settings → About.
- Confirm CLI row renders, click "Check for updates", confirm badge updates.
- Toggle the two checkboxes, refresh, confirm state persists.
- Close dashboard: `kill %1`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/views.ts
git commit -m "feat(dashboard): Settings About tab with update controls"
```

---

## Task 16: Dashboard fallback poller

**Files:**

- Modify: `dashboard/server.ts`

- [ ] **Step 1: Add an in-process poller**

Modify `dashboard/server.ts` to run the same check the monitor runs, but only if the monitor isn't expected to. Simplest: always run it from the dashboard too — both writers target the same row and last-write-wins is fine.

Replace the existing `startDashboard` function with:

```ts
export function startDashboard() {
  console.log(`Clocktopus dashboard running at http://localhost:${DASHBOARD_PORT}`);
  serve({ fetch: app.fetch, port: DASHBOARD_PORT });

  // Periodic update check (6h). Mirror what monitor:run does so users who only
  // run the dashboard still get a populated update_check cache.
  (async () => {
    const { getCurrentVersion, fetchLatestVersion, isUpdateAvailable } = await import('../lib/updater.js');
    const { getUpdateSettings } = await import('../lib/settings.js');
    const { setUpdateCache, getUpdateCache, markNotifiedVersion } = await import('../lib/update-cache.js');
    async function run() {
      const settings = getUpdateSettings();
      if (!settings.autoCheck) return;
      const latest = await fetchLatestVersion({ force: true });
      if (!latest) return;
      setUpdateCache({
        latestVersion: latest.version,
        publishedAt: latest.publishedAt,
        checkedAt: new Date().toISOString(),
      });
      const current = getCurrentVersion();
      if (!isUpdateAvailable(current, latest.version)) return;
      if (!settings.notify) return;
      const cache = getUpdateCache();
      if (cache?.notifiedVersion === latest.version) return;
      const { notify } = await import('../lib/notifier.js');
      notify({
        subtitle: 'Update available',
        message: `Clocktopus ${latest.version} available — open dashboard to update`,
        sound: false,
        wait: false,
        timeout: 8,
      });
      markNotifiedVersion(latest.version);
    }
    run().catch((err) => console.error('Update check failed:', err));
    setInterval(() => run().catch((err) => console.error('Update check failed:', err)), 6 * 60 * 60 * 1000);
  })();
}
```

- [ ] **Step 2: Build, start dashboard, verify no errors**

```bash
bun run build && bun run clock dash &
sleep 4
curl -s http://localhost:4001/api/version
kill %1
```

Expected: dashboard logs no errors; the cached row gets populated.

- [ ] **Step 3: Commit**

```bash
git add dashboard/server.ts
git commit -m "feat(dashboard): periodic update check fallback"
```

---

## Task 17: Tauri tray indicator

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`
- Create: `desktop/src-tauri/icons/tray-update.png`

Note: this assumes the project already has a tray icon and menu. If not, that's out of scope — skip this task and create a follow-up issue.

- [ ] **Step 1: Inspect the existing tray code**

Run: `grep -n "tray\|TrayIcon\|MenuItem" desktop/src-tauri/src/lib.rs`

If no tray exists, stop here and add a note in the spec follow-up. If a tray exists, continue.

- [ ] **Step 2: Add the badge variant icon**

Copy the existing tray icon to `tray-update.png` and add an orange dot in the bottom-right using your image editor (or use ImageMagick):

```bash
cd desktop/src-tauri/icons
cp tray.png tray-update.png
# Edit tray-update.png to add the dot (manual step).
```

- [ ] **Step 3: Add a polling task in the Tauri setup**

Inside the `tauri::Builder` `.setup(|app| { ... })` block in `run()`, add a tokio task that polls `/api/version` and `/api/desktop-version` every 6h and updates the tray. Pseudo-shape:

```rust
let handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    loop {
        let dash_url = dashboard_url();
        let cli_avail = reqwest::get(format!("{dash_url}/api/version"))
            .await
            .ok()
            .and_then(|r| futures::executor::block_on(r.json::<serde_json::Value>()).ok())
            .and_then(|v| v.get("updateAvailable").and_then(|b| b.as_bool()))
            .unwrap_or(false);
        // similar for /api/desktop-version with currentDesktopVersion query
        let _ = update_tray_for_status(&handle, cli_avail, /* desktop_avail */ false);
        tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
    }
});
```

Implement `update_tray_for_status` to swap the icon to `tray-update.png` when either is true. Concrete implementation depends on the project's existing tray builder.

- [ ] **Step 4: Build and verify**

```bash
cd desktop && bunx tauri dev
```

Manually bump `desktop/src-tauri/tauri.conf.json` version below the latest GitHub release and confirm the tray badge appears within a minute (shortened poll for the test, then revert).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/icons/tray-update.png desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): tray badge when update available"
```

---

## Task 18: Final verification + PR

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
bun run build
cd desktop && bunx tauri build --debug && cd ..
```

Expected: both builds succeed.

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feat/self-update
gh pr create --title "feat: in-app self-update for CLI and desktop" --body "Implements docs/superpowers/specs/2026-05-28-self-update-design.md. Adds Settings → About card with CLI npm self-update (via bun i -g clocktopus --trust) and desktop .dmg download from GitHub Releases. Monitor daemon polls every 6h and fires an OS notification; dashboard polls as fallback; Tauri webview drives tray indicator and Rust commands."
```

---

## Self-review notes

- **Spec coverage:** Each spec section is implemented:
  - `lib/updater.ts` API (§Components) → Tasks 3-4.
  - `lib/update-cache.ts` (§Components) → Task 2.
  - `/api/version`, `/api/update`, SSE, dismiss (§Components) → Tasks 6-7.
  - `/api/desktop-version` (§Desktop) → Task 8.
  - CLI subcommand (§Components) → Task 10.
  - Tauri `update_clocktopus` + helper (§Components) → Tasks 12-13.
  - Tauri `download_desktop_update` (§Desktop) → Task 14.
  - Dashboard UI About section + modal (§Components, §Desktop) → Task 15.
  - Periodic checker in monitor (§Periodic checker) → Task 11.
  - Dashboard fallback poller (§Periodic checker) → Task 16.
  - Tray indicator (§Tray indicator) → Task 17.
  - Settings toggles + route (§Settings) → Tasks 1, 9.
  - Error handling rows are covered implicitly by route responses + UI branches.
- **No placeholders:** every code-touching step shows the code. The capabilities-file step (Task 13/14) explicitly says "depends on the file's current shape" — that's a real inspection step, not a placeholder; the engineer should `cat` the file and add the line in the spot that matches its existing structure.
- **Type consistency:** `getUpdateCache` returns `UpdateCacheRow | null` everywhere; `runUpdate` signature is `{ onLog }` consistently; `fetchLatestVersion` returns `LatestVersion | null`; `fetchLatestDesktopRelease` returns `DesktopRelease | null`. The dashboard JS uses `v.updateAvailable`, `v.latest`, `v.downloadUrl`, `v.htmlUrl` matching the route shapes.
