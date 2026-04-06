import { Hono } from 'hono';
import {
  getRecentSessions,
  getSessionCount,
  getActiveProjects,
  getAllProjects,
  upsertProjects,
  toggleProjectActive,
} from '../../lib/db.js';
import { Clockify } from '../../clockify.js';

const dataRoutes = new Hono();

// Active projects for timer dropdown
dataRoutes.get('/projects', (c) => {
  const projects = getActiveProjects();
  return c.json(projects);
});

// All projects for settings management
dataRoutes.get('/projects/all', (c) => {
  const projects = getAllProjects();
  return c.json(projects);
});

// Fetch projects from Clockify and save to DB
dataRoutes.post('/projects/fetch', async (c) => {
  try {
    const clockify = new Clockify();
    const user = await clockify.getUser();
    if (!user) return c.json({ ok: false, error: 'Could not connect to Clockify.' }, 500);

    const projects = await clockify.getProjects(user.defaultWorkspace);
    if (projects.length === 0) return c.json({ ok: false, error: 'No projects found.' }, 404);

    upsertProjects(projects);
    return c.json({ ok: true, count: projects.length });
  } catch {
    return c.json({ ok: false, error: 'Failed to fetch projects.' }, 500);
  }
});

// Toggle project active status
dataRoutes.post('/projects/toggle', async (c) => {
  const { id, active } = await c.req.json<{ id: string; active: boolean }>();
  if (!id) return c.json({ ok: false, error: 'Project ID required.' }, 400);
  toggleProjectActive(id, active);
  return c.json({ ok: true });
});

// Sessions with pagination
dataRoutes.get('/sessions', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '10', 10)));
  const offset = (page - 1) * limit;

  const sessions = getRecentSessions(limit, offset);
  const total = getSessionCount();
  const allProjects = getAllProjects();
  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));

  const enriched = (sessions as Array<Record<string, unknown>>).map((s) => ({
    ...s,
    projectName: projectMap.get(s.projectId as string) ?? 'Unknown',
  }));

  return c.json({
    data: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

export default dataRoutes;
