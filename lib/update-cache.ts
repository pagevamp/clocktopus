// SQLite-backed single-row cache shared across monitor daemon and dashboard.
// Row id=1 is seeded by lib/db.ts on first open.

import { __dbInternal } from './db.js';

export interface UpdateCacheRow {
  latestVersion: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  notifiedVersion: string | null;
}

export function getUpdateCache(): UpdateCacheRow | null {
  const row = __dbInternal()
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
  __dbInternal()
    .prepare('UPDATE update_check SET latest_version = ?, published_at = ?, checked_at = ? WHERE id = 1')
    .run(input.latestVersion, input.publishedAt, input.checkedAt);
}

export function markNotifiedVersion(version: string) {
  __dbInternal().prepare('UPDATE update_check SET notified_version = ? WHERE id = 1').run(version);
}
