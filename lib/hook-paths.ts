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
