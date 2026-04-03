import { Hono } from 'hono';
import { Clockify } from '../../clockify.js';
import { completeLatestSession } from '../../lib/db.js';

const timerRoutes = new Hono();

timerRoutes.get('/timer/active', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ active: false });

    const timer = await clockify.getActiveTimer(user.defaultWorkspace, user.id);
    if (!timer) return c.json({ active: false });

    return c.json({
      active: true,
      description: timer.description,
      projectId: timer.projectId,
      start: timer.timeInterval.start,
    });
  } catch {
    return c.json({ active: false });
  }
});

timerRoutes.post('/timer/start', async (c) => {
  const { projectId, description, jiraTicket } = await c.req.json<{
    projectId: string;
    description: string;
    jiraTicket?: string;
  }>();

  if (!projectId || !description) {
    return c.json({ ok: false, error: 'Project and description are required.' }, 400);
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const result = await clockify.startTimer(user.defaultWorkspace, projectId, description, jiraTicket);
    if (!result) return c.json({ ok: false, error: 'Failed to start timer.' }, 500);

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
  }
});

timerRoutes.post('/timer/stop', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const result = await clockify.stopTimer(user.defaultWorkspace, user.id);
    if (!result) return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);

    completeLatestSession(new Date().toISOString(), false);

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);
  }
});

export default timerRoutes;
