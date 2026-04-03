import axios from 'axios';
import { resolveCredential } from './credentials.js';
import { getValidAccessToken } from './atlassian.js';

async function jiraApiRequest(endpoint: string, method: 'POST' | 'GET', body?: unknown) {
  // Try OAuth first
  const oauthToken = await getValidAccessToken();

  if (oauthToken) {
    const baseUrl = `https://api.atlassian.com/ex/jira/${oauthToken.cloud_id}/rest/api/3`;
    const url = `${baseUrl}${endpoint}`;
    try {
      const response = await axios({
        method,
        url,
        data: body,
        headers: {
          Authorization: `Bearer ${oauthToken.access_token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error making Jira API request (OAuth):', error.message);
      }
      return null;
    }
  }

  // Fall back to Basic Auth
  const jiraApiUrl = resolveCredential('ATLASSIAN_URL');
  const jiraApiToken = resolveCredential('ATLASSIAN_API_TOKEN');
  const jiraUserEmail = resolveCredential('ATLASSIAN_EMAIL');

  if (!jiraApiUrl || !jiraApiToken || !jiraUserEmail) {
    console.error('Jira credentials are not configured. Use the dashboard to connect Atlassian or set env vars.');
    return null;
  }

  try {
    const response = await axios({
      method,
      url: `${jiraApiUrl}${endpoint}`,
      data: body,
      headers: {
        Authorization: `Basic ${Buffer.from(`${jiraUserEmail}:${jiraApiToken}`).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error making Jira API request:', error.message);
    }
    return null;
  }
}

export async function stopJiraTimer(ticketId: string, timeSpentSeconds: number) {
  const body = {
    timeSpentSeconds,
    comment: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Timer stopped from Clocktopus',
            },
          ],
        },
      ],
    },
  };
  console.log('Jira request body:', JSON.stringify(body, null, 2));
  return await jiraApiRequest(`/issue/${ticketId}/worklog`, 'POST', body);
}

export async function getJiraTicket(ticketId: string) {
  return await jiraApiRequest(`/issue/${ticketId}`, 'GET');
}
