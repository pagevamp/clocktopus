import { execSync } from 'child_process';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';

const require = createRequire(import.meta.url);

interface NativeModule {
  name: string;
  addonName: string; // The .node filename without extension
}

const NATIVE_MODULES: NativeModule[] = [
  { name: 'macos-notification-state', addonName: 'notificationstate' },
  { name: 'desktop-idle', addonName: 'desktopIdle' },
];

function hasBuiltAddon(moduleName: string, addonName: string): boolean {
  try {
    const modulePath = path.dirname(require.resolve(`${moduleName}/package.json`));
    const nodePath = path.join(modulePath, 'build', 'Release', `${addonName}.node`);
    return fs.existsSync(nodePath);
  } catch {
    return false;
  }
}

function findNodeGyp(): string | null {
  try {
    execSync('node-gyp --version', { stdio: 'ignore' });
    return 'node-gyp';
  } catch {}
  try {
    execSync('npx --version', { stdio: 'ignore' });
    return 'npx node-gyp';
  } catch {}
  return null;
}

function buildModule(moduleName: string, nodeGypCmd: string): boolean {
  let modulePath: string;
  try {
    modulePath = path.dirname(require.resolve(`${moduleName}/package.json`));
  } catch {
    return false;
  }

  if (!fs.existsSync(path.join(modulePath, 'binding.gyp'))) return false;

  try {
    console.log(`Building native addon: ${moduleName}...`);
    execSync(`${nodeGypCmd} rebuild`, { cwd: modulePath, stdio: 'inherit' });
    console.log(`Built ${moduleName} successfully.`);
    return true;
  } catch {
    return false;
  }
}

export function ensureNativeAddons(): void {
  if (process.platform !== 'darwin') return;

  const missing = NATIVE_MODULES.filter((m) => !hasBuiltAddon(m.name, m.addonName));
  if (missing.length === 0) return;

  console.log(`Native addons not built: ${missing.map((m) => m.name).join(', ')}. Attempting to build...`);

  const nodeGypCmd = findNodeGyp();
  if (!nodeGypCmd) {
    console.warn('Warning: node-gyp not found. Native addons could not be built.');
    console.warn('  Install Node.js (includes npx) then restart, or run:');
    console.warn('  bun pm trust clocktopus && bun install -g clocktopus');
    return;
  }

  const failed: string[] = [];
  for (const mod of missing) {
    if (!buildModule(mod.name, nodeGypCmd)) {
      failed.push(mod.name);
    }
  }

  if (failed.length > 0) {
    console.warn(`Warning: Failed to build: ${failed.join(', ')}. Monitor features may not work.`);
  }
}
