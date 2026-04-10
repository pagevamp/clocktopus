#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const nativeModules = ['macos-notification-state', 'desktop-idle'];

function findNodeGyp() {
  // Try plain node-gyp first (globally installed)
  try {
    execSync('node-gyp --version', { stdio: 'ignore' });
    return 'node-gyp';
  } catch {}

  // Try npx (comes with Node.js)
  try {
    execSync('npx --version', { stdio: 'ignore' });
    return 'npx node-gyp';
  } catch {}

  return null;
}

function rebuildModule(moduleName, nodeGypCmd) {
  let modulePath;
  try {
    modulePath = path.dirname(require.resolve(`${moduleName}/package.json`));
  } catch {
    // Module not installed (e.g. optional dependency on wrong platform)
    return;
  }

  const bindingGyp = path.join(modulePath, 'binding.gyp');
  try {
    require('fs').accessSync(bindingGyp);
  } catch {
    // No binding.gyp, not a native module
    return;
  }

  try {
    console.log(`Building native addon: ${moduleName}...`);
    execSync(`${nodeGypCmd} rebuild`, { cwd: modulePath, stdio: 'inherit' });
    console.log(`Built ${moduleName} successfully.`);
  } catch (err) {
    console.warn(`Warning: Failed to build ${moduleName}. The monitor feature may not work.`);
    console.warn(`  You can try manually: cd ${modulePath} && npx node-gyp rebuild`);
  }
}

// Only build on macOS — these are macOS-only native addons
if (process.platform !== 'darwin') {
  console.log('Skipping native addon build (not macOS).');
  process.exit(0);
}

const nodeGypCmd = findNodeGyp();
if (!nodeGypCmd) {
  console.warn('Warning: node-gyp not found. Native addons were not built.');
  console.warn('  Install node-gyp: npm install -g node-gyp');
  console.warn('  Then rebuild: cd node_modules/macos-notification-state && node-gyp rebuild');
  process.exit(0);
}

for (const mod of nativeModules) {
  rebuildModule(mod, nodeGypCmd);
}
