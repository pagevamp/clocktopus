import { describe, it, expect, mock, afterAll } from 'bun:test';
import * as realJira from './jira.js';

describe('getJiraSummary', () => {
  it('returns summary string when Jira returns issue', async () => {
    mock.module('./jira.js', () => ({
      getJiraTicket: async () => ({ fields: { summary: 'Fix login bug' } }),
    }));
    const { getJiraSummary } = await import('./jira-summary.js');
    expect(await getJiraSummary('RST-100')).toBe('Fix login bug');
  });

  it('returns null when Jira returns null (not found / not configured)', async () => {
    mock.module('./jira.js', () => ({
      getJiraTicket: async () => null,
    }));
    const { getJiraSummary } = await import('./jira-summary.js');
    expect(await getJiraSummary('RST-404')).toBeNull();
  });

  it('returns null when Jira response has no summary field', async () => {
    mock.module('./jira.js', () => ({
      getJiraTicket: async () => ({ fields: {} }),
    }));
    const { getJiraSummary } = await import('./jira-summary.js');
    expect(await getJiraSummary('RST-100')).toBeNull();
  });

  it('returns null when getJiraTicket throws', async () => {
    mock.module('./jira.js', () => ({
      getJiraTicket: async () => {
        throw new Error('network down');
      },
    }));
    const { getJiraSummary } = await import('./jira-summary.js');
    expect(await getJiraSummary('RST-100')).toBeNull();
  });

  afterAll(() => {
    mock.module('./jira.js', () => realJira);
  });
});
