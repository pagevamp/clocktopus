import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Credentials } from 'google-auth-library/build/src/auth/credentials.js';
import { resolveCredential } from './credentials.js';

const REDIRECT_URI = 'http://localhost:3005/oauth2callback';

export function getAuthenticatedClient(redirectUri?: string): OAuth2Client {
  const clientId = resolveCredential('GOOGLE_CLIENT_ID');
  const clientSecret = resolveCredential('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in your .env file');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri ?? REDIRECT_URI);
}

export async function getRefreshedToken(token: Credentials) {
  const oAuth2Client = getAuthenticatedClient();
  oAuth2Client.setCredentials(token);
  const refreshedToken = await oAuth2Client.refreshAccessToken();
  return refreshedToken.credentials;
}
