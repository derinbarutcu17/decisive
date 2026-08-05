const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4321);
const DEV_DATA = path.join(__dirname, 'data.json');
let server = null;
const stopServer = () => {
  if (!server) return;
  try { server.kill(); } catch {}
  server = null;
};

const portUp = () => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 600 }, res => { res.destroy(); resolve(true); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

app.whenReady().then(async () => {
  const dataFile = app.isPackaged ? path.join(app.getPath('userData'), 'data.json') : path.join(__dirname, 'data.json');
  // first run of the packaged app: carry over history from the dev location
  if (app.isPackaged && !fs.existsSync(dataFile) && fs.existsSync(DEV_DATA)) fs.copyFileSync(DEV_DATA, dataFile);
  if (!(await portUp())) {
    server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DATA_FILE: dataFile },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50 && !(await portUp()); i++) await new Promise(r => setTimeout(r, 100));
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 920,
    minHeight: 640,
    title: '',
    backgroundColor: '#0b0b0b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    autoHideMenuBar: true,
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
  win.on('closed', () => app.quit());
});

app.on('before-quit', stopServer);
app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});
