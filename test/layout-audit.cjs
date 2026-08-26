const { app, BrowserWindow } = require('electron');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:4323/';
const states = [
  { name: 'wide-matrix', width: 1440, height: 960, query: '' },
  { name: 'wide-scatter', width: 1440, height: 960, query: '?view=scatter' },
  { name: 'wide-archive', width: 1440, height: 960, query: '?view=archive' },
  { name: 'compact-matrix', width: 920, height: 720, query: '' },
  { name: 'compact-scatter', width: 920, height: 720, query: '?view=scatter' },
  { name: 'compact-archive', width: 920, height: 720, query: '?view=archive' },
  { name: 'iphone-matrix', width: 390, height: 844, query: '?iphone=1' },
  { name: 'iphone-scatter', width: 390, height: 844, query: '?iphone=1&view=scatter' },
  { name: 'iphone-archive', width: 390, height: 844, query: '?iphone=1&view=archive' },
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
          archive: rect('#archive-view'),
          archiveFrame: rect('#archive-view .archive-cards-frame'),
          archiveList: rect('#archive-view .archive-cards'),
        },
        matrixPanels: [...document.querySelectorAll('#layout [data-quadrant]:not(.scatter-task), #done')].map(node => { const r = node.getBoundingClientRect(); return { id: node.id || node.dataset.quadrant, x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; }),
        matrixContract: (() => {
          const layout = document.querySelector('#layout')?.getBoundingClientRect();
          const panels = [...document.querySelectorAll('#layout [data-quadrant]:not(.scatter-task), #done')]
            .map(node => ({ id: node.id || node.dataset.quadrant, rect: node.getBoundingClientRect() }));
          const overlaps = (a, b) => a.rect.left < b.rect.right - 1 && a.rect.right > b.rect.left + 1 && a.rect.top < b.rect.bottom - 1 && a.rect.bottom > b.rect.top + 1;
          return {
            active: document.querySelector('#matrix')?.hidden === false,
            panelCount: panels.length,
            panelsContained: !layout || panels.every(({ rect }) => rect.left >= layout.left - 1 && rect.right <= layout.right + 1 && rect.top >= layout.top - 1 && rect.bottom <= layout.bottom + 1),
            panelsDisjoint: panels.every((panel, index) => panels.slice(index + 1).every(other => !overlaps(panel, other))),
          };
        })(),
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
        ,archiveContract: (() => {
          const view = document.querySelector('#archive-view');
          const frame = document.querySelector('#archive-view .archive-cards-frame');
          const list = document.querySelector('#archive-view .archive-cards');
          if (!view || !frame || !list) return null;
          const viewStyle = getComputedStyle(view);
          const frameStyle = getComputedStyle(frame);
          const listStyle = getComputedStyle(list);
          const listRect = list.getBoundingClientRect();
          const frameRect = frame.getBoundingClientRect();
          return {
            active: !view.hidden,
            matrixHidden: document.querySelector('#matrix')?.hidden === true,
            doneHidden: document.querySelector('#done')?.hidden === true,
            viewOverflow: viewStyle.overflow,
            frameMaxHeight: frameStyle.maxHeight,
            frameOverflow: frameStyle.overflow,
            listOverflowY: listStyle.overflowY,
            listWithinFrame: !view.hidden ? listRect.bottom <= frameRect.bottom + 1 : true,
            listFillsFrame: !view.hidden ? Math.abs(listRect.width - frameRect.width) <= 1 : true,
            archiveItemCount: list.querySelectorAll('.archive-item').length,
          };
        })()
      };
    })()`);
    report.push({ state: state.name, ...snapshot });
  }
  const archiveFailures = report
    .filter(item => item.state.includes('archive'))
    .flatMap(item => {
      const contract = item.archiveContract;
      if (!contract) return [`${item.state}: archive contract missing`];
      const failures = [];
      if (!contract.active) failures.push(`${item.state}: archive view is not active`);
      if (!contract.matrixHidden || !contract.doneHidden) failures.push(`${item.state}: Matrix or Done remains visible`);
      if (contract.viewOverflow !== 'visible') failures.push(`${item.state}: archive view clips overflow`);
      if (contract.frameMaxHeight !== 'none') failures.push(`${item.state}: archive frame has a max-height cap`);
      if (contract.frameOverflow !== 'visible') failures.push(`${item.state}: archive frame clips overflow`);
      if (contract.listOverflowY !== 'visible') failures.push(`${item.state}: archive list is an internal scroller`);
      if (!contract.listWithinFrame) failures.push(`${item.state}: archive list extends outside its flow frame`);
      if (!contract.listFillsFrame) failures.push(`${item.state}: archive list does not fill the archive frame`);
      return failures;
    });
  const matrixFailures = report
    .filter(item => item.state.includes('matrix'))
    .flatMap(item => {
      const contract = item.matrixContract;
      if (!contract) return [`${item.state}: matrix contract missing`];
      const failures = [];
      if (contract.panelCount !== 5) failures.push(`${item.state}: expected five matrix panels, found ${contract.panelCount}`);
      if (!contract.panelsContained) failures.push(`${item.state}: matrix panel extends outside #layout`);
      if (!contract.panelsDisjoint) failures.push(`${item.state}: matrix panels overlap`);
      return failures;
    });
  if (archiveFailures.length) console.error(`ARCHIVE LAYOUT FAILURES\n${archiveFailures.join('\n')}`);
  if (matrixFailures.length) console.error(`MATRIX LAYOUT FAILURES\n${matrixFailures.join('\n')}`);
  console.log(JSON.stringify(report, null, 2));
  app.exit(archiveFailures.length || matrixFailures.length ? 1 : 0);
});
