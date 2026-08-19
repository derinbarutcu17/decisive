// Scatter view smoke test. Run against a local fixture server:
// TEST_URL=http://127.0.0.1:4323/ node test/scatter.test.cjs
const { app, BrowserWindow } = require('electron');

const url = process.env.TEST_URL || 'http://127.0.0.1:4321/';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: Number(process.env.TEST_WIDTH || 1280),
    height: Number(process.env.TEST_HEIGHT || 860),
  });
  try {
    await win.loadURL(url);
  const script = [
      '(async () => {',
      '  const out = [];',
      "  const ok = (name, condition) => out.push((condition ? 'PASS ' : 'FAIL ') + name);",
      '  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));',
      '  await wait(250);',
      "  document.querySelector('.view-button[data-view=\"scatter\"]').click();",
      '  await wait(120);',
      "  const plot = document.querySelector('#scatter-plot');",
      "  const plotRect = plot.getBoundingClientRect();",
      "  const points = [...document.querySelectorAll('.scatter-grid-point')];",
      "  const dots = [...document.querySelectorAll('.scatter-task')];",
      "  const allowed = new Set(Array.from({ length: 21 }, (_, index) => String(index * 5)));",
      "  const zones = ['zone-delegate', 'zone-do', 'zone-eliminate', 'zone-schedule'];",
      "  const namesSetting = document.querySelector('#scatter-names-setting');",
      "  const zoneColors = zones.map(name => getComputedStyle(document.querySelector('.' + name)).backgroundColor);",
      "  const positions = zones.map(name => {",
      "    const style = getComputedStyle(document.querySelector('.' + name));",
      "    return style.gridColumnStart + '/' + style.gridRowStart;",
      '  });',
      "  ok('Scatter view opens', !document.querySelector('#scatter-view').hidden);",
      "  ok('task names toggle is removed from Scatter view', !document.querySelector('#task-names-toggle'));",
      "  ok('task names setting is available in Settings', !!namesSetting);",
      "  ok('removed scatter panels stay removed', !document.querySelector('.scatter-heading') && !document.querySelector('.scatter-inspector'));",
      "  ok('plot is square', Math.abs(plotRect.width - plotRect.height) < 1);",
      "  ok('grid keeps its square surface without marker circles', points.length === 0);",
      "  ok('quadrant names are removed from the plot surface', [...document.querySelectorAll('.scatter-zone')].every(zone => !zone.textContent.trim()));",
      "  ok('quadrants use conventional positions', JSON.stringify(positions) === JSON.stringify(['1/2', '1/1', '2/2', '2/1']));",
      "  ok('quadrants use four distinct colors', new Set(zoneColors).size === 4);",
      "  ok('every task starts on a snap point', dots.every(dot => allowed.has(dot.dataset.importance) && allowed.has(dot.dataset.urgency)));",
      "  ok('dots have one filled point and a hover card', dots.every(dot => !!dot.querySelector('.scatter-task-label') && dot.querySelector('.scatter-task-label').textContent));",
      '  if (namesSetting) {',
      "    if (namesSetting.checked) namesSetting.click();",
      "    namesSetting.click();",
      "    ok('task names setting shows labels', namesSetting.checked && document.querySelector('#scatter-view').classList.contains('names-visible'));",
      "    namesSetting.click();",
      "    ok('task names setting hides labels', !namesSetting.checked && !document.querySelector('#scatter-view').classList.contains('names-visible'));",
      '  }',
      '  if (dots[0]) {',
      "    const beforeUrgency = Number(dots[0].dataset.urgency);",
      '    dots[0].focus();',
      "    dots[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));",
      '    await wait(180);',
      "    ok('keyboard movement advances one grid point', Number(dots[0].dataset.urgency) === Math.min(100, beforeUrgency + 5));",
      "    ok('keyboard movement remains snapped', allowed.has(dots[0].dataset.importance) && allowed.has(dots[0].dataset.urgency));",
      '  }',
      "  document.querySelector('.view-button[data-view=\"matrix\"]').click();",
      "  ok('Matrix view returns', document.querySelector('#matrix').hidden === false && document.querySelector('#scatter-view').hidden === true);",
      '  return out;',
      '})()'
    ].join('\n');
    const results = await win.webContents.executeJavaScript(script);
    const failed = results.filter(result => result.startsWith('FAIL'));
    console.log(failed.length
      ? 'SCATTER TEST FAIL (' + failed.length + '/' + results.length + ')\n' + failed.join('\n')
      : 'SCATTER TESTS PASS (' + results.length + ')');
    app.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error('SCATTER TEST ERROR', error);
    app.exit(1);
  }
});
