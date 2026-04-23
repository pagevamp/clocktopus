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
