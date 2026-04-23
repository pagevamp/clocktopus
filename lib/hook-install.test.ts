import { describe, it, expect, beforeEach, afterEach, mock, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Store reals at top for restoration to prevent cross-file mock.module pollution.
const realOs = { ...os };
const realChildProcess = await import('child_process');

describe('installHook / uninstallHook', () => {
  let fakeHome: string;
  let execCalls: string[];

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clocktopus-hook-home-'));
    mock.module('os', () => ({ ...realOs, homedir: () => fakeHome }));
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

  afterAll(() => {
    mock.module('os', () => realOs);
    mock.module('child_process', () => realChildProcess);
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
