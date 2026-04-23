import { describe, it, expect, mock, beforeEach } from 'bun:test';

describe('startTimer', () => {
  beforeEach(() => {
    mock.module('./credentials.js', () => ({
      isClockifyEnabled: () => false,
    }));
    mock.module('./db.js', () => ({
      logSessionStart: mock(() => {}),
    }));
  });

  it('Jira-only mode: throws when ticket missing and clockify disabled', async () => {
    const { startTimer } = await import('./start-timer.js');
    await expect(startTimer({ description: 'work', ticket: null, projectId: null, billable: true })).rejects.toThrow(
      /ticket required/i,
    );
  });

  it('Jira-only mode: logs session when ticket provided', async () => {
    const logSessionStart = mock(() => {});
    mock.module('./db.js', () => ({ logSessionStart }));
    const { startTimer } = await import('./start-timer.js');
    const result = await startTimer({
      description: 'Fix login',
      ticket: 'RST-100',
      projectId: null,
      billable: true,
    });
    expect(result.mode).toBe('jira-only');
    expect(result.ticket).toBe('RST-100');
    expect(logSessionStart).toHaveBeenCalled();
  });

  it('Clockify mode: calls clockify.startTimer with all fields', async () => {
    const startTimerMock = mock(async () => ({ id: 'entry-1' }));
    mock.module('./credentials.js', () => ({ isClockifyEnabled: () => true }));
    mock.module('../clockify.js', () => ({
      Clockify: class {
        getUser = async () => ({ defaultWorkspace: 'ws-1', id: 'user-1' });
        startTimer = startTimerMock;
      },
    }));
    const { startTimer } = await import('./start-timer.js');
    const result = await startTimer({
      description: 'Fix login',
      ticket: 'RST-100',
      projectId: 'proj-1',
      billable: true,
    });
    expect(result.mode).toBe('clockify');
    expect(startTimerMock).toHaveBeenCalledWith('ws-1', 'proj-1', 'Fix login', 'RST-100', true);
  });
});
