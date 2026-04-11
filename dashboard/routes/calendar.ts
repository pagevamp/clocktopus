import { Hono } from 'hono';
import { google } from 'googleapis';
import { getAuthenticatedClient, getRefreshedToken } from '../../lib/google.js';
import { getLatestToken, storeToken, getEventProject, setEventProject, getActiveProjects } from '../../lib/db.js';
import { Clockify } from '../../clockify.js';

const DASHBOARD_REDIRECT_URI = 'http://localhost:4001/api/google/callback';

const calendarRoutes = new Hono();

calendarRoutes.get('/calendar/events', async (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!start || !end) {
    return c.json({ ok: false, error: 'Both start and end query parameters are required.' }, 400);
  }

  try {
    let token = await getLatestToken();
    if (!token) {
      return c.json({ ok: false, error: 'Google account not connected. Please authenticate first.' }, 401);
    }

    const oAuth2Client = getAuthenticatedClient(DASHBOARD_REDIRECT_URI);

    // Refresh if expired or if expiry_date is unknown (proxy tokens only have expires_in)
    const isExpired = token.expiry_date ? new Date(token.expiry_date) < new Date() : true;
    if (isExpired && token.refresh_token) {
      token = await getRefreshedToken(token);
      storeToken(token);
    }
    oAuth2Client.setCredentials(token);

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    const timeMin = new Date(start).toISOString();
    const endOfDay = new Date(end);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const timeMax = endOfDay.toISOString();

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    // Fetch existing Clockify entries for the same range to detect duplicates
    const clockify = new Clockify();
    const user = await clockify.getUser();
    const existingEntries = user ? await clockify.getTimeEntries(user.defaultWorkspace, user.id, timeMin, timeMax) : [];

    // Build a set of "description|startEpoch" for quick lookup (normalize timezones)
    const loggedSet = new Set(
      existingEntries.map((e) => `${e.description}|${new Date(e.timeInterval.start).getTime()}`),
    );

    const events = (res.data.items || [])
      .filter((event) => !event.start?.date) // Filter out all-day events
      .filter((event) => event.summary && event.start?.dateTime && event.end?.dateTime)
      .map((event) => {
        const savedProjectId = getEventProject(event.summary!);
        const alreadyLogged = loggedSet.has(`${event.summary}|${new Date(event.start!.dateTime!).getTime()}`);
        return {
          summary: event.summary!,
          start: event.start!.dateTime!,
          end: event.end!.dateTime!,
          savedProjectId: savedProjectId ?? undefined,
          skipped: savedProjectId === null,
          alreadyLogged,
        };
      });

    const projects = getActiveProjects();

    return c.json({ ok: true, events, projects });
  } catch (error) {
    console.error('Calendar events error:', error instanceof Error ? error.message : error);
    return c.json({ ok: false, error: 'Failed to fetch calendar events.' }, 500);
  }
});

calendarRoutes.post('/calendar/log', async (c) => {
  const { entries } = await c.req.json<{
    entries: Array<{ summary: string; start: string; end: string; projectId: string }>;
  }>();

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return c.json({ ok: false, error: 'Entries array is required.' }, 400);
  }

  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) {
      return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);
    }

    const logged: string[] = [];
    const failed: string[] = [];

    for (const entry of entries) {
      if (!entry.summary || !entry.start || !entry.end || !entry.projectId) {
        failed.push(entry.summary ?? '(unknown)');
        continue;
      }
      try {
        await clockify.logTime(user.defaultWorkspace, entry.projectId, entry.start, entry.end, entry.summary);
        setEventProject(entry.summary, entry.projectId);
        logged.push(entry.summary);
      } catch {
        failed.push(entry.summary);
      }
    }

    return c.json({ ok: true, logged, failed });
  } catch {
    return c.json({ ok: false, error: 'Failed to log calendar events.' }, 500);
  }
});

export default calendarRoutes;
