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

const monitorRoutes = new Hono();

function pm2Exec(command: string): { ok: boolean; output: string } {
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 10000 });
    return { ok: true, output: output.trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, output: msg };
  }
}

monitorRoutes.get('/monitor/status', (c) => {
  try {
    const output = execSync(`${pm2Cmd} jlist`, { encoding: 'utf-8', timeout: 10000 });
    const processes = JSON.parse(output);
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
  } catch {
    return c.json({ running: false, status: 'pm2 not available' });
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
