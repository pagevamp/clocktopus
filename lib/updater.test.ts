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

describe('runUpdate', () => {
  it('spawns bun with the expected args and resolves on exit 0', async () => {
    const calls: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
    const fakeSpawn = (cmd: string, args: string[], opts: { env: Record<string, string> }) => {
      calls.push({ cmd, args, env: opts.env });
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emitter = {
        stdout: { on: (e: string, cb: (b: Buffer) => void) => (listeners['out-' + e] = [cb]) },
        stderr: { on: (e: string, cb: (b: Buffer) => void) => (listeners['err-' + e] = [cb]) },
        on: (e: string, cb: (code: number) => void) => {
          if (e === 'close') setTimeout(() => cb(0), 5);
          return emitter;
        },
      };
      setTimeout(() => listeners['out-data']?.[0](Buffer.from('installing\n')), 1);
      return emitter as unknown;
    };
    const { runUpdate, __setSpawnerForTests } = await import('./updater.js');
    __setSpawnerForTests(fakeSpawn as Parameters<typeof __setSpawnerForTests>[0]);
    const logs: string[] = [];
    await runUpdate({ onLog: (l) => logs.push(l) });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['i', '-g', 'clocktopus', '--trust']);
    expect(calls[0].env.PATH.startsWith(`${process.env.HOME}/.bun/bin:`)).toBe(true);
    expect(logs).toContain('installing');
    __setSpawnerForTests(null);
  });

  it('rejects with combined stderr on non-zero exit', async () => {
    const fakeSpawn = () => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emitter = {
        stdout: { on: () => {} },
        stderr: { on: (e: string, cb: (b: Buffer) => void) => (listeners['err-' + e] = [cb]) },
        on: (e: string, cb: (code: number) => void) => {
          if (e === 'close') setTimeout(() => cb(1), 5);
          return emitter;
        },
      };
      setTimeout(() => listeners['err-data']?.[0](Buffer.from('permission denied\n')), 1);
      return emitter as unknown;
    };
    const { runUpdate, __setSpawnerForTests } = await import('./updater.js');
    __setSpawnerForTests(fakeSpawn as Parameters<typeof __setSpawnerForTests>[0]);
    await expect(runUpdate({ onLog: () => {} })).rejects.toThrow(/permission denied/);
    __setSpawnerForTests(null);
  });
});
