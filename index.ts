#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { completeLatestSession, getLatestSession, setSessionJiraWorklogId } from './lib/db.js';
import { isClockifyEnabled } from './lib/credentials.js';
import { ensureNativeAddons } from './lib/ensure-native-addons.js';
import { DASHBOARD_PORT, DASHBOARD_URL } from './lib/constants.js';
import type { Clockify as ClockifyType } from './clockify.js';

interface Project {
  id: string;
  name: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

// Clockify + Jira pull in axios (via follow-redirects), which in Bun triggers
// a tty WriteStream crash when loaded from a git hook context. Defer.
let _clockify: ClockifyType | null = null;
async function clockify(): Promise<ClockifyType> {
  if (!_clockify) {
    const { Clockify } = await import('./clockify.js');
    _clockify = new Clockify();
  }
  return _clockify;
}
async function stopJiraTimer(...args: Parameters<typeof import('./lib/jira.js').stopJiraTimer>) {
  const { stopJiraTimer: fn } = await import('./lib/jira.js');
  return fn(...args);
}

async function getLocalProjects(): Promise<Project[]> {
  const dataDir = path.join(__dirname, '../data');
  const localProjectsPath = path.join(dataDir, 'local-projects.json');
  try {
    // Ensure the data directory exists
    await fs.promises.mkdir(dataDir, { recursive: true });
    // If the file does not exist, create it with an empty array
    try {
      await fs.promises.access(localProjectsPath, fs.constants.F_OK);
    } catch {
      await fs.promises.writeFile(localProjectsPath, '[]', 'utf8');
    }
    const data = await fs.promises.readFile(localProjectsPath, 'utf8');
    return JSON.parse(data);
  } catch (_error: unknown) {
    return [];
  }
}

async function getWorkspaceAndUser() {
  const user = await (await clockify()).getUser();

  if (!user) {
    console.log(chalk.red('[index] Could not connect to Clockify. Please check your API key.'));

    process.exit(1);
  }

  const workspaceId = user.defaultWorkspace;
  const userId = user.id;

  return {
    workspaceId,
    userId,
  };
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
program.name('clocktopus').description('CLI time-tracking automation for Clockify').version(pkg.version);

program
  .command('start')
  .description('Start a new time entry. Select a project interactively.')
  .argument('[message]', 'Description for the time entry')
  .option('-j, --jira <ticket>', 'Jira ticket number')
  .option('--no-billable', 'Mark the time entry as non-billable')
  .action(async (message, options) => {
    const { startTimer } = await import('./lib/start-timer.js');

    if (!isClockifyEnabled()) {
      if (!options.jira) {
        console.error(chalk.red('Jira-only mode requires --jira <ticket>.'));
        process.exit(1);
      }
      const description = (message && String(message).trim()) || options.jira;
      await startTimer({ description, ticket: options.jira, projectId: null, billable: options.billable });
      console.log(chalk.green(`Timer started for ${chalk.bold(options.jira)} (Jira-only mode).`));
      return;
    }

    const { workspaceId } = await getWorkspaceAndUser();
    let projects: Project[] = await (await clockify()).getProjects(workspaceId);
    let localProjects = await getLocalProjects();

    if (localProjects.length === 0) {
      const allProjects = projects.map((p) => ({ id: p.id, name: p.name }));
      const localProjectsPath = path.join(__dirname, '../data/local-projects.json');
      fs.writeFileSync(localProjectsPath, JSON.stringify(allProjects, null, 2), 'utf8');
      console.log(
        chalk.green(
          'All projects have been saved to data/local-projects.json. Please edit this file to select your preferred projects.',
        ),
      );
      localProjects = allProjects;
    }

    if (localProjects.length > 0) {
      const localProjectIds = localProjects.map((p) => p.id);
      projects = projects.filter((p) => localProjectIds.includes(p.id));
    }

    if (!projects || projects.length === 0) {
      console.log(chalk.yellow('No projects found in your workspace.'));
      return;
    }

    const inquirer = (await import('inquirer')).default;
    const { selectedProjectId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedProjectId',
        message: 'Which project do you want to work on?',
        choices: projects.map((p: { name: string; id: string }) => ({ name: p.name, value: p.id })),
      },
    ]);

    await startTimer({
      description: message || options.jira || '',
      ticket: options.jira ?? null,
      projectId: selectedProjectId,
      billable: options.billable,
    });
    const projectName = projects.find((p) => p.id === selectedProjectId)?.name;
    console.log(chalk.green(`Timer started for project: ${chalk.bold(projectName)}`));
  });

program
  .command('stop')
  .description('Stop the currently running time entry.')
  .action(async () => {
    const latestSession = getLatestSession();

    if (isClockifyEnabled()) {
      const { workspaceId, userId } = await getWorkspaceAndUser();
      const stoppedEntry = await (await clockify()).stopTimer(workspaceId, userId);
      if (!stoppedEntry) {
        console.log(chalk.yellow('No timer was running.'));
        return;
      }
    } else {
      if (!latestSession || latestSession.completedAt) {
        console.log(chalk.yellow('No timer was running.'));
        return;
      }
    }

    const completedAt = new Date().toISOString();
    completeLatestSession(completedAt);

    if (latestSession?.jiraTicket) {
      const timeSpentSeconds = Math.round(
        (new Date(completedAt).getTime() - new Date(latestSession.startedAt).getTime()) / 1000,
      );
      if (timeSpentSeconds >= 60) {
        try {
          const worklog = await stopJiraTimer(latestSession.jiraTicket, timeSpentSeconds);
          if (worklog?.id) setSessionJiraWorklogId(latestSession.id, worklog.id);
        } catch (error) {
          console.error('Error stopping Jira timer:', error);
        }
      }
    }
    console.log(chalk.red('Timer stopped.'));
  });

program
  .command('status')
  .description('Check the status of the current timer.')
  .action(async () => {
    if (isClockifyEnabled()) {
      const { workspaceId, userId } = await getWorkspaceAndUser();
      const activeEntry = await (await clockify()).getActiveTimer(workspaceId, userId);

      if (activeEntry) {
        const startTime = new Date(activeEntry.timeInterval.start);
        const duration = (new Date().getTime() - startTime.getTime()) / 1000;
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);

        console.log(chalk.green('🕒 A timer is currently running.'));
        console.log(`   - ${chalk.bold('Project:')} ${activeEntry.project.name}`);
        console.log(`   - ${chalk.bold('Running for:')} ${hours}h ${minutes}m`);
        return;
      }
      console.log(chalk.yellow('No timer is currently running.'));
      return;
    }

    // Jira-only mode: read from DB
    const { getOpenSession } = await import('./lib/db.js');
    const open = getOpenSession();
    if (!open) {
      console.log(chalk.yellow('No timer is currently running.'));
      return;
    }
    const startTime = new Date(open.startedAt);
    const duration = (new Date().getTime() - startTime.getTime()) / 1000;
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    console.log(chalk.green('🕒 A timer is currently running (Jira-only mode).'));
    if (open.jiraTicket) console.log(`   - ${chalk.bold('Jira:')} ${open.jiraTicket}`);
    console.log(`   - ${chalk.bold('Description:')} ${open.description}`);
    console.log(`   - ${chalk.bold('Running for:')} ${hours}h ${minutes}m`);
  });

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

program
  .command('monitor:run', { hidden: true })
  .description('Run monitor in foreground (used by PM2).')
  .action(async () => {
    const creds = isClockifyEnabled() ? await getWorkspaceAndUser() : { workspaceId: '', userId: '' };
    const { workspaceId, userId } = creds;

    async function stopTimerAndLog(reason: string) {
      const clockifyOn = isClockifyEnabled();
      const latestSession = getLatestSession();

      if (clockifyOn) {
        const activeEntry = await (await clockify()).getActiveTimer(workspaceId, userId);
        if (!activeEntry) return false;
      } else {
        if (!latestSession || latestSession.completedAt) return false;
      }

      console.log(chalk.yellow(reason));
      const completedAt = new Date().toISOString();

      if (clockifyOn) {
        const stoppedEntry = await (await clockify()).stopTimer(workspaceId, userId);
        if (!stoppedEntry) return false;
      }

      completeLatestSession(completedAt, true);

      if (latestSession?.jiraTicket) {
        const timeSpentSeconds = Math.round(
          (new Date(completedAt).getTime() - new Date(latestSession.startedAt).getTime()) / 1000,
        );
        if (timeSpentSeconds >= 60) {
          try {
            const worklog = await stopJiraTimer(latestSession.jiraTicket, timeSpentSeconds);
            if (worklog?.id) setSessionJiraWorklogId(latestSession.id, worklog.id);
          } catch (err) {
            console.error('Error stopping Jira timer:', err);
          }
        }
      }

      console.log(chalk.red('Timer stopped.'));
      return true;
    }

    // Safer restart w/ cooldown; only resume a recent auto-completed session
    let lastResumeAt = 0;
    const RESUME_COOLDOWN_MS = 10_000;

    async function safeRestartTimerIfNeeded() {
      const now = Date.now();
      if (now - lastResumeAt < RESUME_COOLDOWN_MS) return;

      // Small delay lets services settle after wake/activity
      await sleep(800);

      const latestSession = getLatestSession();
      if (!latestSession) return;

      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const completedMs = latestSession.completedAt ? new Date(latestSession.completedAt).getTime() : 0;

      if (!latestSession.isAutoCompleted || completedMs <= twoHoursAgo) return;

      if (isClockifyEnabled()) {
        if (!latestSession.projectId) return;

        const activeEntry = await (await clockify()).getActiveTimer(workspaceId, userId);
        if (activeEntry) return;

        await (
          await clockify()
        ).startTimer(
          workspaceId,
          latestSession.projectId,
          latestSession.description,
          latestSession.jiraTicket ?? undefined,
        );
        console.log(chalk.green('Timer restarted for the last used project.'));
        lastResumeAt = Date.now();
        return;
      }

      // Jira-only resume: new DB session with a fresh uuid, same ticket
      if (!latestSession.jiraTicket) return;
      const { v4: uuidv4 } = await import('uuid');
      const { logSessionStart } = await import('./lib/db.js');
      const sessionId = uuidv4();
      const startedAt = new Date().toISOString();
      logSessionStart(
        sessionId,
        latestSession.projectId ?? null,
        latestSession.description,
        startedAt,
        latestSession.jiraTicket,
      );
      console.log(chalk.green(`Resumed Jira timer for ${latestSession.jiraTicket}.`));
      lastResumeAt = Date.now();
    }

    console.log(chalk.blue('Monitoring display events (Unified Log) and idle time...'));

    let isLocked = false;
    let pollInterval: NodeJS.Timeout | null = null;

    console.log(chalk.blue('Monitoring display/lock state (macos-notification-state) and idle time...'));

    try {
      if (process.platform === 'darwin') {
        const nsModule = await import('macos-notification-state');
        const getSessionState = nsModule.default?.getSessionState || nsModule.getSessionState;

        if (!getSessionState) {
          throw new Error('getSessionState not found in module');
        }

        // Verify the native addon actually works before setting up polling
        const initialState = getSessionState();
        console.log(chalk.gray(`Initial session state: ${initialState}`));

        pollInterval = setInterval(async () => {
          try {
            const state = getSessionState();
            const locked = state === 'SESSION_SCREEN_IS_LOCKED';

            if (locked && !isLocked) {
              isLocked = true;
              await stopTimerAndLog('Screen is locked/off. Stopping timer...');
            } else if (!locked && isLocked) {
              console.log(chalk.green('Screen is unlocked/on. Attempting to restart timer...'));
              await safeRestartTimerIfNeeded();
              isLocked = false;
            }
          } catch (error) {
            console.error('Error polling session state:', error);
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
              console.error(chalk.red('Display monitoring disabled due to repeated errors.'));
            }
          }
        }, 3000);
      } else {
        console.log(chalk.yellow('Display monitoring (lock state) is only supported on macOS. Skipping.'));
      }
    } catch (err) {
      console.error(chalk.red('Failed to load macos-notification-state. Display monitoring will be disabled.'));
      console.error(err);
    }

    const IDLE_THRESHOLD_SECONDS = 300; // 5 minutes
    let lastIdle = false;

    const idleInterval = setInterval(async () => {
      try {
        const idleModule = await import('desktop-idle');
        const idleTime = idleModule.default.getIdleTime();

        if (idleTime >= IDLE_THRESHOLD_SECONDS) {
          const stopped = await stopTimerAndLog(`System idle for ${Math.floor(idleTime)} seconds. Stopping timer...`);
          if (stopped) lastIdle = true;
        } else {
          // User active again → resume even if display log events were missed
          if (lastIdle) {
            await safeRestartTimerIfNeeded();
          }
          lastIdle = false;
        }
      } catch (e) {
        // swallow; desktop-idle can occasionally throw on wake races
      }
    }, 5000);

    function cleanupAndExit(code = 0) {
      try {
        clearInterval(idleInterval);
      } catch {}
      try {
        if (pollInterval) clearInterval(pollInterval);
      } catch {}
      process.exit(code);
    }

    process.on('SIGINT', () => {
      console.log(chalk.gray('\nStopping monitor...'));
      cleanupAndExit(0);
    });

    process.on('SIGTERM', () => cleanupAndExit(0));
  });

program
  .command('dash')
  .description(`Start the Clocktopus web dashboard on localhost:${DASHBOARD_PORT}.`)
  .action(async () => {
    const { startDashboard } = await import('./dashboard/server.js');
    startDashboard();
  });

const isDev = __dirname.includes('/Projects/') || __dirname.includes('/src/');
const MONITOR_PM2_NAME = isDev ? 'clocktopus-monitor-dev' : 'clocktopus-monitor';
const DASH_PM2_NAME = isDev ? 'clocktopus-dash-dev' : 'clocktopus-dash';
const pm2Bin = path.join(path.dirname(createRequire(import.meta.url).resolve('pm2')), 'bin', 'pm2');
const bunBin = (() => {
  try {
    return execSync('which bun', { encoding: 'utf-8' }).trim();
  } catch {
    return 'bun';
  }
})();
const pm2Cmd = `${bunBin} ${pm2Bin}`;

program
  .command('monitor')
  .description('Start idle monitor as a background daemon.')
  .action(async () => {
    ensureNativeAddons();

    const { execSync } = await import('child_process');
    const bunPath = execSync('which bun', { encoding: 'utf-8' }).trim();
    const scriptPath = path.join(__dirname, 'index.js');

    try {
      try {
        execSync(`${pm2Cmd} delete ${MONITOR_PM2_NAME}`, { stdio: 'ignore' });
      } catch {}

      execSync(`${pm2Cmd} start ${scriptPath} --name ${MONITOR_PM2_NAME} --interpreter ${bunPath} -- monitor:run`, {
        stdio: 'inherit',
      });
      console.log(chalk.green('Idle monitor started in background.'));
      console.log(chalk.gray('  Stop:   clocktopus monitor:stop'));
      console.log(chalk.gray('  Logs:   clocktopus monitor:logs'));
    } catch {
      console.error(chalk.red('Failed to start monitor.'));
    }
  });

program
  .command('monitor:stop')
  .description('Stop the idle monitor daemon.')
  .action(async () => {
    const { execSync } = await import('child_process');
    try {
      execSync(`${pm2Cmd} stop ${MONITOR_PM2_NAME}`, { stdio: 'inherit' });
    } catch {
      console.log(chalk.yellow('Monitor is not running.'));
    }
  });

program
  .command('monitor:logs')
  .description('Show idle monitor logs.')
  .action(async () => {
    const { execSync } = await import('child_process');
    try {
      execSync(`${pm2Cmd} logs ${MONITOR_PM2_NAME} --lines 50`, { stdio: 'inherit' });
    } catch {
      console.log(chalk.yellow('Monitor is not running.'));
    }
  });

program
  .command('serve')
  .description('Start dashboard as a background daemon (PM2).')
  .action(async () => {
    const { execSync } = await import('child_process');
    const bunPath = execSync('which bun', { encoding: 'utf-8' }).trim();
    const scriptPath = path.join(__dirname, 'index.js');

    try {
      try {
        execSync(`${pm2Cmd} delete ${DASH_PM2_NAME}`, { stdio: 'ignore' });
      } catch {}

      execSync(`${pm2Cmd} start ${scriptPath} --name ${DASH_PM2_NAME} --interpreter ${bunPath} -- dash`, {
        stdio: 'inherit',
      });
      console.log(chalk.green(`Dashboard running at ${DASHBOARD_URL}`));
      console.log(chalk.gray('  Stop:   clocktopus serve:stop'));
      console.log(chalk.gray('  Logs:   clocktopus serve:logs'));
    } catch {
      console.error(chalk.red('Failed to start dashboard daemon.'));
    }
  });

program
  .command('serve:stop')
  .description('Stop the dashboard daemon.')
  .action(async () => {
    const { execSync } = await import('child_process');
    try {
      execSync(`${pm2Cmd} stop ${DASH_PM2_NAME}`, { stdio: 'inherit' });
    } catch {
      console.log(chalk.yellow('Dashboard is not running.'));
    }
  });

program
  .command('serve:logs')
  .description('Show dashboard daemon logs.')
  .action(async () => {
    const { execSync } = await import('child_process');
    try {
      execSync(`${pm2Cmd} logs ${DASH_PM2_NAME} --lines 50`, { stdio: 'inherit' });
    } catch {
      console.log(chalk.yellow('Dashboard is not running.'));
    }
  });

program
  .command('hook:install')
  .description('Install global git post-checkout hook (prompts to start timer on branch switch).')
  .action(async () => {
    const { installHook } = await import('./lib/hook-install.js');
    await installHook();
    console.log(chalk.green('Clocktopus post-checkout hook installed globally.'));
    console.log(chalk.gray('  Disable per-repo: touch .clocktopus-ignore'));
    console.log(chalk.gray('  Disable per-session: export CLOCKTOPUS_HOOK_DISABLE=1'));
    console.log(chalk.gray('  Uninstall: clocktopus hook:uninstall'));
    console.log();
    console.log(chalk.yellow('Husky users: local core.hooksPath overrides global.'));
    console.log(chalk.gray('  Inside each husky repo, run: clocktopus hook:install-husky'));
  });

program
  .command('hook:uninstall')
  .description('Remove the global git post-checkout hook.')
  .action(async () => {
    const { uninstallHook } = await import('./lib/hook-install.js');
    await uninstallHook();
    console.log(chalk.green('Clocktopus post-checkout hook removed.'));
  });

program
  .command('hook:install-husky')
  .description('Write a .husky/post-checkout in the current repo that chains to the global hook.')
  .action(async () => {
    const { installHuskyHook } = await import('./lib/husky-install.js');
    const result = installHuskyHook(process.cwd());
    if (result.installed) {
      const verb = result.overwritten ? 'Overwrote' : 'Installed';
      console.log(chalk.green(`${verb} husky post-checkout at ${result.path}.`));
      console.log(chalk.gray('  Commit it so teammates using husky get it too.'));
      return;
    }
    if (result.reason === 'no-husky-dir') {
      console.error(chalk.red('No .husky/ directory found. Run from the root of a husky-enabled repo.'));
      process.exit(1);
    }
  });

program
  .command('hook:prompt <branch>')
  .description('(internal) Prompt to start a timer after git checkout.')
  .action(async (branch: string) => {
    const { runHookPrompt } = await import('./lib/hook-prompt.js');
    try {
      await runHookPrompt(branch, { cwd: process.cwd() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`Hook prompt failed: ${msg}`));
      process.exit(0); // never block git checkout
    }
  });

program.parse(process.argv);
