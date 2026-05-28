import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
});

beforeEach(async () => {
  const mod = await import('./desktop-version.js');
  mod.__resetCacheForTests();
});

describe('fetchLatestDesktopRelease', () => {
  it('returns the latest dmg asset url', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v1.0.3',
          name: 'Clocktopus 1.0.3',
          html_url: 'https://github.com/pagevamp/clocktopus/releases/tag/v1.0.3',
          published_at: '2026-05-20T00:00:00Z',
          assets: [
            { name: 'Clocktopus_1.0.3_aarch64.dmg', browser_download_url: 'https://example.com/dmg' },
            { name: 'sig.txt', browser_download_url: 'https://example.com/sig' },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    const out = await fetchLatestDesktopRelease();
    expect(out).toEqual({
      version: '1.0.3',
      htmlUrl: 'https://github.com/pagevamp/clocktopus/releases/tag/v1.0.3',
      publishedAt: '2026-05-20T00:00:00Z',
      downloadUrl: 'https://example.com/dmg',
    });
  });

  it('returns downloadUrl=null when no dmg asset', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v1.0.3',
          html_url: 'h',
          published_at: 'p',
          assets: [{ name: 'foo.zip', browser_download_url: 'z' }],
        }),
        { status: 200 },
      )) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    const out = await fetchLatestDesktopRelease();
    expect(out?.downloadUrl).toBeNull();
  });

  it('returns null on 5xx', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 502 })) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    expect(await fetchLatestDesktopRelease()).toBeNull();
  });

  it('caches for 6 hours', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ tag_name: 'v1.0.3', html_url: '', published_at: '', assets: [] }), {
        status: 200,
      });
    }) as typeof fetch;
    const { fetchLatestDesktopRelease } = await import('./desktop-version.js');
    await fetchLatestDesktopRelease();
    await fetchLatestDesktopRelease();
    expect(calls).toBe(1);
  });
});
