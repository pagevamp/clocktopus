# Git post-checkout hook — start timer on branch switch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user runs `git checkout <branch>` in any repo, prompt them in the same terminal to start a Clocktopus timer for that branch (auto-extracting Jira ticket from branch name).

**Architecture:** Ship a globally-installed `post-checkout` shell hook at `~/.clocktopus/hooks/post-checkout`, registered via `git config --global core.hooksPath` and `init.templateDir`. The hook invokes `clocktopus hook:prompt <branch>` in the user's current tty. Two new user-facing commands (`hook:install`, `hook:uninstall`) manage the hook. One internal command (`hook:prompt`) handles the prompt flow, reusing existing Clockify/Jira integrations.

**Tech Stack:** TypeScript (ESM), commander, inquirer, chalk, `lib/clockify.ts`, `lib/jira.ts`, `lib/db.ts`, `lib/credentials.ts`. Tests use `bun:test`.

**Design decisions (locked from brainstorm):**

- Ticket regex: `[A-Z][A-Z0-9]+-\d+` (e.g. `RST-100`, `ABC2-7`).
- No tty → hook exits silently (no desktop notification fallback in v1).
- Repo opt-out: `.clocktopus-ignore` file at repo root, or env `CLOCKTOPUS_HOOK_DISABLE=1` for one-off.
- Ticket not found in Jira → warn, still allow timer start with user-entered description.
- Running timer → ask user to stop it before starting the new one.
- Project auto-pick: if `local-projects.json` entry has `ticketPrefixes: ["RST"]`, match ticket prefix → skip project prompt. Else use existing interactive picker.
- Hook is only triggered for branch-checkout (`$3 == "1"`), not file-checkout.

---

## File Structure

**New files:**

- `lib/branch-parser.ts` — extract Jira ticket from branch name.
- `lib/branch-parser.test.ts`
- `lib/hook-paths.ts` — constants/paths for the global hook (dir, script path, template dir).
- `lib/hook-paths.test.ts`
- `lib/hook-ignore.ts` — `isRepoIgnored(cwd)` — checks `.clocktopus-ignore` walking up, and env var.
- `lib/hook-ignore.test.ts`
- `lib/hook-script.ts` — exports the shell-script body as a string constant (single source of truth).
- `lib/start-timer.ts` — shared non-interactive+interactive timer starter, reusable from `start` and `hook:prompt`.
- `lib/start-timer.test.ts`
- `lib/jira-summary.ts` — thin wrapper `getJiraSummary(key)` on top of existing `getJiraTicket` (null-safe).
- `lib/jira-summary.test.ts`
- `lib/hook-install.ts` — `installHook()` / `uninstallHook()` — writes script, runs `git config --global`.
- `lib/hook-install.test.ts`

**Modified files:**

- `index.ts` — add `hook:install`, `hook:uninstall`, `hook:prompt <branch>` commands. Refactor existing `start` action to call `startTimerInteractive` from `lib/start-timer.ts`.
- `data/local-projects.json` — optional new field per entry: `ticketPrefixes?: string[]` (backwards-compatible).

**No README/docs updates in this plan.** (User to request separately.)

---

## Task 1: Branch parser

**Files:**

- Create: `lib/branch-parser.ts`
- Create: `lib/branch-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/branch-parser.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { extractTicket } from './branch-parser.js';

describe('extractTicket', () => {
  it('returns ticket from plain ticket branch', () => {
    expect(extractTicket('RST-100')).toBe('RST-100');
  });

  it('returns ticket from feature/RST-100 branch', () => {
    expect(extractTicket('feature/RST-100-add-login')).toBe('RST-100');
  });

  it('returns ticket from bugfix/abc-123 lowercase (normalizes to uppercase)', () => {
    expect(extractTicket('bugfix/abc-123-fix')).toBe('ABC-123');
  });

  it('returns null when no ticket pattern present', () => {
    expect(extractTicket('feature/login')).toBeNull();
  });

  it('returns null for main/master/develop', () => {
    expect(extractTicket('main')).toBeNull();
    expect(extractTicket('master')).toBeNull();
    expect(extractTicket('develop')).toBeNull();
  });

  it('returns first match when multiple tickets in branch', () => {
    expect(extractTicket('RST-1-and-RST-2')).toBe('RST-1');
  });

  it('handles alphanumeric project key (ABC2-7)', () => {
    expect(extractTicket('ABC2-7-work')).toBe('ABC2-7');
  });

  it('returns null for empty string', () => {
    expect(extractTicket('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/branch-parser.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `branch-parser.ts`**

Create `lib/branch-parser.ts`:

```typescript
const TICKET_REGEX = /([A-Za-z][A-Za-z0-9]+-\d+)/;

export function extractTicket(branch: string): string | null {
  if (!branch) return null;
  const match = branch.match(TICKET_REGEX);
  return match ? match[1].toUpperCase() : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/branch-parser.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/branch-parser.ts lib/branch-parser.test.ts
git commit -m "feat(hook): add branch ticket parser"
```

---

## Task 2: Hook paths module

**Files:**

- Create: `lib/hook-paths.ts`
- Create: `lib/hook-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/hook-paths.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { getHookPaths } from './hook-paths.js';
import * as os from 'os';
import * as path from 'path';

describe('getHookPaths', () => {
  it('returns paths rooted at user home', () => {
    const p = getHookPaths();
    expect(p.rootDir).toBe(path.join(os.homedir(), '.clocktopus'));
    expect(p.hooksDir).toBe(path.join(os.homedir(), '.clocktopus', 'hooks'));
    expect(p.hookScript).toBe(path.join(os.homedir(), '.clocktopus', 'hooks', 'post-checkout'));
    expect(p.templateDir).toBe(path.join(os.homedir(), '.clocktopus', 'git-template'));
    expect(p.templateHookScript).toBe(path.join(os.homedir(), '.clocktopus', 'git-template', 'hooks', 'post-checkout'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/hook-paths.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `hook-paths.ts`**

Create `lib/hook-paths.ts`:

```typescript
import * as os from 'os';
import * as path from 'path';

export interface HookPaths {
  rootDir: string;
  hooksDir: string;
  hookScript: string;
  templateDir: string;
  templateHookScript: string;
}

export function getHookPaths(): HookPaths {
  const rootDir = path.join(os.homedir(), '.clocktopus');
  const hooksDir = path.join(rootDir, 'hooks');
  const templateDir = path.join(rootDir, 'git-template');
  return {
    rootDir,
    hooksDir,
    hookScript: path.join(hooksDir, 'post-checkout'),
    templateDir,
    templateHookScript: path.join(templateDir, 'hooks', 'post-checkout'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/hook-paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hook-paths.ts lib/hook-paths.test.ts
git commit -m "feat(hook): add hook paths module"
```

---

## Task 3: Repo-ignore check

**Files:**

- Create: `lib/hook-ignore.ts`
- Create: `lib/hook-ignore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/hook-ignore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isRepoIgnored } from './hook-ignore.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('isRepoIgnored', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clocktopus-ignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.CLOCKTOPUS_HOOK_DISABLE;
  });

  it('returns false when no marker and no env var', () => {
    expect(isRepoIgnored(tmpRoot)).toBe(false);
  });

  it('returns true when .clocktopus-ignore is in cwd', () => {
    fs.writeFileSync(path.join(tmpRoot, '.clocktopus-ignore'), '');
    expect(isRepoIgnored(tmpRoot)).toBe(true);
  });

  it('returns true when .clocktopus-ignore is in a parent dir', () => {
    const child = path.join(tmpRoot, 'sub', 'deep');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, '.clocktopus-ignore'), '');
    expect(isRepoIgnored(child)).toBe(true);
  });

  it('stops walking at filesystem root', () => {
    expect(isRepoIgnored('/')).toBe(false);
  });

  it('returns true when CLOCKTOPUS_HOOK_DISABLE=1', () => {
    process.env.CLOCKTOPUS_HOOK_DISABLE = '1';
    expect(isRepoIgnored(tmpRoot)).toBe(true);
  });

  it('CLOCKTOPUS_HOOK_DISABLE=0 does not ignore', () => {
    process.env.CLOCKTOPUS_HOOK_DISABLE = '0';
    expect(isRepoIgnored(tmpRoot)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/hook-ignore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `hook-ignore.ts`**

Create `lib/hook-ignore.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

const MARKER_FILE = '.clocktopus-ignore';

export function isRepoIgnored(cwd: string): boolean {
  if (process.env.CLOCKTOPUS_HOOK_DISABLE === '1') return true;
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, MARKER_FILE))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/hook-ignore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hook-ignore.ts lib/hook-ignore.test.ts
git commit -m "feat(hook): add repo-ignore check"
```

---

## Task 4: Hook script body

**Files:**

- Create: `lib/hook-script.ts`

The shell script runs in the user's terminal after `git checkout`. It calls `clocktopus hook:prompt <branch>` if a tty is attached. Stored as a string constant so `installHook` writes it and tests can assert its contents.

- [ ] **Step 1: Create `lib/hook-script.ts`**

```typescript
export const POST_CHECKOUT_SCRIPT = `#!/bin/sh
# Clocktopus post-checkout hook — auto-installed by \`clocktopus hook:install\`
# Fires only on branch checkout (flag "1"), not on file checkout.

if [ "$3" != "1" ]; then
  exit 0
fi

# Require an attached tty; otherwise the prompt has nowhere to render.
if ! [ -t 0 ] || ! [ -t 1 ]; then
  exit 0
fi

# Respect user opt-out.
if [ "$CLOCKTOPUS_HOOK_DISABLE" = "1" ]; then
  exit 0
fi

branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
[ -z "$branch" ] && exit 0

# Resolve clocktopus binary; silently skip if not installed globally.
if ! command -v clocktopus >/dev/null 2>&1; then
  exit 0
fi

clocktopus hook:prompt "$branch" </dev/tty >/dev/tty 2>&1 || true
exit 0
`;
```

- [ ] **Step 2: Commit**

```bash
git add lib/hook-script.ts
git commit -m "feat(hook): add post-checkout shell script body"
```

---

## Task 5: Jira summary fetch wrapper

**Files:**

- Create: `lib/jira-summary.ts`
- Create: `lib/jira-summary.test.ts`

Existing `lib/jira.ts` exports `getJiraTicket(key)` returning full issue or `null`. Wrap to return only the summary (or `null`) so `hook:prompt` can use it as a default description. The wrapper also catches the network-unreachable case.

- [ ] **Step 1: Write the failing test**

Create `lib/jira-summary.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/jira-summary.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `jira-summary.ts`**

Create `lib/jira-summary.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/jira-summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/jira-summary.ts lib/jira-summary.test.ts
git commit -m "feat(hook): add Jira summary fetch wrapper"
```

---

## Task 6: Shared start-timer flow

Extract the Clockify + Jira-only timer-start logic out of `index.ts`'s `start` command into a reusable async function. Both the existing `start` command and the new `hook:prompt` command call it.

**Files:**

- Create: `lib/start-timer.ts`
- Create: `lib/start-timer.test.ts`
- Modify: `index.ts` (later task).

- [ ] **Step 1: Write the failing test**

Create `lib/start-timer.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/start-timer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `start-timer.ts`**

Create `lib/start-timer.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/start-timer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/start-timer.ts lib/start-timer.test.ts
git commit -m "feat(hook): extract shared start-timer flow"
```

---

## Task 7: Hook install/uninstall module

**Files:**

- Create: `lib/hook-install.ts`
- Create: `lib/hook-install.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/hook-install.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('installHook / uninstallHook', () => {
  let fakeHome: string;
  let execCalls: string[];

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clocktopus-hook-home-'));
    mock.module('os', () => ({ ...os, homedir: () => fakeHome }));
    execCalls = [];
    mock.module('child_process', () => ({
      execSync: (cmd: string) => {
        execCalls.push(cmd);
        return '';
      },
    }));
  });

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('installHook creates executable script at ~/.clocktopus/hooks/post-checkout', async () => {
    const { installHook } = await import('./hook-install.js');
    await installHook();

    const scriptPath = path.join(fakeHome, '.clocktopus', 'hooks', 'post-checkout');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stat = fs.statSync(scriptPath);
    expect(stat.mode & 0o111).not.toBe(0);

    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('clocktopus hook:prompt');
  });

  it('installHook also writes script into git-template/hooks/', async () => {
    const { installHook } = await import('./hook-install.js');
    await installHook();
    const templateScript = path.join(fakeHome, '.clocktopus', 'git-template', 'hooks', 'post-checkout');
    expect(fs.existsSync(templateScript)).toBe(true);
  });

  it('installHook sets core.hooksPath and init.templateDir globally', async () => {
    const { installHook } = await import('./hook-install.js');
    await installHook();
    expect(execCalls.some((c) => c.includes('git config --global core.hooksPath'))).toBe(true);
    expect(execCalls.some((c) => c.includes('git config --global init.templateDir'))).toBe(true);
  });

  it('uninstallHook removes scripts and unsets git configs', async () => {
    const { installHook, uninstallHook } = await import('./hook-install.js');
    await installHook();
    await uninstallHook();
    const scriptPath = path.join(fakeHome, '.clocktopus', 'hooks', 'post-checkout');
    expect(fs.existsSync(scriptPath)).toBe(false);
    expect(execCalls.some((c) => c.includes('git config --global --unset core.hooksPath'))).toBe(true);
    expect(execCalls.some((c) => c.includes('git config --global --unset init.templateDir'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/hook-install.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `hook-install.ts`**

Create `lib/hook-install.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getHookPaths } from './hook-paths.js';
import { POST_CHECKOUT_SCRIPT } from './hook-script.js';

function writeHookScript(target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, POST_CHECKOUT_SCRIPT, { mode: 0o755 });
}

export async function installHook(): Promise<void> {
  const p = getHookPaths();
  writeHookScript(p.hookScript);
  writeHookScript(p.templateHookScript);
  execSync(`git config --global core.hooksPath "${p.hooksDir}"`, { stdio: 'ignore' });
  execSync(`git config --global init.templateDir "${p.templateDir}"`, { stdio: 'ignore' });
}

export async function uninstallHook(): Promise<void> {
  const p = getHookPaths();
  try {
    fs.rmSync(p.hookScript, { force: true });
  } catch {}
  try {
    fs.rmSync(p.templateHookScript, { force: true });
  } catch {}
  try {
    execSync('git config --global --unset core.hooksPath', { stdio: 'ignore' });
  } catch {}
  try {
    execSync('git config --global --unset init.templateDir', { stdio: 'ignore' });
  } catch {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/hook-install.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hook-install.ts lib/hook-install.test.ts
git commit -m "feat(hook): install/uninstall global git post-checkout hook"
```

---

## Task 8: Wire `hook:install` and `hook:uninstall` commands

**Files:**

- Modify: `index.ts` (add two commands near bottom, before `program.parse`)

- [ ] **Step 1: Add commands to `index.ts`**

Insert before `program.parse(process.argv);`:

```typescript
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
  });

program
  .command('hook:uninstall')
  .description('Remove the global git post-checkout hook.')
  .action(async () => {
    const { uninstallHook } = await import('./lib/hook-install.js');
    await uninstallHook();
    console.log(chalk.green('Clocktopus post-checkout hook removed.'));
  });
```

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: no TS errors.

- [ ] **Step 3: Smoke test install in a throwaway git repo**

Run:

```bash
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && git commit --allow-empty -m init -q && git checkout -b feature/RST-9 -q)
bun dist/index.js hook:install
git config --global --get core.hooksPath
ls -la ~/.clocktopus/hooks/post-checkout
bun dist/index.js hook:uninstall
git config --global --get core.hooksPath && echo "STILL SET - FAIL" || echo "unset OK"
```

Expected: install prints path, file exists and is +x, uninstall unsets config.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat(hook): add hook:install and hook:uninstall commands"
```

---

## Task 9: Project auto-pick by ticket prefix

Support optional `ticketPrefixes` field in `data/local-projects.json` so `hook:prompt` can auto-select a Clockify project when the ticket prefix matches.

**Files:**

- Create: `lib/project-matcher.ts`
- Create: `lib/project-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/project-matcher.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { matchProjectByTicket } from './project-matcher.js';

const projects = [
  { id: 'p1', name: 'Rocket', ticketPrefixes: ['RST', 'RS'] },
  { id: 'p2', name: 'Boost', ticketPrefixes: ['BST'] },
  { id: 'p3', name: 'Misc' },
];

describe('matchProjectByTicket', () => {
  it('returns matching project by prefix', () => {
    expect(matchProjectByTicket('RST-100', projects)?.id).toBe('p1');
    expect(matchProjectByTicket('BST-9', projects)?.id).toBe('p2');
  });

  it('is case-insensitive on prefix match', () => {
    expect(matchProjectByTicket('rst-100', projects)?.id).toBe('p1');
  });

  it('returns null when no prefix matches', () => {
    expect(matchProjectByTicket('ZZZ-1', projects)).toBeNull();
  });

  it('returns null when ticket is null', () => {
    expect(matchProjectByTicket(null, projects)).toBeNull();
  });

  it('ignores projects without ticketPrefixes', () => {
    expect(matchProjectByTicket('MISC-1', projects)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/project-matcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `project-matcher.ts`**

Create `lib/project-matcher.ts`:

```typescript
export interface LocalProject {
  id: string;
  name: string;
  ticketPrefixes?: string[];
}

export function matchProjectByTicket(ticket: string | null, projects: LocalProject[]): LocalProject | null {
  if (!ticket) return null;
  const prefix = ticket.split('-')[0]?.toUpperCase();
  if (!prefix) return null;
  for (const p of projects) {
    if (!p.ticketPrefixes) continue;
    if (p.ticketPrefixes.some((tp) => tp.toUpperCase() === prefix)) return p;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/project-matcher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/project-matcher.ts lib/project-matcher.test.ts
git commit -m "feat(hook): add project auto-pick by ticket prefix"
```

---

## Task 10: `hook:prompt` command (the main flow)

This is the command the shell hook invokes. It orchestrates all prior modules.

**Files:**

- Modify: `index.ts` (add `hook:prompt <branch>` command)

Flow:

1. `isRepoIgnored(process.cwd())` → exit 0 silent.
2. `extractTicket(branch)` → ticket or null.
3. Check if a session is already open:
   - `getOpenSession()` (Jira-only mode) or `clockify.getActiveTimer()` (Clockify mode).
   - If running: confirm prompt "Stop current timer (<desc>) and start <branch>? [y/N]". Default no. If no → exit 0.
4. Ask confirm: `Start timer for <branch>? [Y/n]`. Default yes. If no → exit 0.
5. If ticket null → ask "Enter ticket (empty to skip):".
6. If ticket present and Jira enabled (OAuth or Basic creds) → fetch summary via `getJiraSummary`.
7. Ask description (default = Jira summary or ticket or branch).
8. If Clockify enabled:
   - Load `local-projects.json`.
   - `matchProjectByTicket(ticket, projects)` — if match, use it. Else show inquirer list.
9. If a timer was running and user said stop: stop it using existing stop logic path (reuse `clockify.stopTimer` + Jira worklog if applicable, mirroring `index.ts` `stop` command).
10. Call `startTimer({ description, ticket, projectId, billable: true })`.
11. Print success.

- [ ] **Step 1: Write integration-style test for hook:prompt flow (happy path)**

Create `lib/hook-prompt.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';

describe('runHookPrompt (happy path, Clockify + Jira)', () => {
  beforeEach(() => {
    mock.module('./hook-ignore.js', () => ({ isRepoIgnored: () => false }));
    mock.module('./credentials.js', () => ({ isClockifyEnabled: () => true }));
    mock.module('./jira-summary.js', () => ({ getJiraSummary: async () => 'Fix login bug' }));
    mock.module('./db.js', () => ({ getOpenSession: () => null }));
    mock.module('../clockify.js', () => ({
      Clockify: class {
        getUser = async () => ({ defaultWorkspace: 'ws-1', id: 'u-1' });
        getActiveTimer = async () => null;
        startTimer = async () => ({ id: 'e-1' });
      },
    }));
    mock.module('inquirer', () => ({
      default: {
        prompt: mock(async (qs: Array<{ name: string }>) => {
          const answers: Record<string, unknown> = {};
          for (const q of qs) {
            if (q.name === 'confirmStart') answers[q.name] = true;
            else if (q.name === 'description') answers[q.name] = 'Fix login bug';
            else if (q.name === 'projectId') answers[q.name] = 'p1';
            else if (q.name === 'ticket') answers[q.name] = 'RST-100';
          }
          return answers;
        }),
      },
    }));
    mock.module('fs', () => ({
      promises: {
        readFile: async () => JSON.stringify([{ id: 'p1', name: 'Rocket', ticketPrefixes: ['RST'] }]),
        access: async () => {},
      },
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
  it('exits when repo is ignored', async () => {
    mock.module('./hook-ignore.js', () => ({ isRepoIgnored: () => true }));
    const { runHookPrompt } = await import('./hook-prompt.js');
    const result = await runHookPrompt('feature/RST-1', { cwd: '/tmp' });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('ignored');
  });

  it('exits when user declines start', async () => {
    mock.module('./hook-ignore.js', () => ({ isRepoIgnored: () => false }));
    mock.module('./credentials.js', () => ({ isClockifyEnabled: () => false }));
    mock.module('./db.js', () => ({ getOpenSession: () => null }));
    mock.module('inquirer', () => ({
      default: { prompt: async () => ({ confirmStart: false }) },
    }));
    const { runHookPrompt } = await import('./hook-prompt.js');
    const result = await runHookPrompt('RST-1', { cwd: '/tmp' });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('declined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/hook-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/hook-prompt.ts`**

Create `lib/hook-prompt.ts`:

```typescript
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

  // Check running session — branch-agnostic; we bail out of auto-stop logic in v1,
  // just inform user and let them stop manually. Simpler, less destructive.
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
      return {
        started: false,
        ticket,
        projectId: null,
        description: null,
        reason: 'declined',
      };
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
      {
        type: 'input',
        name: 'ticket',
        message: 'Enter ticket (empty to skip):',
      },
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
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: defaultDescription,
    },
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

  await startTimer({
    description,
    ticket,
    projectId,
    billable: true,
  });

  console.log(chalk.green(`Timer started${ticket ? ` for ${chalk.bold(ticket)}` : ''}.`));
  return { started: true, ticket, projectId, description };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/hook-prompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire command in `index.ts`**

Add before `program.parse(process.argv);`:

```typescript
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
```

- [ ] **Step 6: Build**

Run: `bun run build`
Expected: no TS errors.

- [ ] **Step 7: Commit**

```bash
git add lib/hook-prompt.ts lib/hook-prompt.test.ts index.ts
git commit -m "feat(hook): add hook:prompt command with Jira+Clockify flow"
```

---

## Task 11: Refactor existing `start` command to use `startTimer`

Currently `index.ts` `start` action inlines the Jira-only and Clockify flows. Replace the tail of its logic (after project selection) with a call to `startTimer` from `lib/start-timer.ts` so there's one source of truth for the DB/Clockify side-effects.

**Files:**

- Modify: `index.ts` (the `.command('start')` block)

- [ ] **Step 1: Refactor `start` action in `index.ts`**

Replace the existing `.command('start')` block body. The prompting stays inline (lists projects, picks one); the final start call uses the shared helper:

```typescript
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
    let projects: Project[] = await clockify.getProjects(workspaceId);
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
```

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: no TS errors.

- [ ] **Step 3: Manual smoke test (Clockify-enabled setup)**

Run: `bun dist/index.js start -j TEST-1 "smoke test"`
Expected: interactive project picker, then "Timer started for project: ...". Verify entry in Clockify dashboard and stop with `bun dist/index.js stop`.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "refactor(start): use shared startTimer helper"
```

---

## Task 12: End-to-end smoke test of the git hook

Verify the full loop: install hook → create repo → `git checkout -b RST-99` → prompt appears.

**Files:** none (manual test).

- [ ] **Step 1: Install globally from local build**

Run:

```bash
bun run build
bun link
# If already linked: skip. This exposes `clocktopus` on PATH from the local build.
which clocktopus
```

Expected: prints path to the linked binary.

- [ ] **Step 2: Install hook**

Run: `clocktopus hook:install`
Expected: success message, script exists at `~/.clocktopus/hooks/post-checkout`.

- [ ] **Step 3: Create throwaway repo and check out a ticket branch**

Run:

```bash
TMP=$(mktemp -d)
cd "$TMP"
git init -q
git commit --allow-empty -m init -q
git checkout -b RST-99 -q
```

Expected: after the `checkout -b`, the hook fires; you see the prompt "Start timer for RST-99 (branch: RST-99)?" in your terminal. Answering `n` exits silently. Answering `y` proceeds through the flow.

- [ ] **Step 4: Test repo opt-out**

Run:

```bash
touch .clocktopus-ignore
git checkout -b feature/RST-101 -q
```

Expected: no prompt.

- [ ] **Step 5: Test env opt-out**

Run:

```bash
rm .clocktopus-ignore
CLOCKTOPUS_HOOK_DISABLE=1 git checkout -b feature/RST-102 -q
```

Expected: no prompt.

- [ ] **Step 6: Test no-tty path**

Run:

```bash
git checkout main -q < /dev/null
```

Expected: no prompt, no error (stdin not a tty).

- [ ] **Step 7: Uninstall and confirm**

Run:

```bash
clocktopus hook:uninstall
git config --global --get core.hooksPath || echo "unset OK"
git checkout -b RST-103 -q
```

Expected: no prompt after uninstall.

- [ ] **Step 8: No commit needed** — this task is verification only.

---

## Task 13: Lint and full test run

- [ ] **Step 1: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: all tests pass (original `credentials.test.ts` + new ones).

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: no TS errors, `dist/` refreshed.

- [ ] **Step 4: If all green, no new commit needed.**

---

## Self-review notes (already applied above)

- Types across tasks are consistent: `LocalProject`, `StartTimerInput`, `HookPaths`.
- Function names match across tasks: `extractTicket`, `getHookPaths`, `isRepoIgnored`, `installHook`, `uninstallHook`, `startTimer`, `runHookPrompt`, `matchProjectByTicket`, `getJiraSummary`.
- Every step has concrete code or command, no "TBD"/"handle edge cases"/"etc".
- Task 11 (refactor `start`) intentionally after Task 10 — keeps the refactor isolated so the hook flow is proven working first, reducing blast radius.
- No README update in this plan — user to request separately.
- `init.templateDir` covers new clones/inits after install; existing repos pick up the hook via global `core.hooksPath` unless they set their own local `core.hooksPath` (rare, e.g. husky — acceptable miss, matches brainstorm).
