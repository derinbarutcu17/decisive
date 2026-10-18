#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appName = 'Decisive.app';
const installPath = path.join('/Applications', appName);
const appExecutable = path.join(installPath, 'Contents', 'MacOS', 'Decisive');
const builtPath = path.join(root, 'dist', 'mac-arm64', appName);
const dataPath = path.join(os.homedir(), 'Library', 'Application Support', 'eisenhower', 'data.json');
const backupDir = path.join(path.dirname(dataPath), 'backups');
const marker = 'eliminate-quadrant-toggle';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const stagePath = path.join('/Applications', `.Decisive.app.stage-${process.pid}`);
const previousPath = path.join('/Applications', `.Decisive.app.previous-${stamp}`);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    fail(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function appProcesses() {
  const output = run('ps', ['-Ao', 'command=']).stdout;
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(appExecutable));
}

function portOwners() {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '-iTCP:4321', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 1) return [];
  if (result.status !== 0) fail(`could not check port 4321: ${(result.stderr || '').trim()}`);
  return result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

function verifyBundle(bundlePath) {
  const appRoot = path.join(bundlePath, 'Contents', 'Resources', 'app');
  const htmlPath = path.join(appRoot, 'index.html');
  const jsPath = path.join(appRoot, 'app.js');
  const mainPath = path.join(appRoot, 'main.cjs');
  const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
  for (const file of [htmlPath, jsPath, mainPath, plistPath]) {
    if (!fs.existsSync(file)) fail(`app bundle is missing ${path.relative(bundlePath, file)}`);
  }
  if (!fs.readFileSync(htmlPath, 'utf8').includes(marker)) fail(`app bundle is missing UI marker ${marker}`);
  if (!fs.readFileSync(jsPath, 'utf8').includes('decisive.eliminateQuadrantVisible')) fail('app bundle is missing persisted quadrant setting code');
  if (!fs.readFileSync(mainPath, 'utf8').includes("app.getPath('appData')")) fail('app bundle no longer uses persistent Application Support data');
  if (fs.existsSync(path.join(appRoot, 'data.json'))) fail('private task data was copied into the app bundle');
  const bundleId = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plistPath]).stdout.trim();
  if (bundleId !== 'com.derin.eisenhower') fail(`unexpected bundle identifier: ${bundleId}`);
}

function backupTaskStore() {
  if (!fs.existsSync(dataPath)) fail(`task store is missing; refusing to install: ${dataPath}`);
  const content = fs.readFileSync(dataPath);
  JSON.parse(content.toString('utf8'));
  fs.mkdirSync(backupDir, { recursive: true });
  const snapshotPath = path.join(backupDir, `data-pre-app-rebuild-${stamp}.json`);
  fs.writeFileSync(snapshotPath, content, { flag: 'wx', mode: 0o600 });
  const contentDigest = digest(content);
  if (digest(fs.readFileSync(snapshotPath)) !== contentDigest) fail('task-store snapshot does not match the current data file');
  return { snapshotPath, digest: contentDigest };
}

function installBundle() {
  let previousMoved = false;
  let newInstalled = false;
  const failedPath = path.join('/Applications', `.Decisive.app.failed-${stamp}`);

  try {
    if (fs.existsSync(installPath)) {
      fs.renameSync(installPath, previousPath);
      previousMoved = true;
    }
    fs.renameSync(stagePath, installPath);
    newInstalled = true;
    verifyBundle(installPath);
  } catch (error) {
    if (newInstalled && fs.existsSync(installPath)) fs.renameSync(installPath, failedPath);
    if (previousMoved && fs.existsSync(previousPath)) fs.renameSync(previousPath, installPath);
    throw error;
  }

  return previousMoved ? previousPath : null;
}

function main() {
  if (process.platform !== 'darwin') fail('local macOS rebuilds can only run on macOS');

  const running = appProcesses();
  if (running.length) fail('Decisive is running. Inspect it with CUA, quit normally, then rerun npm run rebuild:local.');
  const listeners = portOwners();
  if (listeners.length) fail(`port 4321 is still in use by PID ${listeners.join(', ')}. Refusing to install over a live server.`);
  if (fs.existsSync(stagePath)) fail(`staging path already exists: ${stagePath}`);

  if (!fs.existsSync(dataPath)) fail(`task store is missing; refusing to build or install: ${dataPath}`);
  const taskBytes = fs.readFileSync(dataPath);
  JSON.parse(taskBytes.toString('utf8'));

  run('npm', ['run', 'dist'], {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    stdio: 'inherit',
  });
  verifyBundle(builtPath);

  if (appProcesses().length || portOwners().length) fail('Decisive or its server restarted during the build. Nothing was installed.');

  const storeBackup = backupTaskStore();
  if (storeBackup.digest !== digest(taskBytes)) fail('task data changed during the build. Nothing was installed.');

  let stageCreated = false;
  try {
    stageCreated = true;
    run('/usr/bin/ditto', [builtPath, stagePath]);
    verifyBundle(stagePath);
    if (appProcesses().length || portOwners().length) fail('Decisive or its server started before installation. Nothing was replaced.');

    const previousBundle = installBundle();
    if (digest(fs.readFileSync(dataPath)) !== storeBackup.digest) fail('task data changed during installation.');
    console.log(`Installed ${installPath}`);
    console.log(`Task data unchanged; snapshot: ${storeBackup.snapshotPath}`);
    if (previousBundle) console.log(`Previous app kept at ${previousBundle}`);
    console.log('Launch the installed app and verify its visible UI before declaring the rebuild complete.');
  } finally {
    if (stageCreated && fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`LOCAL REBUILD FAILED: ${error.message}`);
  process.exitCode = 1;
}
