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

describe('POST /api/update + SSE stream', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('creates a job and streams a fake install to completion', async () => {
    const updaterMod = await import('../../lib/updater.js');
    updaterMod.__setSpawnerForTests(((_cmd: string, _args: string[]) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emitter = {
        stdout: { on: (e: string, cb: (b: Buffer) => void) => (listeners['out-' + e] = [cb]) },
        stderr: { on: () => {} },
        on: (e: string, cb: (code: number) => void) => {
          if (e === 'close') setTimeout(() => cb(0), 10);
          return emitter;
        },
      };
      setTimeout(() => listeners['out-data']?.[0](Buffer.from('hello\n')), 2);
      return emitter as unknown as ReturnType<Parameters<typeof updaterMod.__setSpawnerForTests>[0]>;
    }) as unknown as Parameters<typeof updaterMod.__setSpawnerForTests>[0]);

    const updateRoutes = (await import('./update.js')).default;
    const app = new Hono().route('/api', updateRoutes);

    const post = await app.request('/api/update', { method: 'POST' });
    expect(post.status).toBe(200);
    const { jobId } = (await post.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    // Wait a beat for the job to push at least the first log line.
    await new Promise((r) => setTimeout(r, 50));

    const stream = await app.request(`/api/update/${jobId}/stream`);
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
      if (chunks.join('').includes('event: done') || chunks.join('').includes('event: error')) break;
    }
    const text = chunks.join('');
    expect(text).toContain('event: log');
    expect(text).toContain('hello');
    expect(text).toContain('event: done');
    updaterMod.__setSpawnerForTests(null);
  });
});
