import { getJiraTicket } from './jira.js';

interface JiraIssue {
  fields?: { summary?: string };
}

export async function getJiraSummary(key: string): Promise<string | null> {
  try {
    const issue = (await getJiraTicket(key)) as JiraIssue | null;
    const summary = issue?.fields?.summary;
    return summary && summary.trim() ? summary.trim() : null;
  } catch {
    return null;
  }
}
