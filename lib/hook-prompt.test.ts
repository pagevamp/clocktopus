import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Capture real modules for afterAll restoration (Bun mock.module is process-wide).
const realHookIgnore = await import('./hook-ignore.js');
const realCredentials = await import('./credentials.js');
const realJiraSummary = await import('./jira-summary.js');
const realDb = await import('./db.js');
const realClockify = await import('../clockify.js');
const realInquirer = (await import('inquirer')).default;
const realFs = await import('fs');

describe('runHookPrompt (happy path, Clockify + Jira)', () => {
  beforeEach(() => {
    mock.module('./hook-ignore.js', () => ({ isRepoIgnored: () => false }));
    mock.module('./credentials.js', () => ({ isClockifyEnabled: () => true }));
    mock.module('./jira-summary.js', () => ({ getJiraSummary: async () => 'Fix login bug' }));
    mock.module('./db.js', () => ({ getOpenSession: () => null, logSessionStart: () => {} }));
    mock.module('../clockify.js', () => ({
      Clockify: class {
        getUser = async () => ({ defaultWorkspace: 'ws-1', id: 'u-1' });
        getActiveTimer = async () => null;
        startTimer = async () => ({ id: 'e-1' });
      },
    }));
    mock.module('inquirer', () => ({
      default: {
        prompt: async (qs: Array<{ name: string }>) => {
          const answers: Record<string, unknown> = {};
          for (const q of qs) {
            if (q.name === 'confirmStart') answers[q.name] = true;
            else if (q.name === 'description') answers[q.name] = 'Fix login bug';
            else if (q.name === 'projectId') answers[q.name] = 'p1';
            else if (q.name === 'ticket') answers[q.name] = 'RST-100';
            else if (q.name === 'continueAnyway') answers[q.name] = true;
          }
          return answers;
        },
      },
    }));
    mock.module('fs', () => ({
      ...realFs,
      readFileSync: () => JSON.stringify([{ id: 'p1', name: 'Rocket', ticketPrefixes: ['RST'] }]),
    }));
  });

  it('starts timer for branch with matching ticket', async () => {
    const { runHookPrompt } = await import('./hook-prompt.js');
    const result = await runHookPrompt('feature/RST-100-login', { cwd: '/tmp' });
    expect(result.started).toBe(true);
    expect(result.ticket).toBe('RST-100');
    expect(result.projectId).toBe('p1');
    expect(result.description).toBe('Fix login bug');
  });
});

describe('runHookPrompt (exits early)', () => {
  beforeEach(() => {
    mock.module('./hook-ignore.js', () => ({ isRepoIgnored: () => false }));
    mock.module('./credentials.js', () => ({ isClockifyEnabled: () => false }));
    mock.module('./db.js', () => ({ getOpenSession: () => null, logSessionStart: () => {} }));
  });

  it('exits when repo is ignored', async () => {
    mock.module('./hook-ignore.js', () => ({ isRepoIgnored: () => true }));
    const { runHookPrompt } = await import('./hook-prompt.js');
    const result = await runHookPrompt('feature/RST-1', { cwd: '/tmp' });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('ignored');
  });

  it('exits when user declines start', async () => {
    mock.module('inquirer', () => ({
      default: { prompt: async () => ({ confirmStart: false }) },
    }));
    const { runHookPrompt } = await import('./hook-prompt.js');
    const result = await runHookPrompt('RST-1', { cwd: '/tmp' });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('declined');
  });
});

// Restore real modules after all tests in this file to avoid cross-file pollution.
afterAll(() => {
  mock.module('./hook-ignore.js', () => realHookIgnore);
  mock.module('./credentials.js', () => realCredentials);
  mock.module('./jira-summary.js', () => realJiraSummary);
  mock.module('./db.js', () => realDb);
  mock.module('../clockify.js', () => realClockify);
  mock.module('inquirer', () => ({ default: realInquirer }));
  mock.module('fs', () => realFs);
});
