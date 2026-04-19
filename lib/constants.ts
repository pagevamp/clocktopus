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
