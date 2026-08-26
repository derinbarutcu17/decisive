// E2E UI smoke test: loads the running app and exercises current interactions.
// Usage: TEST_URL=http://127.0.0.1:4321 TEST_TASK_ID=<id> npx electron test/ui.test.cjs
// Create the fixture beforehand, for example:
//   curl -X POST http://127.0.0.1:4321/api/tasks -H 'content-type: application/json' -d '{"title":"UI test task","quadrant":"do"}'
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const id = process.env.TEST_TASK_ID;
  if (!id) { console.error('FAIL: TEST_TASK_ID env required'); app.exit(1); return; }
  const win = new BrowserWindow({ show: false, width: 1200, height: 840 });
  const url = process.env.TEST_URL || 'http://127.0.0.1:4321';
  await win.loadURL(url);

  let results;
  try {
    results = await win.webContents.executeJavaScript(`(async () => {
      const out = [];
      const ok = (name, cond) => out.push((cond ? 'PASS ' : 'FAIL ') + name);
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const cardSel = '.card[data-id="' + ${JSON.stringify(id)} + '"]';

      await wait(250);
      const card = document.querySelector(cardSel);
      ok('test card rendered', !!card);
      ok('check is a button with aria-pressed', !!card && card.querySelector('.check')?.tagName === 'BUTTON' && card.querySelector('.check').hasAttribute('aria-pressed'));
      ok('content is keyboard focusable', !!card && card.querySelector('.content')?.getAttribute('tabindex') === '0' && card.querySelector('.content').getAttribute('role') === 'button');
      ok('quick-add has an accessible label', document.querySelector('#quick-add')?.getAttribute('aria-label') === 'Add a task');
      ok('matrix has four active quadrants', document.querySelectorAll('#layout .quadrant[data-quadrant]').length === 4);
      ok('done archive is present', !!document.querySelector('#done.done-section'));

      // Click-to-edit is the only task editor surface.
      card.querySelector('.content').click();
      await wait(120);
      ok('click opens the editor', card.classList.contains('editing'));
      ok('editor has title and note fields', !!card.querySelector('input[aria-label="Title"]') && !!card.querySelector('textarea[aria-label="Note"]'));
      document.querySelector('#quick-add').click();
      await wait(260);
      ok('clicking outside closes the editor', !card.classList.contains('editing'));

      // Delete is intentionally two-step and reversible before confirmation.
      const del = card.querySelector('.delete');
      del.click();
      await wait(80);
      const actions = card.querySelector('.delete-actions');
      ok('trash click reveals confirmation actions', del.hidden && !actions.hidden);
      actions.querySelector('.delete-cancel').click();
      await wait(80);
      ok('cancel restores the trash action', !del.hidden && actions.hidden);
      del.click();
      await wait(80);
      actions.querySelector('.delete-approve').click();
      await wait(300);
      ok('confirm removes the task card', !document.querySelector(cardSel));

      const serverTasks = await (await fetch('/api/tasks')).json();
      const archivedCard = serverTasks.find(task => task.id === ${JSON.stringify(id)});
      ok('server archives the approved card', !!archivedCard && archivedCard.done === true && archivedCard.archived === true);
      return out;
    })()`);
  } catch (error) {
    console.error('FAIL: page error: ' + error.message);
    app.exit(1);
    return;
  }

  const failed = results.filter(result => result.startsWith('FAIL'));
  console.log(failed.length
    ? `UI TEST FAIL (${failed.length}/${results.length})\n${failed.join('\n')}`
    : `UI TESTS PASS (${results.length})`);
  app.exit(failed.length ? 1 : 0);
});
