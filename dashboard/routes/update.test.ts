import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('GET /api/version', () => {
  beforeEach(async () => {
    const mod = await import('../../lib/updater.js');
    mod.__resetFetchCacheForTests();
  });

  it('returns current + latest + updateAvailable', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: '999.0.0', time: { '999.0.0': '2026-05-28T00:00:00Z' } }), {
        status: 200,
      })) as typeof fetch;
    const updateRoutes = (await import('./update.js')).default;
    const app = new Hono().route('/api', updateRoutes);
    const res = await app.request('/api/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      current: string;
      latest: string;
      updateAvailable: boolean;
    };
    expect(body.current).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.latest).toBe('999.0.0');
    expect(body.updateAvailable).toBe(true);
  });

  it('returns latest=null when registry fails', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 503 })) as typeof fetch;
    const updateRoutes = (await import('./update.js')).default;
    const app = new Hono().route('/api', updateRoutes);
    const res = await app.request('/api/version');
    const body = (await res.json()) as { latest: string | null; updateAvailable: boolean };
    expect(body.latest).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });
});
