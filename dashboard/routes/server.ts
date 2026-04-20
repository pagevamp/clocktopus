import { Hono } from 'hono';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '../../index.js');
const isDev = SCRIPT_PATH.includes('/Projects/') || SCRIPT_PATH.includes('/src/');
const DASH_PM2_NAME = isDev ? 'clocktopus-dash-dev' : 'clocktopus-dash';
const pm2Bin = path.join(path.dirname(createRequire(import.meta.url).resolve('pm2')), 'bin', 'pm2');

const serverRoutes = new Hono();

function isUnderPm2(): boolean {
  if (process.env.pm_id) return true;
  try {
    const output = execSync(`${pm2Bin} jlist`, { encoding: 'utf-8', timeout: 3000 });
    const processes = JSON.parse(output) as Array<{ name: string; pid: number; pm2_env?: { status?: string } }>;
    return processes.some((p) => p.name === DASH_PM2_NAME && p.pid === process.pid);
  } catch {
    return false;
  }
}

serverRoutes.post('/server/restart', (c) => {
  const underPm2 = isUnderPm2();

  setTimeout(() => {
    if (underPm2) {
      try {
        spawn(pm2Bin, ['restart', DASH_PM2_NAME], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        process.exit(0);
      }
    } else {
      process.exit(0);
    }
  }, 100);

  return c.json({ ok: true, managed: underPm2 });
});

export default serverRoutes;
