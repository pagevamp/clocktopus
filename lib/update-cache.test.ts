import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

const TMP = path.join(import.meta.dir, '__tmp_updcache_test__');

// Isolate this test's DB from the project's real data/db. Must be set BEFORE
// any module that imports lib/db.ts loads, since db.ts resolves DB_DIR at
// import time. Dynamic imports below preserve that ordering.
process.env.CLOCKTOPUS_DATA_DIR = TMP;

let getUpdateCache: typeof import('./update-cache.js').getUpdateCache;
let setUpdateCache: typeof import('./update-cache.js').setUpdateCache;
let markNotifiedVersion: typeof import('./update-cache.js').markNotifiedVersion;
let __dbInternal: typeof import('./db.js').__dbInternal;

beforeAll(async () => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const cache = await import('./update-cache.js');
  const db = await import('./db.js');
  getUpdateCache = cache.getUpdateCache;
  setUpdateCache = cache.setUpdateCache;
  markNotifiedVersion = cache.markNotifiedVersion;
  __dbInternal = db.__dbInternal;
});

beforeEach(() => {
  // Reset the singleton row to its seeded NULL state so each test starts clean.
  __dbInternal()
    .prepare(
      'UPDATE update_check SET latest_version = NULL, published_at = NULL, checked_at = NULL, notified_version = NULL WHERE id = 1',
    )
    .run();
});

describe('update_check cache', () => {
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
    const row = getUpdateCache();
    expect(row?.notifiedVersion).toBe('1.13.0');
    expect(row?.latestVersion).toBe('1.13.0');
  });
});
