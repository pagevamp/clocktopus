import { Hono } from 'hono';
import axios from 'axios';
import { saveCredential } from '../../lib/credentials.js';
import { storeAtlassianToken } from '../../lib/db.js';
import { getAtlassianAuthUrl, exchangeCodeForTokens, getAccessibleResources } from '../../lib/atlassian.js';

const jiraRoutes = new Hono();

// OAuth: redirect to Atlassian authorization (browser fallback)
jiraRoutes.get('/jira/connect', async (c) => {
  try {
    const authUrl = await getAtlassianAuthUrl();
    return c.redirect(authUrl);
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to generate auth URL.' }, 500);
  }
});

// OAuth: return auth URL as JSON (for desktop app)
jiraRoutes.get('/jira/auth-url', async (c) => {
  try {
    const url = await getAtlassianAuthUrl();
    return c.json({ url });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to generate auth URL.' }, 500);
  }
});

// OAuth: handle callback from Atlassian
jiraRoutes.get('/jira/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.redirect('/?jira=error&reason=no_code');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const resources = await getAccessibleResources(tokens.access_token);

    if (resources.length === 0) {
      return c.redirect('/?jira=error&reason=no_sites');
    }

    const site = resources[0];
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    storeAtlassianToken({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      cloud_id: site.id,
      site_url: site.url,
    });

    return c.redirect(`/?jira=connected&site=${encodeURIComponent(site.name)}`);
  } catch (error) {
    console.error('Atlassian OAuth callback error:', error instanceof Error ? error.message : error);
    return c.redirect('/?jira=error&reason=token_exchange_failed');
  }
});

// Basic Auth: manual API token setup (kept as fallback)
jiraRoutes.post('/jira', async (c) => {
  const { url, email, token } = await c.req.json<{ url: string; email: string; token: string }>();

  if (!url || !email || !token) {
    return c.json({ ok: false, error: 'All fields are required.' }, 400);
  }

  try {
    const res = await axios.get(`${url}/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        Accept: 'application/json',
      },
      timeout: 5000,
    });

    if (res.status === 200) {
      saveCredential('ATLASSIAN_URL', url);
      saveCredential('ATLASSIAN_EMAIL', email);
      saveCredential('ATLASSIAN_API_TOKEN', token);
      return c.json({ ok: true, user: res.data.displayName });
    }

    return c.json({ ok: false, error: 'Invalid credentials.' });
  } catch {
    return c.json({ ok: false, error: 'Could not validate credentials with Jira.' });
  }
});

export default jiraRoutes;
