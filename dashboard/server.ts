import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { indexPage } from './views.js';
import { DASHBOARD_PORT } from '../lib/constants.js';
import statusRoutes from './routes/status.js';
import clockifyRoutes from './routes/clockify.js';
import jiraRoutes from './routes/jira.js';
import googleRoutes from './routes/google.js';
import timerRoutes from './routes/timer.js';
import dataRoutes from './routes/data.js';
import monitorRoutes from './routes/monitor.js';
import calendarRoutes from './routes/calendar.js';
import settingsRoutes from './routes/settings.js';
import updateRoutes from './routes/update.js';
import desktopVersionRoutes from './routes/desktop-version.js';

const app = new Hono();

app.use('*', cors());
app.get('/', (c) => c.html(indexPage()));
app.route('/api', statusRoutes);
app.route('/api', clockifyRoutes);
app.route('/api', jiraRoutes);
app.route('/api', googleRoutes);
app.route('/api', timerRoutes);
app.route('/api', dataRoutes);
app.route('/api', monitorRoutes);
app.route('/api', calendarRoutes);
app.route('/api', settingsRoutes);
app.route('/api', updateRoutes);
app.route('/api', desktopVersionRoutes);

export function startDashboard() {
  console.log(`Clocktopus dashboard running at http://localhost:${DASHBOARD_PORT}`);
  serve({ fetch: app.fetch, port: DASHBOARD_PORT });

  // Periodic update check (6h). Mirrors monitor:run's checker so users running
  // just the dashboard (no monitor) still get a populated update_check cache.
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
