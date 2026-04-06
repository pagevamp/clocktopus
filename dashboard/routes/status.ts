import { Hono } from 'hono';
import axios from 'axios';
import { resolveCredential } from '../../lib/credentials.js';
import { getLatestToken, getAtlassianToken } from '../../lib/db.js';
import { getValidAccessToken } from '../../lib/atlassian.js';

const statusRoutes = new Hono();

statusRoutes.get('/status', async (c) => {
  const results: {
    clockify: boolean;
    google: boolean;
    googleEmail?: string;
    jira: boolean;
    jiraOAuth: boolean;
    jiraSiteUrl?: string;
    clockifyKeyHint?: string;
  } = {
    clockify: false,
    google: false,
    jira: false,
    jiraOAuth: false,
  };

  // Check Clockify
  const clockifyKey = resolveCredential('CLOCKIFY_API_KEY');
  if (clockifyKey) {
    results.clockifyKeyHint = '***' + clockifyKey.slice(-4);
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

  // Check Jira — OAuth first, then Basic Auth
  const storedAtlassianToken = getAtlassianToken();
  if (storedAtlassianToken) {
    results.jiraOAuth = true;
    if (storedAtlassianToken.site_url) results.jiraSiteUrl = storedAtlassianToken.site_url;
    try {
      const validToken = await getValidAccessToken();
      if (validToken) {
        const res = await axios.get(`https://api.atlassian.com/ex/jira/${validToken.cloud_id}/rest/api/3/myself`, {
          headers: {
            Authorization: `Bearer ${validToken.access_token}`,
            Accept: 'application/json',
          },
          timeout: 5000,
        });
        results.jira = res.status === 200;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Jira OAuth status check failed:', error.response?.status, error.response?.data);
      } else {
        console.error('Jira OAuth status check failed:', error);
      }
      results.jira = false;
    }
  } else {
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
  }

  return c.json(results);
});

export default statusRoutes;
