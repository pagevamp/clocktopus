import { Hono } from 'hono';
import { execSync } from 'child_process';

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
    const output = execSync('bunx pm2 jlist', { encoding: 'utf-8', timeout: 10000 });
    const processes = JSON.parse(output);
    const clocktopus = processes.find((p: { name: string }) => p.name === 'clocktopus');

    if (!clocktopus) {
      return c.json({ running: false, status: 'not found' });
    }

    return c.json({
      running: clocktopus.pm2_env.status === 'online',
      status: clocktopus.pm2_env.status,
      uptime: clocktopus.pm2_env.pm_uptime,
      restarts: clocktopus.pm2_env.restart_time,
    });
  } catch {
    return c.json({ running: false, status: 'pm2 not available' });
  }
});

monitorRoutes.post('/monitor/start', (c) => {
  const result = pm2Exec('bunx pm2 start dist/index.js --name clocktopus -- monitor');
  return c.json(result);
});

monitorRoutes.post('/monitor/stop', (c) => {
  const result = pm2Exec('bunx pm2 stop clocktopus');
  return c.json(result);
});

monitorRoutes.post('/monitor/restart', (c) => {
  const result = pm2Exec('bunx pm2 restart clocktopus');
  return c.json(result);
});

export default monitorRoutes;
