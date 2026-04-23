import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installHuskyHook, huskyHookBody } from './husky-install.js';

describe('installHuskyHook', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clocktopus-husky-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns no-husky-dir when .husky does not exist', () => {
    const result = installHuskyHook(tmp);
    expect(result.installed).toBe(false);
    expect(result.reason).toBe('no-husky-dir');
  });

  it('writes .husky/post-checkout when .husky exists', () => {
    fs.mkdirSync(path.join(tmp, '.husky'));
    const result = installHuskyHook(tmp);
    expect(result.installed).toBe(true);
    expect(result.overwritten).toBe(false);
    expect(result.path).toBe(path.join(tmp, '.husky', 'post-checkout'));
    expect(fs.existsSync(result.path!)).toBe(true);
    const stat = fs.statSync(result.path!);
    expect(stat.mode & 0o111).not.toBe(0);
    const body = fs.readFileSync(result.path!, 'utf8');
    expect(body).toContain('#!/bin/sh');
    expect(body).toContain('.clocktopus/hooks/post-checkout');
  });

  it('overwrites existing post-checkout and flags overwritten=true', () => {
    fs.mkdirSync(path.join(tmp, '.husky'));
    const target = path.join(tmp, '.husky', 'post-checkout');
    fs.writeFileSync(target, 'existing content');
    const result = installHuskyHook(tmp);
    expect(result.installed).toBe(true);
    expect(result.overwritten).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toContain('.clocktopus/hooks/post-checkout');
  });
});

describe('huskyHookBody', () => {
  it('contains shebang and exec of global hook path', () => {
    const body = huskyHookBody();
    expect(body).toContain('#!/bin/sh');
    expect(body).toContain('.clocktopus/hooks/post-checkout');
  });
});
