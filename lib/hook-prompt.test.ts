import { describe, it, expect } from 'bun:test';
import { runHookPrompt, HookPromptDeps } from './hook-prompt.js';
import type { LocalProject } from './project-matcher.js';

function makeDeps(overrides: Partial<HookPromptDeps> = {}): HookPromptDeps {
  const answers: Record<string, unknown> = {
    confirmStart: true,
    continueAnyway: true,
    description: 'Fix login bug',
    projectId: 'p1',
    ticket: 'RST-100',
  };
  return {
    isRepoIgnored: () => false,
    isClockifyEnabled: () => true,
    getJiraSummary: async () => 'Fix login bug',
    getOpenSession: () => null,
    readProjects: (): LocalProject[] => [{ id: 'p1', name: 'Rocket', ticketPrefixes: ['RST'] }],
    prompt: async (qs) => {
      const out: Record<string, unknown> = {};
      for (const q of qs) {
        const name = q.name as string;
        if (name in answers) out[name] = answers[name];
      }
      return out;
    },
    startTimer: async () => ({
      mode: 'clockify',
      ticket: null,
      projectId: null,
      description: '',
    }),
    ...overrides,
  };
}

describe('runHookPrompt (happy path, Clockify + Jira)', () => {
  it('starts timer for branch with matching ticket', async () => {
    const result = await runHookPrompt('feature/RST-100-login', { cwd: '/tmp', deps: makeDeps() });
    expect(result.started).toBe(true);
    expect(result.ticket).toBe('RST-100');
    expect(result.projectId).toBe('p1');
    expect(result.description).toBe('Fix login bug');
  });
});

describe('runHookPrompt (exits early)', () => {
  it('exits when repo is ignored', async () => {
    const result = await runHookPrompt('feature/RST-1', {
      cwd: '/tmp',
      deps: makeDeps({ isRepoIgnored: () => true }),
    });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('ignored');
  });

  it('exits when user declines start', async () => {
    const result = await runHookPrompt('RST-1', {
      cwd: '/tmp',
      deps: makeDeps({
        isClockifyEnabled: () => false,
        prompt: async () => ({ confirmStart: false }),
      }),
    });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('declined');
  });
});
