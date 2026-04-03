import axios from 'axios';
import { resolveCredential } from './credentials.js';
import { getAtlassianToken, updateAtlassianAccessToken } from './db.js';

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'read:me', 'offline_access'];
const REDIRECT_URI = 'http://localhost:4001/api/jira/callback';

function getClientCredentials() {
  const clientId = resolveCredential('ATLASSIAN_CLIENT_ID');
  const clientSecret = resolveCredential('ATLASSIAN_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET must be set.');
  }
  return { clientId, clientSecret };
}

export function getAtlassianAuthUrl(): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    prompt: 'consent',
  });
  return `${ATLASSIAN_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await axios.post(ATLASSIAN_TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
  });
  return res.data as { access_token: string; refresh_token: string; expires_in: number };
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getClientCredentials();
  const res = await axios.post(ATLASSIAN_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  return res.data as { access_token: string; expires_in: number };
}

export async function getAccessibleResources(accessToken: string) {
  const res = await axios.get(ATLASSIAN_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return res.data as Array<{ id: string; url: string; name: string }>;
}

export async function getValidAccessToken(): Promise<{ access_token: string; cloud_id: string } | null> {
  const token = getAtlassianToken();
  if (!token) return null;

  const expiresAt = new Date(token.expires_at).getTime();
  const bufferMs = 5 * 60 * 1000;

  if (Date.now() < expiresAt - bufferMs) {
    return { access_token: token.access_token, cloud_id: token.cloud_id };
  }

  try {
    const refreshed = await refreshAccessToken(token.refresh_token);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    updateAtlassianAccessToken(refreshed.access_token, newExpiresAt);
    return { access_token: refreshed.access_token, cloud_id: token.cloud_id };
  } catch (error) {
    console.error('Failed to refresh Atlassian token:', error instanceof Error ? error.message : error);
    return null;
  }
}
