import inquirer from 'inquirer';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { extractTicket } from './branch-parser.js';
import { isRepoIgnored } from './hook-ignore.js';
import { isClockifyEnabled } from './credentials.js';
import { getJiraSummary } from './jira-summary.js';
import { getOpenSession } from './db.js';
import { matchProjectByTicket, LocalProject } from './project-matcher.js';
import { startTimer } from './start-timer.js';

export interface HookPromptResult {
  started: boolean;
  ticket: string | null;
  projectId: string | null;
  description: string | null;
  reason?: 'ignored' | 'declined' | 'no-ticket';
}

interface Options {
  cwd: string;
}

function readLocalProjects(): LocalProject[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const p = path.join(__dirname, '../data/local-projects.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as LocalProject[];
  } catch {
    return [];
  }
}

export async function runHookPrompt(branch: string, opts: Options): Promise<HookPromptResult> {
  if (isRepoIgnored(opts.cwd)) {
    return { started: false, ticket: null, projectId: null, description: null, reason: 'ignored' };
  }

  let ticket = extractTicket(branch);

  const openSession = getOpenSession();
  if (openSession) {
    const { continueAnyway } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continueAnyway',
        message: `A timer is already running. Stop it manually first, then re-checkout. Continue anyway?`,
        default: false,
      },
    ]);
    if (!continueAnyway) {
      return { started: false, ticket, projectId: null, description: null, reason: 'declined' };
    }
  }

  const promptMsg = ticket
    ? `Start timer for ${chalk.bold(ticket)} (branch: ${branch})?`
    : `Start timer for branch ${chalk.bold(branch)}?`;
  const { confirmStart } = await inquirer.prompt([
    { type: 'confirm', name: 'confirmStart', message: promptMsg, default: true },
  ]);
  if (!confirmStart) {
    return { started: false, ticket, projectId: null, description: null, reason: 'declined' };
  }

  if (!ticket) {
    const { ticket: entered } = await inquirer.prompt([
      { type: 'input', name: 'ticket', message: 'Enter ticket (empty to skip):' },
    ]);
    ticket = entered && entered.trim() ? entered.trim().toUpperCase() : null;
  }

  let defaultDescription = branch;
  if (ticket) {
    const summary = await getJiraSummary(ticket);
    if (summary) defaultDescription = summary;
    else defaultDescription = ticket;
  }

  const { description } = await inquirer.prompt([
    { type: 'input', name: 'description', message: 'Description:', default: defaultDescription },
  ]);

  let projectId: string | null = null;
  if (isClockifyEnabled()) {
    const projects = readLocalProjects();
    const matched = matchProjectByTicket(ticket, projects);
    if (matched) {
      projectId = matched.id;
      console.log(chalk.gray(`  Auto-selected project: ${matched.name}`));
    } else if (projects.length > 0) {
      const { projectId: picked } = await inquirer.prompt([
        {
          type: 'list',
          name: 'projectId',
          message: 'Which project?',
          choices: projects.map((p) => ({ name: p.name, value: p.id })),
        },
      ]);
      projectId = picked;
    } else {
      console.log(chalk.yellow('No local projects configured. Run `clocktopus start` once to populate.'));
      return { started: false, ticket, projectId: null, description, reason: 'no-ticket' };
    }
  }

  await startTimer({ description, ticket, projectId, billable: true });

  console.log(chalk.green(`Timer started${ticket ? ` for ${chalk.bold(ticket)}` : ''}.`));
  return { started: true, ticket, projectId, description };
}
