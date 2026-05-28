import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

beforeEach(async () => {
  const mod = await import('../../lib/desktop-version.js');
  mod.__resetCacheForTests();
});

describe('GET /api/desktop-version', () => {
  it('returns updateAvailable=true when latest > current', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v1.0.3',
          html_url: 'https://x/y',
          published_at: '2026-05-20T00:00:00Z',
          assets: [{ name: 'Clocktopus_1.0.3.dmg', browser_download_url: 'https://x/dmg' }],
        }),
        { status: 200 },
      )) as typeof fetch;
    const routes = (await import('./desktop-version.js')).default;
    const app = new Hono().route('/api', routes);
    const res = await app.request('/api/desktop-version?currentDesktopVersion=1.0.2');
    const body = (await res.json()) as {
      current: string;
      latest: string;
      updateAvailable: boolean;
      downloadUrl: string;
      htmlUrl: string;
    };
    expect(body.current).toBe('1.0.2');
    expect(body.latest).toBe('1.0.3');
    expect(body.updateAvailable).toBe(true);
    expect(body.downloadUrl).toBe('https://x/dmg');
  });

  it('returns latest=null on GitHub 5xx', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 503 })) as typeof fetch;
    const routes = (await import('./desktop-version.js')).default;
    const app = new Hono().route('/api', routes);
    const res = await app.request('/api/desktop-version?currentDesktopVersion=1.0.2');
    const body = (await res.json()) as { latest: string | null };
    expect(body.latest).toBeNull();
  });
});
