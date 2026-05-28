import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

describe('isUpdateAvailable', () => {
  it('true when latest is strictly greater', async () => {
    const { isUpdateAvailable } = await import('./updater.js');
    expect(isUpdateAvailable('1.12.3', '1.13.0')).toBe(true);
    expect(isUpdateAvailable('1.12.3', '2.0.0')).toBe(true);
  });

  it('false when equal or downgrade', async () => {
    const { isUpdateAvailable } = await import('./updater.js');
    expect(isUpdateAvailable('1.12.3', '1.12.3')).toBe(false);
    expect(isUpdateAvailable('2.0.0', '1.99.99')).toBe(false);
  });

  it('treats prerelease as lower than its base release', async () => {
    const { isUpdateAvailable } = await import('./updater.js');
    expect(isUpdateAvailable('1.13.0-rc.1', '1.13.0')).toBe(true);
    expect(isUpdateAvailable('1.13.0', '1.13.0-rc.1')).toBe(false);
  });
});

describe('getCurrentVersion', () => {
  it('returns a non-empty semver-ish string', async () => {
    const { getCurrentVersion } = await import('./updater.js');
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('fetchLatestVersion', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });
  beforeEach(async () => {
    const mod = await import('./updater.js');
    mod.__resetFetchCacheForTests();
  });

  it('caches the result for 5 minutes', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ version: '1.13.0', time: { '1.13.0': '2026-05-28T00:00:00Z' } }), {
        status: 200,
      });
    }) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    await fetchLatestVersion();
    await fetchLatestVersion();
    expect(calls).toBe(1);
  });

  it('force=true bypasses the cache', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ version: '1.13.0', time: { '1.13.0': '2026-05-28T00:00:00Z' } }), {
        status: 200,
      });
    }) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    await fetchLatestVersion();
    await fetchLatestVersion({ force: true });
    expect(calls).toBe(2);
  });

  it('returns null on 5xx', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 503 })) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    expect(await fetchLatestVersion()).toBeNull();
  });

  it('returns null on network error', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const { fetchLatestVersion } = await import('./updater.js');
    expect(await fetchLatestVersion()).toBeNull();
  });
});
