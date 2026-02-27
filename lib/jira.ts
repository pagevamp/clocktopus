import axios from 'axios';
import { resolveCredential } from './credentials.js';

async function jiraApiRequest(url: string, method: 'POST' | 'GET', body?: unknown) {
  const jiraApiUrl = resolveCredential('ATLASSIAN_URL');
  const jiraApiToken = resolveCredential('ATLASSIAN_API_TOKEN');
  const jiraUserEmail = resolveCredential('ATLASSIAN_EMAIL');

  if (!jiraApiUrl || !jiraApiToken || !jiraUserEmail) {
    console.error('Jira environment variables are not set. Please check your .env file.');
    return null;
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(`${jiraUserEmail}:${jiraApiToken}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    const response = await axios({
      method,
      url,
      data: body,
      headers,
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
  const jiraApiUrl = resolveCredential('ATLASSIAN_URL');
  const url = `${jiraApiUrl}/issue/${ticketId}/worklog`;
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
  return await jiraApiRequest(url, 'POST', body);
}

export async function getJiraTicket(ticketId: string) {
  const jiraApiUrl = resolveCredential('ATLASSIAN_URL');
  const url = `${jiraApiUrl}/issue/${ticketId}`;
  return await jiraApiRequest(url, 'GET');
}
