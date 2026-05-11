import * as path from 'path';

/**
 * True only when running from the clocktopus source repo (e.g. `bun run`
 * during local development). Bun-linked global installs live under
 * `node_modules/` and must NOT be flagged as dev — otherwise PM2 names and
 * data paths pick up the dev variants. Set CLOCKTOPUS_DEV=1 to force on.
 */
export const IS_DEV = (() => {
  const override = process.env.CLOCKTOPUS_DEV;
  if (override != null && override !== '') {
    return override === '1' || override.toLowerCase() === 'true';
  }
  try {
    const scriptDir = path.dirname(new URL(import.meta.url).pathname);
    if (scriptDir.includes('/node_modules/')) return false;
    return scriptDir.includes('/Projects/') || scriptDir.includes('/src/');
  } catch {
    return false;
  }
})();

/**
 * Dashboard HTTP port. Override via CLOCKTOPUS_PORT env var if 4001 is busy.
 *
 * NOTE: OAuth redirect URIs (Atlassian, Google) are registered with the
 * provider at port 4001. Changing this port breaks OAuth unless the redirect
 * URI is re-registered with the provider as well.
 */
export const DASHBOARD_PORT = (() => {
  const raw = process.env.CLOCKTOPUS_PORT;
  if (!raw) return 4001;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 4001;
})();

export const DASHBOARD_URL = `http://localhost:${DASHBOARD_PORT}`;
