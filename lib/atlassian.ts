import axios from 'axios';
import { resolveCredential } from './credentials.js';
import { getAtlassianToken, updateAtlassianAccessToken } from './db.js';

// Cloudflare Worker proxy that holds the client secret
const AUTH_PROXY_URL = 'https://clocktopus-auth.clocktopus.workers.dev/';

// Fallback: direct Atlassian API (when user provides their own credentials)
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const REDIRECT_URI = 'http://localhost:4001/api/jira/callback';

function hasLocalCredentials(): boolean {
  return !!(resolveCredential('ATLASSIAN_CLIENT_ID') && resolveCredential('ATLASSIAN_CLIENT_SECRET'));
}

export async function getAtlassianAuthUrl(): Promise<string> {
  if (hasLocalCredentials()) {
    const clientId = resolveCredential('ATLASSIAN_CLIENT_ID')!;
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope: 'read:jira-work write:jira-work read:jira-user read:me offline_access',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      prompt: 'consent',
    });
    return `https://auth.atlassian.com/authorize?${params.toString()}`;
  }

  // Use proxy to get auth URL
  const res = await axios.get(`${AUTH_PROXY_URL}/atlassian/auth-url`, {
    params: { redirect_uri: REDIRECT_URI },
  });
  return res.data.url;
}

export async function exchangeCodeForTokens(code: string) {
  if (hasLocalCredentials()) {
    const res = await axios.post(ATLASSIAN_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: resolveCredential('ATLASSIAN_CLIENT_ID'),
      client_secret: resolveCredential('ATLASSIAN_CLIENT_SECRET'),
      code,
      redirect_uri: REDIRECT_URI,
    });
    return res.data as { access_token: string; refresh_token: string; expires_in: number };
  }

  // Use proxy
  const res = await axios.post(`${AUTH_PROXY_URL}/atlassian/token`, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  return res.data as { access_token: string; refresh_token: string; expires_in: number };
}

export async function refreshAccessToken(refreshToken: string) {
  if (hasLocalCredentials()) {
    const res = await axios.post(ATLASSIAN_TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: resolveCredential('ATLASSIAN_CLIENT_ID'),
      client_secret: resolveCredential('ATLASSIAN_CLIENT_SECRET'),
      refresh_token: refreshToken,
    });
    return res.data as { access_token: string; expires_in: number };
  }

  // Use proxy
  const res = await axios.post(`${AUTH_PROXY_URL}/atlassian/token`, {
    grant_type: 'refresh_token',
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
