import { Hono } from 'hono';
import axios from 'axios';
import { saveCredential, setClockifyDisabled } from '../../lib/credentials.js';

const clockifyRoutes = new Hono();

clockifyRoutes.post('/clockify/enabled', async (c) => {
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  setClockifyDisabled(!enabled);
  return c.json({ ok: true });
});

clockifyRoutes.post('/clockify', async (c) => {
  const { apiKey } = await c.req.json<{ apiKey: string }>();

  if (!apiKey) {
    return c.json({ ok: false, error: 'API key is required.' }, 400);
  }

  try {
    const res = await axios.get('https://api.clockify.me/api/v1/user', {
      headers: { 'X-Api-Key': apiKey },
      timeout: 5000,
    });

    if (res.status === 200) {
      saveCredential('CLOCKIFY_API_KEY', apiKey);
      return c.json({ ok: true, user: res.data.name });
    }

    return c.json({ ok: false, error: 'Invalid API key.' });
  } catch {
    return c.json({ ok: false, error: 'Could not validate API key with Clockify.' });
  }
});

export default clockifyRoutes;
