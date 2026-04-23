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
