import { Hono } from 'hono';
import { fetchLatestDesktopRelease } from '../../lib/desktop-version.js';
import { isUpdateAvailable } from '../../lib/updater.js';

const desktopVersionRoutes = new Hono();

desktopVersionRoutes.get('/desktop-version', async (c) => {
  const force = c.req.query('refresh') === '1';
  const current = c.req.query('currentDesktopVersion') ?? '0.0.0';
  const latest = await fetchLatestDesktopRelease({ force });
  const updateAvailable = latest ? isUpdateAvailable(current, latest.version) : false;
  // GitHub release tag is created before the build workflow uploads the
  // .dmg asset. Surface this so the UI can show "build pending" instead
  // of "available" with no download button.
  const assetPending = updateAvailable && !!latest && !latest.downloadUrl;
  return c.json({
    current,
    latest: latest?.version ?? null,
    publishedAt: latest?.publishedAt ?? null,
    htmlUrl: latest?.htmlUrl ?? null,
    downloadUrl: latest?.downloadUrl ?? null,
    updateAvailable,
    assetPending,
    checkedAt: latest ? new Date().toISOString() : null,
  });
});

export default desktopVersionRoutes;
