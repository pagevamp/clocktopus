import { Hono } from 'hono';
import { google } from 'googleapis';
import { getAuthenticatedClient, getAuthUrl, exchangeGoogleCode } from '../../lib/google.js';
import { storeToken } from '../../lib/db.js';
import { saveCredential } from '../../lib/credentials.js';

// Hardcoded — registered with Google OAuth; cannot vary with CLOCKTOPUS_PORT
// without re-registering the redirect URI in the Google Cloud console.
const DASHBOARD_REDIRECT_URI = 'http://localhost:4001/api/google/callback';
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

const googleRoutes = new Hono();

googleRoutes.get('/google/connect', async (c) => {
  try {
    const url = await getAuthUrl(DASHBOARD_REDIRECT_URI, SCOPES);
    return c.redirect(url);
  } catch {
    return c.json({ ok: false, error: 'Failed to generate Google auth URL.' }, 500);
  }
});

googleRoutes.get('/google/auth-url', async (c) => {
  try {
    const url = await getAuthUrl(DASHBOARD_REDIRECT_URI, SCOPES);
    return c.json({ url });
  } catch {
    return c.json({ ok: false, error: 'Failed to generate Google auth URL.' }, 500);
  }
});

googleRoutes.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('Missing authorization code.', 400);
  }

  try {
    const tokens = await exchangeGoogleCode(code, DASHBOARD_REDIRECT_URI);
    storeToken(tokens);

    // Fetch and store the user's email
    const oAuth2Client = getAuthenticatedClient(DASHBOARD_REDIRECT_URI);
    oAuth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const { data } = await oauth2.userinfo.get();
    if (data.email) {
      saveCredential('GOOGLE_ACCOUNT_EMAIL', data.email);
    }

    return c.redirect('/?google=connected');
  } catch {
    return c.text('Failed to exchange authorization code for tokens.', 500);
  }
});

export default googleRoutes;
