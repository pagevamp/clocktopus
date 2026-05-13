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
