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
import { deleteJiraWorklog, getJiraTicket, stopJiraTimer } from '../../lib/jira.js';
import { isClockifyEnabled, isJiraDisabled } from '../../lib/credentials.js';

function extractJiraTicket(description: string): string | undefined {
  const match = description.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match?.[1];
}

async function buildJiraDescription(ticket: string, typed: string): Promise<string> {
  if (typed && typed !== ticket) return typed;
  if (isJiraDisabled()) return ticket;
  try {
    const issue = (await getJiraTicket(ticket)) as { fields?: { summary?: string } } | null;
    const summary = issue?.fields?.summary?.trim();
    if (summary) return ticket + ' ' + summary;
  } catch (err) {
    console.warn('Jira summary lookup failed for', ticket, err);
  }
  return ticket;
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
        if (openSession.jiraTicket && !isJiraDisabled()) {
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
    let clockifyStarted = false;
    try {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (user) {
        const result = await clockify.startTimer(
          user.defaultWorkspace,
          projectId,
          cleanDescription,
          cleanJira,
          billable ?? true,
        );
        if (result) clockifyStarted = true;
        else console.warn('Clockify startTimer returned null; falling through to Jira-only path.');
      } else {
        console.warn('Clockify enabled but getUser failed; falling through to Jira-only path.');
      }
    } catch (err) {
      console.warn('Clockify start threw; falling through to Jira-only path:', err);
    }
    if (clockifyStarted) return c.json({ ok: true });
  }

  // Jira-only or local-only path (also used as fallback when Clockify is unreachable)
  if (!cleanJira && !cleanDescription) {
    return c.json({ ok: false, error: 'Description or Jira ticket is required.' }, 400);
  }
  const finalDescription = cleanJira ? await buildJiraDescription(cleanJira, cleanDescription) : cleanDescription;
  const sessionId = uuidv4();
  const startedAt = new Date().toISOString();
  try {
    logSessionStart(sessionId, projectId ?? null, finalDescription, startedAt, cleanJira);
    return c.json({ ok: true });
  } catch (err) {
    console.error('Error starting session:', err);
    return c.json({ ok: false, error: 'Failed to start timer.' }, 500);
  }
});

timerRoutes.post('/timer/stop', async (c) => {
  try {
    const openSession = getOpenSession();

    if (isClockifyEnabled()) {
      try {
        const clockify = new Clockify();
        const user = await clockify.getUser();
        if (user) {
          const result = await clockify.stopTimer(user.defaultWorkspace, user.id);
          if (!result) console.warn('Clockify stopTimer returned null; proceeding with DB + worklog.');
        } else {
          console.warn('Clockify enabled but getUser failed; proceeding with DB + worklog.');
        }
      } catch (err) {
        console.warn('Clockify stop threw; proceeding with DB + worklog:', err);
      }
      if (!openSession) return c.json({ ok: false, error: 'No active timer.' }, 404);
    } else if (!openSession) {
      return c.json({ ok: false, error: 'No active timer.' }, 404);
    }

    const completedAt = new Date().toISOString();
    completeLatestSession(completedAt, false);

    if (openSession?.jiraTicket && !isJiraDisabled()) {
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
    projectId?: string | null;
    description: string;
    start: string;
    end: string;
    jiraTicket?: string;
    billable?: boolean;
  }>();

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
  const clockifyOn = isClockifyEnabled();

  if (clockifyOn && !projectId) {
    return c.json({ ok: false, error: 'Project is required.' }, 400);
  }
  if (!cleanDescription && !cleanJira) {
    return c.json({ ok: false, error: 'Description or Jira ticket is required.' }, 400);
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const clockifyDescription = cleanDescription || cleanJira || '';
  let entryId: string | undefined;
  let clockifySucceeded = false;

  try {
    if (clockifyOn) {
      try {
        const clockify = new Clockify();
        const user = await clockify.getUser();
        if (user) {
          const entry = await clockify.logTime(
            user.defaultWorkspace,
            projectId!,
            startIso,
            endIso,
            clockifyDescription,
            billable ?? true,
          );
          if (entry) {
            entryId = (entry as { id?: string }).id ?? uuidv4();
            clockifySucceeded = true;
          } else {
            console.warn('Clockify logTime returned null; falling through to Jira-only path.');
          }
        } else {
          console.warn('Clockify enabled but getUser failed; falling through to Jira-only path.');
        }
      } catch (err) {
        console.warn('Clockify log threw; falling through to Jira-only path:', err);
      }
    }

    if (!entryId) {
      entryId = uuidv4();
    }

    const finalDescription = clockifySucceeded
      ? clockifyDescription
      : cleanJira
        ? await buildJiraDescription(cleanJira, cleanDescription)
        : cleanDescription;

    logCompletedSession(entryId, projectId ?? null, finalDescription, startIso, endIso, cleanJira);

    if (cleanJira && !isJiraDisabled()) {
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
    if (isClockifyEnabled()) {
      const clockify = new Clockify();
      const user = await clockify.getUser();
      if (user) {
        const clockifyOk = await clockify.deleteTimeEntry(user.defaultWorkspace, id);
        if (!clockifyOk) console.warn(`Clockify delete returned failure for ${id}; removing local record anyway.`);
      } else {
        console.warn('Clockify enabled but getUser failed; skipping remote delete.');
      }
    }

    if (session.jiraTicket && session.jiraWorklogId && !isJiraDisabled()) {
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
