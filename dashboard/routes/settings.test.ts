import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { Hono } from 'hono';

const TMP = path.join(import.meta.dir, '..', '..', 'lib', '__tmp_settings_route_test__');
process.env.CLOCKTOPUS_DATA_DIR = TMP;

let settingsRoutes: typeof import('./settings.js').default;
let deleteSetting: typeof import('../../lib/db.js').deleteSetting;

beforeAll(async () => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  settingsRoutes = (await import('./settings.js')).default;
  deleteSetting = (await import('../../lib/db.js')).deleteSetting;
});

describe('settings/updates route', () => {
  beforeEach(() => {
    deleteSetting('updatesAutoCheck');
    deleteSetting('updatesNotify');
  });

  it('GET returns defaults', async () => {
    const app = new Hono().route('/api', settingsRoutes);
    const res = await app.request('/api/settings/updates');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autoCheck: true, notify: true });
  });

  it('PUT persists and GET reads back', async () => {
    const app = new Hono().route('/api', settingsRoutes);
    const put = await app.request('/api/settings/updates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoCheck: false }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ autoCheck: false, notify: true });
    const get = await app.request('/api/settings/updates');
    expect(await get.json()).toEqual({ autoCheck: false, notify: true });
  });

  it('PUT with empty body keeps existing values', async () => {
    const app = new Hono().route('/api', settingsRoutes);
    await app.request('/api/settings/updates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoCheck: false, notify: false }),
    });
    const put = await app.request('/api/settings/updates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ autoCheck: false, notify: false });
  });
});
