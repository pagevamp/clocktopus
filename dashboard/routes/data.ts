import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { getRecentSessions, getSessionCount } from '../../lib/db.js';

const dataRoutes = new Hono();

function loadLocalProjects(): Array<{ id: string; name: string }> {
  const filePath = path.join(process.cwd(), 'data/local-projects.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

dataRoutes.get('/projects', (c) => {
  const projects = loadLocalProjects();
  return c.json(projects);
});

dataRoutes.get('/sessions', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '10', 10)));
  const offset = (page - 1) * limit;

  const sessions = getRecentSessions(limit, offset);
  const total = getSessionCount();
  const projects = loadLocalProjects();
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

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
