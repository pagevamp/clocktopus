interface Env {
  ATLASSIAN_CLIENT_ID: string;
  ATLASSIAN_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // --- Atlassian ---

    if (url.pathname === '/atlassian/auth-url' && request.method === 'GET') {
      const redirectUri = url.searchParams.get('redirect_uri');
      if (!redirectUri) {
        return Response.json({ error: 'redirect_uri required' }, { status: 400, headers: CORS_HEADERS });
      }
      const params = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: env.ATLASSIAN_CLIENT_ID,
        scope: 'read:jira-work write:jira-work read:jira-user read:me offline_access',
        redirect_uri: redirectUri,
        response_type: 'code',
        prompt: 'consent',
      });
      return Response.json(
        { url: `https://auth.atlassian.com/authorize?${params.toString()}` },
        { headers: CORS_HEADERS },
      );
    }

    if (url.pathname === '/atlassian/token' && request.method === 'POST') {
      const body = (await request.json()) as {
        grant_type: string;
        code?: string;
        redirect_uri?: string;
        refresh_token?: string;
      };

      const payload: Record<string, string> = {
        client_id: env.ATLASSIAN_CLIENT_ID,
        client_secret: env.ATLASSIAN_CLIENT_SECRET,
        grant_type: body.grant_type,
      };

      if (body.grant_type === 'authorization_code') {
        if (!body.code || !body.redirect_uri) {
          return Response.json({ error: 'code and redirect_uri required' }, { status: 400, headers: CORS_HEADERS });
        }
        payload.code = body.code;
        payload.redirect_uri = body.redirect_uri;
      } else if (body.grant_type === 'refresh_token') {
        if (!body.refresh_token) {
          return Response.json({ error: 'refresh_token required' }, { status: 400, headers: CORS_HEADERS });
        }
        payload.refresh_token = body.refresh_token;
      } else {
        return Response.json({ error: 'unsupported grant_type' }, { status: 400, headers: CORS_HEADERS });
      }

      const tokenRes = await fetch(ATLASSIAN_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await tokenRes.text();
      return new Response(data, {
        status: tokenRes.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // --- Google ---

    if (url.pathname === '/google/auth-url' && request.method === 'GET') {
      const redirectUri = url.searchParams.get('redirect_uri');
      const scope = url.searchParams.get('scope');
      if (!redirectUri || !scope) {
        return Response.json({ error: 'redirect_uri and scope required' }, { status: 400, headers: CORS_HEADERS });
      }
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent',
      });
      return Response.json(
        { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
        { headers: CORS_HEADERS },
      );
    }

    if (url.pathname === '/google/token' && request.method === 'POST') {
      const body = (await request.json()) as {
        grant_type: string;
        code?: string;
        redirect_uri?: string;
        refresh_token?: string;
      };

      const formData = new URLSearchParams();
      formData.set('client_id', env.GOOGLE_CLIENT_ID);
      formData.set('client_secret', env.GOOGLE_CLIENT_SECRET);
      formData.set('grant_type', body.grant_type);

      if (body.grant_type === 'authorization_code') {
        if (!body.code || !body.redirect_uri) {
          return Response.json({ error: 'code and redirect_uri required' }, { status: 400, headers: CORS_HEADERS });
        }
        formData.set('code', body.code);
        formData.set('redirect_uri', body.redirect_uri);
      } else if (body.grant_type === 'refresh_token') {
        if (!body.refresh_token) {
          return Response.json({ error: 'refresh_token required' }, { status: 400, headers: CORS_HEADERS });
        }
        formData.set('refresh_token', body.refresh_token);
      } else {
        return Response.json({ error: 'unsupported grant_type' }, { status: 400, headers: CORS_HEADERS });
      }

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const data = await tokenRes.text();
      return new Response(data, {
        status: tokenRes.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return Response.json({ error: 'not found' }, { status: 404, headers: CORS_HEADERS });
  },
};
