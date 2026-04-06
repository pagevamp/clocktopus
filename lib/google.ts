import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Credentials } from 'google-auth-library/build/src/auth/credentials.js';
import { resolveCredential } from './credentials.js';
import axios from 'axios';

const REDIRECT_URI = 'http://localhost:3005/oauth2callback';
const AUTH_PROXY_URL = 'https://clocktopus-auth.clocktopus.workers.dev';

function hasLocalCredentials(): boolean {
  return !!(resolveCredential('GOOGLE_CLIENT_ID') && resolveCredential('GOOGLE_CLIENT_SECRET'));
}

export function getAuthenticatedClient(redirectUri?: string): OAuth2Client {
  if (hasLocalCredentials()) {
    return new google.auth.OAuth2(
      resolveCredential('GOOGLE_CLIENT_ID'),
      resolveCredential('GOOGLE_CLIENT_SECRET'),
      redirectUri ?? REDIRECT_URI,
    );
  }

  // When using proxy, create client with placeholder — token exchange goes through proxy
  return new google.auth.OAuth2('proxy', 'proxy', redirectUri ?? REDIRECT_URI);
}

export async function getAuthUrl(redirectUri?: string, scopes?: string[]): Promise<string> {
  const scope = (scopes || ['https://www.googleapis.com/auth/calendar.readonly']).join(' ');

  if (hasLocalCredentials()) {
    const client = getAuthenticatedClient(redirectUri);
    return client.generateAuthUrl({ access_type: 'offline', scope, prompt: 'consent' });
  }

  // Use proxy
  const res = await axios.get(`${AUTH_PROXY_URL}/google/auth-url`, {
    params: { redirect_uri: redirectUri ?? REDIRECT_URI, scope },
  });
  return res.data.url;
}

export async function exchangeGoogleCode(code: string, redirectUri?: string): Promise<Credentials> {
  if (hasLocalCredentials()) {
    const client = getAuthenticatedClient(redirectUri);
    const { tokens } = await client.getToken(code);
    return tokens;
  }

  // Use proxy
  const res = await axios.post(`${AUTH_PROXY_URL}/google/token`, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri ?? REDIRECT_URI,
  });
  return res.data as Credentials;
}

export async function getRefreshedToken(token: Credentials): Promise<Credentials> {
  if (hasLocalCredentials()) {
    const client = getAuthenticatedClient();
    client.setCredentials(token);
    const refreshedToken = await client.refreshAccessToken();
    return refreshedToken.credentials;
  }

  // Use proxy for refresh
  if (!token.refresh_token) throw new Error('No refresh token available');
  const res = await axios.post(`${AUTH_PROXY_URL}/google/token`, {
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
  });
  return res.data as Credentials;
}
