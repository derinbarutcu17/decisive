const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4323/';
const outputDir = path.resolve(process.env.OUTPUT_DIR || 'docs/images');

async function capture(window, name) {
  await new Promise(resolve => setTimeout(resolve, 700));
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, name), image.toPNG());
}

app.whenReady().then(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    backgroundColor: '#0b0b0b',
  });
  await window.loadURL(baseUrl);
  await capture(window, 'decisive-desktop.png');
  await window.setSize(390, 844);
  await window.loadURL(`${baseUrl}?iphone=1`);
  await capture(window, 'decisive-iphone.png');
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
