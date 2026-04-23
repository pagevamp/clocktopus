import { isClockifyEnabled } from './credentials.js';

export interface StartTimerInput {
  description: string;
  ticket: string | null;
  projectId: string | null;
  billable: boolean;
}

export interface StartTimerResult {
  mode: 'clockify' | 'jira-only';
  ticket: string | null;
  projectId: string | null;
  description: string;
}

export async function startTimer(input: StartTimerInput): Promise<StartTimerResult> {
  if (!isClockifyEnabled()) {
    if (!input.ticket) {
      throw new Error('Jira-only mode: ticket required');
    }
    const { v4: uuidv4 } = await import('uuid');
    const { logSessionStart } = await import('./db.js');
    const sessionId = uuidv4();
    const startedAt = new Date().toISOString();
    const description = input.description?.trim() || input.ticket;
    logSessionStart(sessionId, null, description, startedAt, input.ticket);
    return { mode: 'jira-only', ticket: input.ticket, projectId: null, description };
  }

  if (!input.projectId) {
    throw new Error('Clockify mode: projectId required');
  }
  const { Clockify } = await import('../clockify.js');
  const clockify = new Clockify();
  const user = await clockify.getUser();
  if (!user) throw new Error('Clockify auth failed');
  await clockify.startTimer(
    user.defaultWorkspace,
    input.projectId,
    input.description,
    input.ticket ?? undefined,
    input.billable,
  );
  return {
    mode: 'clockify',
    ticket: input.ticket,
    projectId: input.projectId,
    description: input.description,
  };
}
