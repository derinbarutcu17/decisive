const { app, BrowserWindow, Menu, Tray, nativeImage, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4321);
const DEV_DATA = path.join(__dirname, 'data.json');
const LEGACY_DATA_DIR = 'eisenhower';
let server = null;
let mainWindow = null;
let tray = null;

const WINDOW_SIZE_PRESETS = [
  { label: 'Compact', width: 1080, height: 720 },
  { label: 'Standard', width: 1200, height: 840 },
  { label: 'Wide', width: 1440, height: 900 },
];

const stopServer = () => {
  if (!server) return;
  try { server.kill(); } catch {}
  server = null;
};

const hasWindow = () => mainWindow && !mainWindow.isDestroyed();

const focusWindow = () => {
  if (!hasWindow()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const boundsForSize = (width, height) => {
  const current = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(current).workArea;
  const nextWidth = Math.min(width, workArea.width);
  const nextHeight = Math.min(height, workArea.height);
  const centeredX = Math.round(current.x + (current.width - nextWidth) / 2);
  const centeredY = Math.round(current.y + (current.height - nextHeight) / 2);
  return {
    x: Math.max(workArea.x, Math.min(centeredX, workArea.x + workArea.width - nextWidth)),
    y: Math.max(workArea.y, Math.min(centeredY, workArea.y + workArea.height - nextHeight)),
    width: nextWidth,
    height: nextHeight,
  };
};

const setWindowSize = ({ width, height }) => {
  if (!hasWindow()) return;
  mainWindow.setBounds(boundsForSize(width, height), true);
  focusWindow();
};

const fitWindowToDisplay = () => {
  if (!hasWindow()) return;
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const { x, y, width, height } = display.workArea;
  mainWindow.setBounds({ x, y, width, height }, true);
  focusWindow();
};

const buildTrayMenu = () => {
  const [currentWidth, currentHeight] = hasWindow() ? mainWindow.getSize() : [];
  return Menu.buildFromTemplate([
    {
      label: 'Window size',
      submenu: [
        ...WINDOW_SIZE_PRESETS.map(preset => ({
          label: `${preset.label}  ${preset.width} × ${preset.height}`,
          type: 'radio',
          checked: currentWidth === preset.width && currentHeight === preset.height,
          click: () => setWindowSize(preset),
        })),
        { type: 'separator' },
        { label: 'Fit to display', click: fitWindowToDisplay },
      ],
    },
    { type: 'separator' },
    { label: 'Quit Decisive', click: () => app.quit() },
  ]);
};

const createTray = () => {
  if (process.platform !== 'darwin' || tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'menu-bar-icon.png'));
  if (icon.isEmpty()) return;
  const menuBarIcon = icon.resize({ width: 18, height: 18, quality: 'best' });
  menuBarIcon.setTemplateImage(true);
  tray = new Tray(menuBarIcon);
  tray.setToolTip('Decisive');
  const openMenu = () => {
    focusWindow();
    tray?.popUpContextMenu(buildTrayMenu());
  };
  tray.on('click', openMenu);
  tray.on('right-click', openMenu);
};

const portUp = () => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 600 }, res => { res.destroy(); resolve(true); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

app.whenReady().then(async () => {
  const dataFile = app.isPackaged
    ? path.join(app.getPath('appData'), LEGACY_DATA_DIR, 'data.json')
    : path.join(__dirname, 'data.json');
  // first run of the packaged app: carry over history from the dev location
  if (app.isPackaged && !fs.existsSync(dataFile)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    if (fs.existsSync(DEV_DATA)) fs.copyFileSync(DEV_DATA, dataFile);
  }
  if (!(await portUp())) {
    server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DATA_FILE: dataFile },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50 && !(await portUp()); i++) await new Promise(r => setTimeout(r, 100));
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 840,
    // Keep the three-column desktop matrix in a usable range. Below this
    // width the browser layout switches to its compact 2×2 priority grid,
    // but the native app should not normally reach that recovery mode.
    minWidth: 1080,
    minHeight: 720,
    title: '',
    backgroundColor: '#0b0b0b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    autoHideMenuBar: true,
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
  createTray();
});

app.on('before-quit', () => {
  tray?.destroy();
  tray = null;
  stopServer();
});
app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});
