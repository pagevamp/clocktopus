import * as fs from 'fs';
import * as path from 'path';
import { getHookPaths } from './hook-paths.js';

export interface HuskyInstallResult {
  installed: boolean;
  reason?: 'no-husky-dir' | 'already-exists';
  path?: string;
}

export function huskyHookBody(): string {
  const { hookScript } = getHookPaths();
  return `#!/bin/sh
exec ${hookScript} "$@"
`;
}

export function installHuskyHook(cwd: string): HuskyInstallResult {
  const huskyDir = path.join(cwd, '.husky');
  if (!fs.existsSync(huskyDir) || !fs.statSync(huskyDir).isDirectory()) {
    return { installed: false, reason: 'no-husky-dir' };
  }
  const target = path.join(huskyDir, 'post-checkout');
  if (fs.existsSync(target)) {
    return { installed: false, reason: 'already-exists', path: target };
  }
  fs.writeFileSync(target, huskyHookBody(), { mode: 0o755 });
  return { installed: true, path: target };
}
