import { Hono } from 'hono';
import { getEodSettings, setEodSettings, getHookIgnoreBranches, setHookIgnoreBranches } from '../../lib/settings.js';
import { installHook, uninstallHook, isHookInstalled } from '../../lib/hook-install.js';
import { huskyHookBody } from '../../lib/husky-install.js';

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

settingsRoutes.get('/settings/git', (c) => {
  return c.json({
    installed: isHookInstalled(),
    ignoreBranches: getHookIgnoreBranches(),
    huskyHookBody: huskyHookBody(),
  });
});

settingsRoutes.post('/settings/git/install', async (c) => {
  try {
    await installHook();
    return c.json({ ok: true, installed: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 500);
  }
});

settingsRoutes.post('/settings/git/uninstall', async (c) => {
  try {
    await uninstallHook();
    return c.json({ ok: true, installed: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 500);
  }
});

settingsRoutes.post('/settings/git/ignore-branches', async (c) => {
  let body: { branches?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (!Array.isArray(body.branches) || !body.branches.every((b) => typeof b === 'string')) {
    return c.json({ ok: false, error: 'branches must be string[]' }, 400);
  }
  setHookIgnoreBranches(body.branches as string[]);
  return c.json({ ok: true, ignoreBranches: getHookIgnoreBranches() });
});

export default settingsRoutes;
