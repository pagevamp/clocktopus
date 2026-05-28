// Shared core for self-update across CLI, dashboard, and Tauri.
// This file covers version lookup + semver compare. Install spawn is added
// in Task 4.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn as nodeSpawn } from 'child_process';
import type { ChildProcess } from 'child_process';

const REGISTRY_URL = 'https://registry.npmjs.org/clocktopus/latest';
const REGISTRY_CACHE_MS = 5 * 60 * 1000;

interface RegistryFetchCache {
  at: number;
  value: LatestVersion | null;
}

let registryCache: RegistryFetchCache | null = null;

export interface LatestVersion {
  version: string;
  publishedAt: string;
}

export function getCurrentVersion(): string {
  // Walk up from this file until we find the clocktopus package.json. Works
  // both from dist/lib/updater.js (built) and lib/updater.ts (dev/test).
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here, prev = ''; dir !== prev; prev = dir, dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === 'clocktopus' && typeof pkg.version === 'string') return pkg.version;
      } catch {
        // keep walking up
      }
    }
  }
  return '0.0.0';
}

export async function fetchLatestVersion(opts: { force?: boolean } = {}): Promise<LatestVersion | null> {
  if (!opts.force && registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) {
    return registryCache.value;
  }
  let value: LatestVersion | null = null;
  try {
    const res = await fetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json()) as { version?: string; time?: Record<string, string> };
      if (body.version) {
        value = {
          version: body.version,
          publishedAt: body.time?.[body.version] ?? new Date().toISOString(),
        };
      }
    }
  } catch {
    value = null;
  }
  registryCache = { at: Date.now(), value };
  return value;
}

export function __resetFetchCacheForTests() {
  registryCache = null;
}

// Tiny semver compare. Returns 1 if a>b, -1 if a<b, 0 if equal. Treats a
// release with prerelease tag as lower than the same release without one,
// matching npm-style precedence (1.0.0-rc.1 < 1.0.0).
function cmpSemver(a: string, b: string): number {
  const parse = (s: string) => {
    const [main, pre] = s.split('-', 2);
    const nums = main.split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1; // release > prerelease
  if (pb.pre === '') return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return cmpSemver(latest, current) > 0;
}

type Spawner = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv },
) => Pick<ChildProcess, 'stdout' | 'stderr' | 'on'>;

let spawner: Spawner | null = null;

export function __setSpawnerForTests(fn: Spawner | null) {
  spawner = fn;
}

function resolveBun(): string {
  const home = process.env.HOME ?? '';
  const candidates = [path.join(home, '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('bun not found');
}

export interface RunUpdateOpts {
  onLog: (line: string) => void;
}

export async function runUpdate({ onLog }: RunUpdateOpts): Promise<void> {
  const bun = resolveBun();
  const home = process.env.HOME ?? '';
  const env = {
    ...process.env,
    PATH: `${path.join(home, '.bun', 'bin')}:${process.env.PATH ?? ''}`,
  };
  const useSpawn = spawner ?? (nodeSpawn as unknown as Spawner);
  const child = useSpawn(bun, ['i', '-g', 'clocktopus', '--trust'], { env });
  const stderrBuf: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line) onLog(line);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line) {
        stderrBuf.push(line);
        onLog(line);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    child.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(stderrBuf.join('\n') || `bun exited with code ${code}`));
    });
  });
}

// Best-effort: shell out to the existing `monitor:stop` CLI subcommand. Used
// by dashboard route + CLI subcommand before running the install. Silently
// succeeds when monitor isn't running, bun isn't installed, or the binary
// can't be located.
export async function stopMonitorIfRunning(): Promise<void> {
  const bun = (() => {
    try {
      return resolveBun();
    } catch {
      return null;
    }
  })();
  if (!bun) return;
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
  if (!fs.existsSync(cliPath)) return;
  await new Promise<void>((resolve) => {
    const child = nodeSpawn(bun, [cliPath, 'monitor:stop'], { stdio: 'ignore' });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}
