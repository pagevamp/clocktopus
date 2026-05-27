import axios from 'axios';
import { resolveCredential } from './credentials.js';
import { getValidAccessToken } from './atlassian.js';

async function jiraApiRequest(endpoint: string, method: 'POST' | 'GET' | 'DELETE', body?: unknown) {
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
      if (axios.isAxiosError(error)) {
        console.error('Error making Jira API request (OAuth):', error.message, error.response?.data);
      } else if (error instanceof Error) {
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
    if (axios.isAxiosError(error)) {
      console.error('Error making Jira API request:', error.message, error.response?.data);
    } else if (error instanceof Error) {
      console.error('Error making Jira API request:', error.message);
    }
    return null;
  }
}

// Hard cap so a corrupted duration (orphaned session, missed idle, etc.)
// cannot post a multi-day worklog to Jira.
export const MAX_WORKLOG_SECONDS = 12 * 60 * 60; // 12h

export function worklogSecondsFromHours(hours: number): number | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return null;
  if (hours * 3600 > MAX_WORKLOG_SECONDS) return null;
  const seconds = Math.round(hours * 3600);
  if (seconds <= 0) return null;
  return seconds;
}

export async function stopJiraTimer(ticketId: string, timeSpentSeconds: number): Promise<{ id: string } | null> {
  if (!Number.isFinite(timeSpentSeconds) || timeSpentSeconds <= 0) {
    console.warn(`[jira] stopJiraTimer: refusing non-positive duration (${timeSpentSeconds}s) for ${ticketId}.`);
    return null;
  }
  if (timeSpentSeconds > MAX_WORKLOG_SECONDS) {
    const hours = (timeSpentSeconds / 3600).toFixed(1);
    console.warn(
      `[jira] stopJiraTimer: refusing oversized worklog (${timeSpentSeconds}s ≈ ${hours}h) for ${ticketId}. ` +
        `Cap is ${MAX_WORKLOG_SECONDS}s (${MAX_WORKLOG_SECONDS / 3600}h). Log manually via the dashboard if needed.`,
    );
    return null;
  }
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
  const response = await jiraApiRequest(`/issue/${ticketId}/worklog`, 'POST', body);
  const id = (response as { id?: string | number } | null)?.id;
  return id != null ? { id: String(id) } : null;
}

export async function deleteJiraWorklog(ticketId: string, worklogId: string): Promise<boolean> {
  const result = await jiraApiRequest(`/issue/${ticketId}/worklog/${worklogId}`, 'DELETE');
  return result !== null;
}

export async function getJiraTicket(ticketId: string) {
  return await jiraApiRequest(`/issue/${ticketId}`, 'GET');
}
