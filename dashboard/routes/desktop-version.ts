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
