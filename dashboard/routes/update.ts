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
