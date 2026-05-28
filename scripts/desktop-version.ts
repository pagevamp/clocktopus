#!/usr/bin/env bun
/**
 * Bump the desktop app version across package.json, Cargo.toml, and
 * tauri.conf.json (similar to `npm version`). Refreshes Cargo.lock and,
 * by default, creates a git commit + tag so `git push --follow-tags`
 * triggers the Build Desktop App workflow.
 *
 * Usage:
 *   bun run scripts/desktop-version.ts <patch|minor|major|x.y.z> [options]
 *
 * Options:
 *   --no-commit   Skip git commit (also skips tag).
 *   --no-tag      Skip git tag (commit still made).
 *   --dry-run     Print intended new version and exit without touching files.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'desktop/package.json');
const CARGO = path.join(ROOT, 'desktop/src-tauri/Cargo.toml');
const TAURI_CONF = path.join(ROOT, 'desktop/src-tauri/tauri.conf.json');

const args = process.argv.slice(2);
const bumpArg = args.find((a) => !a.startsWith('--'));
const flags = new Set(args.filter((a) => a.startsWith('--')));

if (!bumpArg) {
  console.error('Usage: desktop-version <patch|minor|major|x.y.z> [--no-commit] [--no-tag] [--dry-run]');
  process.exit(1);
}

function readCurrent(): string {
  const pkg = JSON.parse(readFileSync(PKG, 'utf-8')) as { version?: string };
  if (!pkg.version) throw new Error(`No version in ${PKG}`);
  return pkg.version;
}

function parse(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Not a semver x.y.z: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bump(current: string, kind: string): string {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [maj, min, pat] = parse(current);
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'major') return `${maj + 1}.0.0`;
  throw new Error(`Unknown bump: ${kind}`);
}

function replaceVersionInJson(file: string, newVersion: string) {
  const text = readFileSync(file, 'utf-8');
  const updated = text.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
  if (text === updated) throw new Error(`No "version" field replaced in ${file}`);
  writeFileSync(file, updated);
}

function replaceVersionInCargoToml(file: string, newVersion: string) {
  const text = readFileSync(file, 'utf-8');
  // Match only the top-level package version (first `version = "..."` line).
  const updated = text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
  if (text === updated) throw new Error(`No top-level version replaced in ${file}`);
  writeFileSync(file, updated);
}

function run(cmd: string, cwd: string = ROOT) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function ensureCleanTree() {
  const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' }).trim();
  if (status) {
    console.error('Working tree is not clean. Commit or stash first:\n' + status);
    process.exit(1);
  }
}

const current = readCurrent();
const next = bump(current, bumpArg);

if (current === next) {
  console.error(`Already at ${next}.`);
  process.exit(1);
}

console.log(`desktop: ${current} → ${next}`);

if (flags.has('--dry-run')) process.exit(0);

const wantCommit = !flags.has('--no-commit');
const wantTag = wantCommit && !flags.has('--no-tag');

if (wantCommit) ensureCleanTree();

replaceVersionInJson(PKG, next);
replaceVersionInCargoToml(CARGO, next);
replaceVersionInJson(TAURI_CONF, next);

console.log('Refreshing Cargo.lock…');
run('cargo check --quiet', path.join(ROOT, 'desktop/src-tauri'));

if (!wantCommit) {
  console.log('Files updated. Skipping git commit (--no-commit).');
  process.exit(0);
}

run(`git add ${PKG} ${CARGO} ${TAURI_CONF} ${path.join(ROOT, 'desktop/src-tauri/Cargo.lock')}`);
run(`git commit -m "chore(desktop): bump version to ${next}"`);

if (wantTag) {
  run(`git tag v${next}`);
  console.log(`Created tag v${next}. Push with: git push origin HEAD --follow-tags`);
} else {
  console.log(`Committed. No tag (--no-tag).`);
}
