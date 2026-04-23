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
