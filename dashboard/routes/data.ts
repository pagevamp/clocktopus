import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { getRecentSessions } from '../../lib/db.js';

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
  const sessions = getRecentSessions(20);
  const projects = loadLocalProjects();
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const enriched = (sessions as Array<Record<string, unknown>>).map((s) => ({
    ...s,
    projectName: projectMap.get(s.projectId as string) ?? 'Unknown',
  }));

  return c.json(enriched);
});

export default dataRoutes;
