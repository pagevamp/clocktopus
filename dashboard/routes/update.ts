import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'crypto';
import {
  getCurrentVersion,
  fetchLatestVersion,
  isUpdateAvailable,
  runUpdate,
  stopMonitorIfRunning,
} from '../../lib/updater.js';
import { markNotifiedVersion } from '../../lib/update-cache.js';

const updateRoutes = new Hono();

updateRoutes.get('/version', async (c) => {
  const force = c.req.query('refresh') === '1';
  const current = getCurrentVersion();
  const latest = await fetchLatestVersion({ force });
  return c.json({
    current,
    latest: latest?.version ?? null,
    publishedAt: latest?.publishedAt ?? null,
    updateAvailable: latest ? isUpdateAvailable(current, latest.version) : false,
    checkedAt: latest ? new Date().toISOString() : null,
  });
});

type JobState =
  | { status: 'running'; logs: string[]; subscribers: Set<(line: string) => void> }
  | { status: 'done'; logs: string[]; subscribers: Set<(line: string) => void> }
  | {
      status: 'error';
      logs: string[];
      subscribers: Set<(line: string) => void>;
      error: string;
    };

const jobs = new Map<string, JobState>();

function pushLog(job: JobState, line: string) {
  job.logs.push(line);
  for (const cb of job.subscribers) cb(line);
}

updateRoutes.post('/update', async (c) => {
  const jobId = randomUUID();
  const job: JobState = { status: 'running', logs: [], subscribers: new Set() };
  jobs.set(jobId, job);

  // Run async; route returns immediately so the client can subscribe to the SSE.
  (async () => {
    try {
      await stopMonitorIfRunning();
      await runUpdate({ onLog: (line) => pushLog(job, line) });
      const done: JobState = {
        status: 'done',
        logs: job.logs,
        subscribers: job.subscribers,
      };
      jobs.set(jobId, done);
      pushLog(done, '__DONE__');
      // Self-exit so a supervisor (Tauri, PM2) respawns dashboard on the new
      // binary. Skipped in tests where the harness runs everything in-process.
      if (process.env.NODE_ENV !== 'test') {
        setTimeout(() => process.exit(0), 500);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errJob: JobState = {
        status: 'error',
        logs: job.logs,
        subscribers: job.subscribers,
        error: message,
      };
      jobs.set(jobId, errJob);
      pushLog(errJob, '__ERROR__' + message);
    }
  })();

  return c.json({ jobId });
});

updateRoutes.get('/update/:jobId/stream', (c) => {
  const job = jobs.get(c.req.param('jobId'));
  if (!job) return c.text('job not found', 404);
  return streamSSE(c, async (stream) => {
    // Replay any buffered log lines first.
    for (const line of job.logs) {
      if (line.startsWith('__DONE__')) {
        await stream.writeSSE({ event: 'done', data: '' });
        return;
      }
      if (line.startsWith('__ERROR__')) {
        await stream.writeSSE({ event: 'error', data: line.slice('__ERROR__'.length) });
        return;
      }
      await stream.writeSSE({ event: 'log', data: line });
    }
    // If the job already terminated between logs being buffered and the for-loop
    // completing, emit the terminal event now.
    if (job.status !== 'running') {
      await stream.writeSSE({
        event: job.status === 'done' ? 'done' : 'error',
        data: job.status === 'error' ? job.error : '',
      });
      return;
    }
    // Otherwise subscribe to future lines.
    await new Promise<void>((resolve) => {
      const cb = async (line: string) => {
        if (line.startsWith('__DONE__')) {
          await stream.writeSSE({ event: 'done', data: '' });
          job.subscribers.delete(cb);
          resolve();
          return;
        }
        if (line.startsWith('__ERROR__')) {
          await stream.writeSSE({ event: 'error', data: line.slice('__ERROR__'.length) });
          job.subscribers.delete(cb);
          resolve();
          return;
        }
        await stream.writeSSE({ event: 'log', data: line });
      };
      job.subscribers.add(cb);
    });
  });
});

updateRoutes.post('/update/dismiss', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { version?: string };
  if (!body.version) return c.json({ ok: false, error: 'version required' }, 400);
  markNotifiedVersion(body.version);
  return c.json({ ok: true });
});

export default updateRoutes;
