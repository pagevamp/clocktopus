import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { indexPage } from './views.js';
import statusRoutes from './routes/status.js';
import clockifyRoutes from './routes/clockify.js';
import jiraRoutes from './routes/jira.js';
import googleRoutes from './routes/google.js';
import timerRoutes from './routes/timer.js';
import dataRoutes from './routes/data.js';

const app = new Hono();

app.get('/', (c) => c.html(indexPage()));
app.route('/api', statusRoutes);
app.route('/api', clockifyRoutes);
app.route('/api', jiraRoutes);
app.route('/api', googleRoutes);
app.route('/api', timerRoutes);
app.route('/api', dataRoutes);

export function startDashboard() {
  const port = 4001;
  console.log(`Clocktopus dashboard running at http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
