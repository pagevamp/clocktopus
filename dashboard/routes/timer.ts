import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Clockify } from '../../clockify.js';
import {
  completeLatestSession,
  deleteSessionById,
  getOpenSession,
  getSessionById,
  logCompletedSession,
  logSessionStart,
  setSessionJiraWorklogId,
} from '../../lib/db.js';
import { deleteJiraWorklog, stopJiraTimer } from '../../lib/jira.js';
import { isClockifyEnabled } from '../../lib/credentials.js';

function extractJiraTicket(description: string): string | undefined {
  const match = description.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match?.[1];
}

const timerRoutes = new Hono();

timerRoutes.get('/timer/active', async (c) => {
  try {
    if (!isClockifyEnabled()) {
      const openSession = getOpenSession();
      if (!openSession) return c.json({ active: false });
      return c.json({
        active: true,
        description: openSession.description,
        projectId: openSession.projectId,
        start: openSession.startedAt,
        ...(openSession.jiraTicket ? { jiraTicket: openSession.jiraTicket } : {}),
      });
    }

    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ active: false });

    const timer = await clockify.getActiveTimer(user.defaultWorkspace, user.id);
    if (!timer) {
      const openSession = getOpenSession();
      if (openSession) {
        const completedAt = new Date().toISOString();
        completeLatestSession(completedAt, false);
        if (openSession.jiraTicket) {
          const timeSpentSeconds = Math.round(
            (new Date(completedAt).getTime() - new Date(openSession.startedAt).getTime()) / 1000,
          );
          if (timeSpentSeconds >= 60) {
            try {
              const worklog = await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
              if (worklog?.id) setSessionJiraWorklogId(openSession.id, worklog.id);
            } catch (err) {
              console.error('Error stopping Jira timer on external stop:', err);
            }
          }
        }
      }
      return c.json({ active: false });
    }

    const timerStart = timer.timeInterval.start as string;
    const jiraTicket = extractJiraTicket(timer.description ?? '');
    const openSession = getOpenSession();
    const alreadyTracked = openSession && openSession.startedAt.slice(0, 19) === timerStart.slice(0, 19);
    if (!alreadyTracked) {
      logSessionStart(timer.id ?? uuidv4(), timer.projectId, timer.description ?? '', timerStart, jiraTicket);
    }

    return c.json({
      active: true,
      description: timer.description,
      projectId: timer.projectId,
      start: timerStart,
      ...(jiraTicket ? { jiraTicket } : {}),
    });
  } catch {
    return c.json({ active: false });
  }
});

timerRoutes.post('/timer/start', async (c) => {
  const { projectId, description, jiraTicket, billable } = await c.req.json<{
    projectId?: string | null;
    description: string;
    jiraTicket?: string;
    billable?: boolean;
  }>();

  const cleanDescription = (description ?? '').trim();
  const cleanJira = jiraTicket?.trim() || undefined;
  const clockifyOn = isClockifyEnabled();

  if (clockifyOn) {
    if (!projectId || !cleanDescription) {
      return c.json({ ok: false, error: 'Project and description are required.' }, 400);
    }
    try {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

      const result = await clockify.startTimer(
        user.defaultWorkspace,
        projectId,
        cleanDescription,
        cleanJira,
        billable ?? true,
      );
      if (!result) return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
    }
  }

  // Jira-only mode
  if (!cleanJira) {
    return c.json({ ok: false, error: 'Jira ticket required in Jira-only mode.' }, 400);
  }
  const finalDescription = cleanDescription || cleanJira;
  const sessionId = uuidv4();
  const startedAt = new Date().toISOString();
  try {
    logSessionStart(sessionId, projectId ?? null, finalDescription, startedAt, cleanJira);
    return c.json({ ok: true });
  } catch (err) {
    console.error('Error starting Jira-only session:', err);
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
          const worklog = await stopJiraTimer(openSession.jiraTicket, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(openSession.id, worklog.id);
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

timerRoutes.post('/timer/log', async (c) => {
  const { projectId, description, start, end, jiraTicket, billable } = await c.req.json<{
    projectId: string;
    description: string;
    start: string;
    end: string;
    jiraTicket?: string;
    billable?: boolean;
  }>();

  if (!projectId) {
    return c.json({ ok: false, error: 'Project is required.' }, 400);
  }
  if (!start || !end) {
    return c.json({ ok: false, error: 'Start and end are required.' }, 400);
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return c.json({ ok: false, error: 'Invalid start or end date.' }, 400);
  }
  if (endMs <= startMs) {
    return c.json({ ok: false, error: 'End must be after start.' }, 400);
  }

  const cleanDescription = (description ?? '').trim();
  const cleanJira = jiraTicket?.trim() || undefined;
  if (!cleanDescription && !cleanJira) {
    return c.json({ ok: false, error: 'Description or Jira ticket is required.' }, 400);
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    const finalDescription = cleanDescription || cleanJira!;

    const entry = await clockify.logTime(
      user.defaultWorkspace,
      projectId,
      startIso,
      endIso,
      finalDescription,
      billable ?? true,
    );
    if (!entry) return c.json({ ok: false, error: 'Failed to log time in Clockify.' }, 500);

    const entryId = (entry as { id?: string }).id ?? uuidv4();
    logCompletedSession(entryId, projectId, finalDescription, startIso, endIso, cleanJira);

    if (cleanJira) {
      const timeSpentSeconds = Math.round((endMs - startMs) / 1000);
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(cleanJira, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(entryId, worklog.id);
        } catch (err) {
          console.error('Error posting Jira worklog for manual entry:', err);
        }
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error('Error logging manual time:', err);
    return c.json({ ok: false, error: 'Failed to log time.' }, 500);
  }
});

timerRoutes.delete('/timer/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'Missing id.' }, 400);

  const session = getSessionById(id);
  if (!session) return c.json({ ok: false, error: 'Session not found.' }, 404);

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const clockifyOk = await clockify.deleteTimeEntry(user.defaultWorkspace, id);
    // Continue even if Clockify delete fails — the entry may already be gone remotely.
    if (!clockifyOk) console.warn(`Clockify delete returned failure for ${id}; removing local record anyway.`);

    if (session.jiraTicket && session.jiraWorklogId) {
      try {
        await deleteJiraWorklog(session.jiraTicket, session.jiraWorklogId);
      } catch (err) {
        console.error('Error deleting Jira worklog:', err);
      }
    }

    deleteSessionById(id);
    return c.json({ ok: true });
  } catch (err) {
    console.error('Error deleting entry:', err);
    return c.json({ ok: false, error: 'Failed to delete entry.' }, 500);
  }
});

export default timerRoutes;
