import { Hono } from 'hono';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { IS_DEV } from '../../lib/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '../../index.js');
const PM2_NAME = IS_DEV ? 'clocktopus-monitor-dev' : 'clocktopus-monitor';
const pm2Bin = path.join(path.dirname(createRequire(import.meta.url).resolve('pm2')), 'bin', 'pm2');
const bunBin = (() => {
  try {
    return execSync('which bun', { encoding: 'utf-8' }).trim();
  } catch {
    return 'bun';
  }
})();
const pm2Cmd = `${bunBin} ${pm2Bin}`;

const PM2_STALE_HINT =
  'PM2 daemon is out-of-date with installed pm2 binary. Fix: `bun install -g pm2@latest` then `pm2 update`. ' +
  'After that, reload this page.';

function detectPm2Hint(text: string): string | undefined {
  if (/In-memory PM2 is out-of-date/i.test(text)) return PM2_STALE_HINT;
  return undefined;
}

const monitorRoutes = new Hono();

function pm2Exec(command: string): { ok: boolean; output: string; hint?: string } {
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 10000 });
    const trimmed = output.trim();
    const hint = detectPm2Hint(trimmed);
    return hint ? { ok: true, output: trimmed, hint } : { ok: true, output: trimmed };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const hint = detectPm2Hint(msg);
    return hint ? { ok: false, output: msg, hint } : { ok: false, output: msg };
  }
}

monitorRoutes.get('/monitor/status', (c) => {
  try {
    const output = execSync(`${pm2Cmd} jlist`, { encoding: 'utf-8', timeout: 10000 });
    // PM2 prepends "In-memory PM2 is out-of-date" warning when daemon
    // version drifts from the installed binary. Strip everything before
    // the JSON array so parse doesn't choke.
    const jsonStart = output.indexOf('[');
    if (jsonStart < 0) throw new Error('pm2 jlist returned no JSON');
    const processes = JSON.parse(output.slice(jsonStart));
    const proc = processes.find((p: { name: string }) => p.name === PM2_NAME);

    if (!proc) {
      return c.json({ running: false, status: 'not found' });
    }

    return c.json({
      running: proc.pm2_env.status === 'online',
      status: proc.pm2_env.status,
      uptime: proc.pm2_env.pm_uptime,
      restarts: proc.pm2_env.restart_time,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = detectPm2Hint(msg) ?? PM2_STALE_HINT;
    return c.json({ running: false, status: 'pm2 error', error: msg, hint });
  }
});

monitorRoutes.post('/monitor/start', (c) => {
  const bunPath = execSync('which bun', { encoding: 'utf-8' }).trim();
  // Delete any existing process to avoid duplicates
  try {
    execSync(`${pm2Cmd} delete ${PM2_NAME}`, { stdio: 'ignore' });
  } catch {}
  const result = pm2Exec(`${pm2Cmd} start ${SCRIPT_PATH} --name ${PM2_NAME} --interpreter ${bunPath} -- monitor:run`);
  return c.json(result);
});

monitorRoutes.post('/monitor/stop', (c) => {
  const result = pm2Exec(`${pm2Cmd} stop ${PM2_NAME}`);
  return c.json(result);
});

monitorRoutes.post('/monitor/restart', (c) => {
  const result = pm2Exec(`${pm2Cmd} restart ${PM2_NAME}`);
  return c.json(result);
});

export default monitorRoutes;
