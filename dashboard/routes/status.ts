import { Hono } from 'hono';
import axios from 'axios';
import { resolveCredential } from '../../lib/credentials.js';
import { getLatestToken } from '../../lib/db.js';

const statusRoutes = new Hono();

statusRoutes.get('/status', async (c) => {
  const results: { clockify: boolean; google: boolean; googleEmail?: string; jira: boolean } = {
    clockify: false,
    google: false,
    jira: false,
  };

  // Check Clockify
  const clockifyKey = resolveCredential('CLOCKIFY_API_KEY');
  if (clockifyKey) {
    try {
      const res = await axios.get('https://api.clockify.me/api/v1/user', {
        headers: { 'X-Api-Key': clockifyKey },
        timeout: 5000,
      });
      results.clockify = res.status === 200;
    } catch {}
  }

  // Check Google — token exists in DB
  const token = getLatestToken();
  results.google = !!token;
  if (token) {
    const googleEmail = resolveCredential('GOOGLE_ACCOUNT_EMAIL');
    if (googleEmail) results.googleEmail = googleEmail;
  }

  // Check Jira
  const jiraUrl = resolveCredential('ATLASSIAN_URL');
  const jiraToken = resolveCredential('ATLASSIAN_API_TOKEN');
  const jiraEmail = resolveCredential('ATLASSIAN_EMAIL');
  if (jiraUrl && jiraToken && jiraEmail) {
    try {
      const res = await axios.get(`${jiraUrl}/myself`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64')}`,
          Accept: 'application/json',
        },
        timeout: 5000,
      });
      results.jira = res.status === 200;
    } catch {}
  }

  return c.json(results);
});

export default statusRoutes;
