const { app, BrowserWindow } = require('electron');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:4323/';
const states = [
  { name: 'wide-matrix', width: 1440, height: 960, query: '' },
  { name: 'wide-scatter', width: 1440, height: 960, query: '?view=scatter' },
  { name: 'compact-matrix', width: 920, height: 720, query: '' },
  { name: 'compact-scatter', width: 920, height: 720, query: '?view=scatter' },
  { name: 'iphone-matrix', width: 390, height: 844, query: '?iphone=1' },
  { name: 'iphone-scatter', width: 390, height: 844, query: '?iphone=1&view=scatter' },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 960 });
  const report = [];
  for (const state of states) {
    await win.setSize(state.width, state.height);
    await win.loadURL(baseUrl + state.query);
    await new Promise(resolve => setTimeout(resolve, 180));
    const snapshot = await win.webContents.executeJavaScript(`(() => {
      const rect = selector => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const consoleRect = document.querySelector('#console')?.getBoundingClientRect();
      const identity = document.querySelector('.app-identity')?.getBoundingClientRect();
      const consoleCenter = document.querySelector('#console') ? document.querySelector('#console').getBoundingClientRect().left + document.querySelector('#console').clientWidth / 2 : null;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight },
        identityCenterDelta: identity && consoleCenter != null ? identity.left + identity.width / 2 - consoleCenter : null,
        rects: {
          console: rect('#console'),
          identity: rect('.app-identity'),
          brand: rect('.app-brand'),
          actions: rect('.header-actions'),
          capture: rect('.capture-control'),
          layout: rect('#layout'),
          done: rect('#done'),
          matrix: rect('#matrix'),
          scatter: rect('#scatter-view'),
          scatterShell: rect('.scatter-chart-shell'),
          plot: rect('#scatter-plot'),
        },
        quadrants: [...document.querySelectorAll('#matrix > .quadrant')].map(node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; }),
        scatterSquareDelta: (() => { const r = document.querySelector('#scatter-plot')?.getBoundingClientRect(); return r ? Math.abs(r.width - r.height) : null; })(),
        scatterContained: (() => {
          const plot = document.querySelector('#scatter-plot')?.getBoundingClientRect();
          const view = document.querySelector('#scatter-view')?.getBoundingClientRect();
          return !plot || !view || (plot.left >= view.left - 1 && plot.right <= view.right + 1 && plot.top >= view.top - 1 && plot.bottom <= view.bottom + 1);
        })(),
        headerControlsOverlapBrand: (() => {
          const brand = document.querySelector('.app-brand')?.getBoundingClientRect();
          const controls = document.querySelector('.header-actions')?.getBoundingClientRect();
          return !!brand && !!controls && !(brand.right <= controls.left || controls.right <= brand.left || brand.bottom <= controls.top || controls.bottom <= brand.top);
        })(),
        scatterPlotStyle: (() => {
          const node = document.querySelector('#scatter-plot');
          if (!node) return null;
          const style = getComputedStyle(node);
          return { width: style.width, height: style.height, justifySelf: style.justifySelf, alignSelf: style.alignSelf, gridColumn: style.gridColumn, gridRow: style.gridRow };
        })(),
        hidden: { matrix: document.querySelector('#matrix')?.hidden ?? null, scatter: document.querySelector('#scatter-view')?.hidden ?? null }
      };
    })()`);
    report.push({ state: state.name, ...snapshot });
  }
  console.log(JSON.stringify(report, null, 2));
  app.exit(0);
});
