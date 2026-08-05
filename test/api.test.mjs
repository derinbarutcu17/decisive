import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'eisenhower-'));
const port = 4322;
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'data.json') } });
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
  const del = await fetch(base + `/api/tasks/${created.id}`, { method: 'DELETE' });
  assert(del.ok && (await (await fetch(base + '/api/tasks')).json()).length === 1, 'delete failed');
  console.log('API tests PASS');
} finally {
  proc.kill();
  await rm(dir, { recursive: true, force: true });
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
