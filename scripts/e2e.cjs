#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electron = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}

function findPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start at ${url}`);
}

async function main() {
  if (!fs.existsSync(electron)) throw new Error('Electron is not installed; run npm ci first');
  const port = await findPort();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'decisive-verify-'));
  const dataFile = path.join(tempDir, 'data.json');
  await fsp.copyFile(path.join(root, 'examples', 'demo-data.json'), dataFile);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: 'inherit',
  });

  const runElectron = (script, extraEnv = {}) => {
    const command = process.platform === 'linux' && !process.env.DISPLAY && fs.existsSync('/usr/bin/xvfb-run')
      ? '/usr/bin/xvfb-run'
      : electron;
    const args = command === electron ? [script] : ['-a', electron, script];
    return run(command, args, { TEST_URL: baseUrl, ...extraEnv });
  };

  try {
    await waitForServer(baseUrl);
    await runElectron('test/scatter.test.cjs');
    await runElectron('test/scroll.test.cjs');
    await runElectron('test/layout-audit.cjs');
    await runElectron('test/label-audit.cjs');
    const created = await (await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'verification task', quadrant: 'do' }),
    })).json();
    await runElectron('test/ui.test.cjs', { TEST_TASK_ID: created.id });
  } finally {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`E2E VERIFY FAIL: ${error.message}`);
  process.exitCode = 1;
});
