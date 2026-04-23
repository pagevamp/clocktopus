import chalk from 'chalk';
import { extractTicket } from './branch-parser.js';
import { isRepoIgnored as realIsRepoIgnored } from './hook-ignore.js';
import { isClockifyEnabled as realIsClockifyEnabled } from './credentials.js';
import { getJiraSummary as realGetJiraSummary } from './jira-summary.js';
import { getOpenSession as realGetOpenSession, getActiveProjects } from './db.js';
import { matchProjectByTicket, LocalProject } from './project-matcher.js';
import { simplePrompt } from './simple-prompt.js';
import { startTimer as realStartTimer, StartTimerInput, StartTimerResult } from './start-timer.js';

export interface HookPromptResult {
  started: boolean;
  ticket: string | null;
  projectId: string | null;
  description: string | null;
  reason?: 'ignored' | 'declined' | 'no-ticket';
}

export interface HookPromptDeps {
  isRepoIgnored?: (cwd: string) => boolean;
  isClockifyEnabled?: () => boolean;
  getJiraSummary?: (ticket: string) => Promise<string | null>;
  getOpenSession?: () => unknown;
  readProjects?: () => LocalProject[];
  prompt?: (qs: ReadonlyArray<Record<string, unknown>>) => Promise<Record<string, unknown>>;
  startTimer?: (input: StartTimerInput) => Promise<StartTimerResult>;
}

interface Options {
  cwd: string;
  deps?: HookPromptDeps;
}

function defaultReadProjects(): LocalProject[] {
  try {
    return getActiveProjects().map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

export async function runHookPrompt(branch: string, opts: Options): Promise<HookPromptResult> {
  const d = opts.deps ?? {};
  const isRepoIgnored = d.isRepoIgnored ?? realIsRepoIgnored;
  const isClockifyEnabled = d.isClockifyEnabled ?? realIsClockifyEnabled;
  const getJiraSummary = d.getJiraSummary ?? realGetJiraSummary;
  const getOpenSession = d.getOpenSession ?? realGetOpenSession;
  const readProjects = d.readProjects ?? defaultReadProjects;
  const prompt = d.prompt ?? simplePrompt;
  const startTimer = d.startTimer ?? realStartTimer;

  if (isRepoIgnored(opts.cwd)) {
    return { started: false, ticket: null, projectId: null, description: null, reason: 'ignored' };
  }

  let ticket = extractTicket(branch);

  const openSession = getOpenSession();
  if (openSession) {
    const answer = await prompt([
      {
        type: 'confirm',
        name: 'continueAnyway',
        message: `A timer is already running. Stop it manually first, then re-checkout. Continue anyway?`,
        default: false,
      },
    ]);
    if (!answer.continueAnyway) {
      return { started: false, ticket, projectId: null, description: null, reason: 'declined' };
    }
  }

  const promptMsg = ticket
    ? `Start timer for ${chalk.bold(ticket)} (branch: ${branch})?`
    : `Start timer for branch ${chalk.bold(branch)}?`;
  const confirmAnswer = await prompt([{ type: 'confirm', name: 'confirmStart', message: promptMsg, default: true }]);
  if (!confirmAnswer.confirmStart) {
    return { started: false, ticket, projectId: null, description: null, reason: 'declined' };
  }

  if (!ticket) {
    const ticketAnswer = await prompt([{ type: 'input', name: 'ticket', message: 'Enter ticket (empty to skip):' }]);
    const entered = typeof ticketAnswer.ticket === 'string' ? ticketAnswer.ticket : '';
    ticket = entered.trim() ? entered.trim().toUpperCase() : null;
  }

  let defaultDescription = branch;
  if (ticket) {
    const summary = await getJiraSummary(ticket);
    if (summary) defaultDescription = summary;
    else defaultDescription = ticket;
  }

  const descAnswer = await prompt([
    { type: 'input', name: 'description', message: 'Description:', default: defaultDescription },
  ]);
  const description = String(descAnswer.description);

  let projectId: string | null = null;
  if (isClockifyEnabled()) {
    const projects = readProjects();
    const matched = matchProjectByTicket(ticket, projects);
    if (matched) {
      projectId = matched.id;
      console.log(chalk.gray(`  Auto-selected project: ${matched.name}`));
    } else if (projects.length > 0) {
      const picked = await prompt([
        {
          type: 'list',
          name: 'projectId',
          message: 'Which project?',
          choices: projects.map((p) => ({ name: p.name, value: p.id })),
        },
      ]);
      projectId = String(picked.projectId);
    } else {
      console.log(chalk.yellow('No local projects configured. Run `clocktopus start` once to populate.'));
      return { started: false, ticket, projectId: null, description, reason: 'no-ticket' };
    }
  }

  await startTimer({ description, ticket, projectId, billable: true });

  console.log(chalk.green(`Timer started${ticket ? ` for ${chalk.bold(ticket)}` : ''}.`));
  return { started: true, ticket, projectId, description };
}
