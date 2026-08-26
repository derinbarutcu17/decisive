// Scatter label geometry check against an isolated fixture server.
// TEST_URL=http://127.0.0.1:4324/ ./node_modules/.bin/electron test/label-audit.cjs
const { app, BrowserWindow } = require('electron');

const url = process.env.TEST_URL || 'http://127.0.0.1:4324/';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: Number(process.env.TEST_WIDTH || 1440),
    height: Number(process.env.TEST_HEIGHT || 960),
  });
  try {
    await win.loadURL(url + '?view=scatter');
    const results = await win.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const namesSetting = document.querySelector('#scatter-names-button');
      if (namesSetting && namesSetting.getAttribute('aria-pressed') !== 'true') namesSetting.click();
      // Let the eased label transition settle before measuring final geometry.
      // The product intentionally allows long labels to escape the plot edge,
      // so the audit checks the documented escape budget rather than clipping.
      await wait(700);
      const plot = document.querySelector('#scatter-plot').getBoundingClientRect();
      const labelEscape = 160;
      const dots = [...document.querySelectorAll('.scatter-task')];
      const labels = dots.map(dot => ({
        dot,
        rect: dot.querySelector('.scatter-task-label').getBoundingClientRect(),
        visible: getComputedStyle(dot.querySelector('.scatter-task-label')).visibility === 'visible',
        zIndex: Number(getComputedStyle(dot).zIndex) || 0,
      }));
      const overlap = (a, b, gap = 4) => !(a.right + gap <= b.left || a.left >= b.right + gap || a.bottom + gap <= b.top || a.top >= b.bottom + gap);
      const visibleLabels = labels.filter(item => item.visible);
      const pairs = [];
      for (let i = 0; i < visibleLabels.length; i += 1) {
        for (let j = i + 1; j < visibleLabels.length; j += 1) {
          if (overlap(visibleLabels[i].rect, visibleLabels[j].rect)) pairs.push([i, j]);
        }
      }
      const active = labels.find(item => item.dot.classList.contains('is-frontmost'));
      return {
        taskCount: dots.length,
        visibleCount: visibleLabels.length,
        labelsStayWithinEscapeBudget: visibleLabels.every(item => item.rect.left >= plot.left - labelEscape
          && item.rect.right <= plot.right + labelEscape
          && item.rect.top >= plot.top - labelEscape
          && item.rect.bottom <= plot.bottom + labelEscape),
        overlappingPairs: pairs.length,
        activeIsFrontmost: !!active && active.zIndex >= 30,
        activeLabelIsVisible: !!active && active.visible,
        labels: labels.map(item => ({ title: item.dot.querySelector('.scatter-task-label').textContent, id: item.dot.dataset.id, visible: item.visible, rect: { left: item.rect.left, top: item.rect.top, right: item.rect.right, bottom: item.rect.bottom, width: item.rect.width, height: item.rect.height }, zIndex: item.zIndex })),
        pairs,
      };
    })()`);
    const checks = [
      ['task names setting reveals all labels', results.taskCount > 0 && results.visibleCount === results.taskCount],
      ['visible labels stay within the plot escape budget', results.labelsStayWithinEscapeBudget],
      ['visible labels do not overlap', results.overlappingPairs === 0],
      ['active dot is frontmost', results.activeIsFrontmost],
      ['active label is visible', results.activeLabelIsVisible],
    ];
    const failed = checks.filter(([, passed]) => !passed);
    console.log(failed.length
      ? `LABEL AUDIT FAIL (${failed.length}/${checks.length})\\n${failed.map(([name]) => 'FAIL ' + name).join('\\n')}\\n${JSON.stringify(results)}`
      : `LABEL AUDIT PASS (${checks.length}) ${JSON.stringify(results)}`);
    app.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error('LABEL AUDIT ERROR', error);
    app.exit(1);
  }
});
