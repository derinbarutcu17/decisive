const { app, BrowserWindow } = require('electron');

const url = process.env.TEST_URL || 'http://127.0.0.1:4321/';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 840 });
  try {
    await win.loadURL(url);
    const result = await win.webContents.executeJavaScript(`(() => {
      const quadrant = document.querySelector('[data-quadrant="do"]');
      const list = quadrant.querySelector('.cards');
      list.querySelectorAll('.card').forEach(card => card.remove());
      for (let i = 0; i < 10; i += 1) {
        const card = document.createElement('li');
        card.className = 'card';
        card.innerHTML = '<div class="content"><div class="title">Scroll test task ' + (i + 1) + '</div></div>';
        list.appendChild(card);
      }
      list.dispatchEvent(new Event('scroll'));
      const lowerQuadrant = document.querySelector('[data-quadrant="delegate"]');
      const styles = getComputedStyle(list);
      const frame = list.closest('.cards-frame');
      const fade = frame.querySelector('.cards-fade');
      const fadeStyles = getComputedStyle(fade);
      const quadrantRect = quadrant.getBoundingClientRect();
      const lowerRect = lowerQuadrant.getBoundingClientRect();
      const fadeTopAtTop = fade.getBoundingClientRect().top;
      const fadeVisibleAtTop = frame.classList.contains('has-overflow') && !frame.classList.contains('at-bottom');
      list.scrollTop = list.scrollHeight;
      list.dispatchEvent(new Event('scroll'));
      const fadeTopAtBottom = fade.getBoundingClientRect().top;
      return {
        overflowY: styles.overflowY,
        listHeight: list.clientHeight,
        listContentHeight: list.scrollHeight,
        listScrolls: list.scrollHeight > list.clientHeight,
        fadeVisibleAtTop,
        fadeHiddenAtBottom: frame.classList.contains('at-bottom'),
        fadeStaysPinned: Math.abs(fadeTopAtTop - fadeTopAtBottom) < 1,
        fadeUsesMask: /gradient/i.test(fadeStyles.webkitMaskImage || fadeStyles.maskImage || ''),
        fadeUsesBlur: fadeStyles.backdropFilter !== 'none' || fadeStyles.webkitBackdropFilter !== 'none',
        fadeOutsideScrollList: fade.parentElement === frame,
        rowsStaySeparated: lowerRect.top >= quadrantRect.bottom - 1,
      };
    })()`);
    const checks = [
      ['list uses overflow scrolling', ['auto', 'scroll'].includes(result.overflowY)],
      ['ten tasks exceed the visible list height', result.listScrolls],
      ['bottom fade appears while more tasks are below', result.fadeVisibleAtTop],
      ['bottom fade clears at the end of the list', result.fadeHiddenAtBottom],
      ['bottom fade stays pinned while the list scrolls', result.fadeStaysPinned],
      ['bottom fade uses a gradient mask', result.fadeUsesMask],
      ['bottom fade uses a blur layer', result.fadeUsesBlur],
      ['bottom fade sits outside the scrolling list', result.fadeOutsideScrollList],
      ['matrix rows stay separated', result.rowsStaySeparated],
    ];
    const failed = checks.filter(([, passed]) => !passed);
    console.log(failed.length
      ? `SCROLL TEST FAIL (${failed.length}/${checks.length})\n${failed.map(([name]) => 'FAIL ' + name).join('\n')}\n${JSON.stringify(result)}`
      : `SCROLL TESTS PASS (${checks.length}) ${JSON.stringify(result)}`);
    app.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error('SCROLL TEST ERROR', error);
    app.exit(1);
  }
});
