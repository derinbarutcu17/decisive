import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'eisenhower-'));
const port = 4322;
const dataFile = path.join(dir, 'data.json');
const oldDone = {
  id: 'expired-done',
  title: 'expired',
  note: '',
  quadrant: 'do',
  order: 0,
  done: true,
  doneAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
  importance: 75,
  urgency: 75,
};
const invalidArchived = {
  id: 'invalid-archive-state',
  title: 'active but archived',
  note: '',
  quadrant: 'eliminate',
  order: 1,
  done: false,
  doneAt: null,
  archived: true,
  archivedAt: new Date().toISOString(),
  importance: 75,
  urgency: 75,
};
await writeFile(dataFile, JSON.stringify([oldDone, invalidArchived]));
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DATA_FILE: dataFile } });
const base = `http://localhost:${port}`;

const wait = async () => {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/tasks'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
};

try {
  await wait();
  const initial = await (await fetch(base + '/api/tasks')).json();
  assert(initial.find(x => x.id === oldDone.id)?.archived === true, '30-day retention should archive, not delete');
  assert(initial.find(x => x.id === invalidArchived.id)?.archived === false, 'active tasks must not remain archived');
  const created = await (await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'a', quadrant: 'do' }) })).json();
  assert(created.id && created.quadrant === 'do' && created.order === 0, 'create failed');
  const b = await (await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'b', quadrant: 'do' }) })).json();
  const moved = await (await fetch(base + `/api/tasks/${created.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quadrant: 'schedule', order: 0 }) })).json();
  assert(moved.quadrant === 'schedule' && moved.order === 0, 'move failed');
  const after = await (await fetch(base + '/api/tasks')).json();
  assert(after.find(x => x.id === b.id).order === 0, 'reindex failed');
  const doneT = await (await fetch(base + `/api/tasks/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) })).json();
  assert(doneT.done === true && typeof doneT.doneAt === 'string', 'mark done failed');
  const undone = await (await fetch(base + `/api/tasks/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: false }) })).json();
  assert(undone.done === false && undone.doneAt === null, 'unmark done failed');
  const invalidArchive = await fetch(base + `/api/tasks/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) });
  assert(invalidArchive.status === 409, 'active tasks must not be archivable');
  const archiveCandidate = await (await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'archive me', quadrant: 'do' }) })).json();
  await fetch(base + `/api/tasks/${archiveCandidate.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) });
  const archived = await (await fetch(base + '/api/tasks?done=true', { method: 'DELETE' })).json();
  assert(archived.archived === 1, 'bulk done action should archive');
  const archiveState = await (await fetch(base + '/api/tasks')).json();
  assert(archiveState.find(x => x.id === archiveCandidate.id)?.archived === true, 'archived task should remain recoverable');
  const archivedDelete = await fetch(base + `/api/tasks/${archiveCandidate.id}`, { method: 'DELETE' });
  const afterArchivedDelete = await (await fetch(base + '/api/tasks')).json();
  assert(archivedDelete.ok && !afterArchivedDelete.some(x => x.id === archiveCandidate.id), 'archived task delete failed');
  const bulkArchiveCandidates = await Promise.all([
    fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'bulk archive me 1', quadrant: 'schedule' }) }).then(r => r.json()),
    fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'bulk archive me 2', quadrant: 'schedule' }) }).then(r => r.json()),
  ]);
  await Promise.all(bulkArchiveCandidates.map(candidate => fetch(base + `/api/tasks/${candidate.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) })));
  await (await fetch(base + '/api/tasks?done=true', { method: 'DELETE' })).json();
  const archiveAll = await (await fetch(base + '/api/tasks?archived=true', { method: 'DELETE' })).json();
  assert(archiveAll.deleted === 3, `bulk archive deletion should remove all archived tasks (got ${archiveAll.deleted})`);
  const afterArchiveAll = await (await fetch(base + '/api/tasks')).json();
  assert(!afterArchiveAll.some(x => bulkArchiveCandidates.some(candidate => candidate.id === x.id)), 'bulk archive deletion failed');
  const restoreResponse = await fetch(base + '/api/demo/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'bundled-demo-v1' }),
  });
  const restored = await restoreResponse.json();
  assert(restoreResponse.ok && restored.restored > 0, 'demo restore should replace the board with built-in examples');
  assert(restored.tasks.every(task => String(task.id).startsWith('demo-')), 'demo restore must never import personal rows');
  const afterRestore = await (await fetch(base + '/api/tasks')).json();
  assert(afterRestore.length === restored.restored && afterRestore.every(task => String(task.id).startsWith('demo-')), 'demo restore must remove custom rows');
  assert(!afterRestore.some(task => task.id === created.id), 'demo restore must remove custom tasks');
  const restoredAgainResponse = await fetch(base + '/api/demo/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'bundled-demo-v1' }),
  });
  const restoredAgain = await restoredAgainResponse.json();
  assert(restoredAgainResponse.ok && restoredAgain.restored === restored.restored, 'demo restore should be repeatable');
  assert((await (await fetch(base + '/api/tasks')).json()).every(task => String(task.id).startsWith('demo-')), 'repeat demo restore must remain demo-only');
  const demoToDelete = restored.tasks[0];
  const del = await fetch(base + `/api/tasks/${demoToDelete.id}`, { method: 'DELETE' });
  assert(del.ok && !(await (await fetch(base + '/api/tasks')).json()).some(x => x.id === demoToDelete.id), 'delete failed');
  console.log('API tests PASS');
} finally {
  proc.kill();
  await rm(dir, { recursive: true, force: true });
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
