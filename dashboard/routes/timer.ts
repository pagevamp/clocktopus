import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Clockify } from '../../clockify.js';
import { completeLatestSession, getOpenSession, logSessionStart } from '../../lib/db.js';
import { stopJiraTimer } from '../../lib/jira.js';

function extractJiraTicket(description: string): string | undefined {
  const match = description.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match?.[1];
}

const timerRoutes = new Hono();

timerRoutes.get('/timer/active', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ active: false });

    const timer = await clockify.getActiveTimer(user.defaultWorkspace, user.id);
    if (!timer) return c.json({ active: false });

    // Sync externally-started timers (e.g. from Clockify app or Jira plugin) to DB
    const timerStart = timer.timeInterval.start as string;
    const openSession = getOpenSession();
    const alreadyTracked = openSession && openSession.startedAt.slice(0, 19) === timerStart.slice(0, 19);
    if (!alreadyTracked) {
      const jiraTicket = extractJiraTicket(timer.description ?? '');
      logSessionStart(timer.id ?? uuidv4(), timer.projectId, timer.description ?? '', timerStart, jiraTicket);
    }

    return c.json({
      active: true,
      description: timer.description,
      projectId: timer.projectId,
      start: timerStart,
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

    const openSession = getOpenSession();
    const result = await clockify.stopTimer(user.defaultWorkspace, user.id);
    if (!result) return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);

    const completedAt = new Date().toISOString();
    completeLatestSession(completedAt, false);

    if (openSession?.jiraTicket) {
      const timeSpentSeconds = Math.round(
        (new Date(completedAt).getTime() - new Date(openSession.startedAt).getTime()) / 1000,
      );
      if (timeSpentSeconds >= 60) {
        try {
          await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
        } catch (err) {
          console.error('Error stopping Jira timer:', err);
        }
      }
    }

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: 'Failed to stop timer.' }, 500);
  }
});

export default timerRoutes;
