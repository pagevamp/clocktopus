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
