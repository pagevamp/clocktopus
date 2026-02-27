import { Hono } from 'hono';
import axios from 'axios';
import { saveCredential } from '../../lib/credentials.js';

const jiraRoutes = new Hono();

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
