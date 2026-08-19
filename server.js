import http from 'node:http';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 4321;
const QUADRANTS = ['do', 'schedule', 'delegate', 'eliminate'];
const SNAP_POINTS = Array.from({ length: 21 }, (_, index) => index * 5);
const DEFAULT_WEIGHTS = {
  do: { importance: 75, urgency: 75 },
  schedule: { importance: 75, urgency: 25 },
  delegate: { importance: 25, urgency: 75 },
  eliminate: { importance: 25, urgency: 25 },
};
const DONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DONE_VISIBLE_LIMIT = 10;

let tasks = [];
let saveQueue = Promise.resolve();

function weight(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(0, Math.min(100, n));
  return SNAP_POINTS.reduce((closest, point) => Math.abs(point - clamped) < Math.abs(closest - clamped) ? point : closest, SNAP_POINTS[0]);
}

function applyDefaultWeights(task) {
  const defaults = DEFAULT_WEIGHTS[task.quadrant] || DEFAULT_WEIGHTS.do;
  task.importance = weight(task.importance, defaults.importance);
  task.urgency = weight(task.urgency, defaults.urgency);
  return task;
}

async function load() {
  try {
    tasks = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(tasks)) throw new Error('data file must contain an array');
    let changed = false;
    tasks.forEach(task => {
      const before = String(task.importance) + ':' + String(task.urgency);
      applyDefaultWeights(task);
      changed ||= before !== String(task.importance) + ':' + String(task.urgency);
      if (typeof task.archived !== 'boolean') {
        task.archived = false;
        changed = true;
      }
      if (task.archived && task.done !== true) {
        task.archived = false;
        task.archivedAt = null;
        changed = true;
      }
    });
    const archived = archiveExpiredDoneTasks();
    const archivedOverflow = archiveDoneOverflow();
    if (changed || archived || archivedOverflow.length) await save();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    tasks = [];
    await save();
  }
}
function save() {
  const payload = JSON.stringify(tasks, null, 2);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const tempFile = `${DATA_FILE}.tmp`;
    await writeFile(tempFile, payload);
    await rename(tempFile, DATA_FILE);
  });
  return saveQueue;
}

function archiveExpiredDoneTasks(now = Date.now()) {
  const cutoff = now - DONE_RETENTION_MS;
  let archived = 0;
  tasks.forEach(task => {
    if (task.done !== true || task.archived === true || typeof task.doneAt !== 'string') return;
    const doneAt = Date.parse(task.doneAt);
    if (Number.isFinite(doneAt) && doneAt < cutoff) {
      task.archived = true;
      task.archivedAt = task.archivedAt || new Date(now).toISOString();
      archived += 1;
    }
  });
  return archived;
}

function archiveDoneOverflow(now = Date.now()) {
  const visible = tasks
    .filter(task => task.done === true && task.archived !== true)
    .sort((a, b) => Date.parse(b.doneAt || '') - Date.parse(a.doneAt || ''));
  const overflow = visible.slice(DONE_VISIBLE_LIMIT);
  overflow.forEach(task => {
    task.archived = true;
    task.archivedAt = task.archivedAt || new Date(now).toISOString();
  });
  return overflow.map(task => task.id);
}

async function runRetentionSweep() {
  if (archiveExpiredDoneTasks() > 0) await save();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = (req.method === 'GET' || !req.headers['content-length']) ? {} : JSON.parse(await readBody(req));
      if (url.pathname === '/api/tasks' && req.method === 'GET') {
        await runRetentionSweep();
        return json(200, tasks);
      }

      if (url.pathname === '/api/tasks' && req.method === 'POST') {
        const q = QUADRANTS.includes(body.quadrant) ? body.quadrant : 'do';
        const defaults = DEFAULT_WEIGHTS[q];
        const t = { id: randomUUID(), title: String(body.title || ''), note: String(body.note || ''), quadrant: q, order: tasks.filter(x => x.quadrant === q && !x.done && !x.archived).length, done: false, doneAt: null, archived: false, archivedAt: null, importance: weight(body.importance, defaults.importance), urgency: weight(body.urgency, defaults.urgency) };
        tasks.push(t); await save(); return json(201, t);
      }

      if (url.pathname === '/api/tasks' && req.method === 'DELETE' && url.searchParams.get('done') === 'true') {
        let archived = 0;
        tasks.forEach(task => {
          if (task.done && !task.archived) {
            task.archived = true;
            task.archivedAt = task.archivedAt || new Date().toISOString();
            archived += 1;
          }
        });
        if (archived) await save();
        return json(200, { ok: true, archived });
      }

      const m = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
      if (m) {
        const t = tasks.find(x => x.id === m[1]);
        if (!t) return json(404, { error: 'not found' });
        if (req.method === 'PATCH') {
          const nextDone = 'done' in body ? !!body.done : t.done === true;
          if ('archived' in body && body.archived && !nextDone) {
            return json(409, { error: 'only completed tasks can be archived' });
          }
          if ('title' in body) t.title = String(body.title);
          if ('note' in body) t.note = String(body.note);
          if ('quadrant' in body && !QUADRANTS.includes(body.quadrant)) return json(400, { error: 'invalid quadrant' });
          const defaults = DEFAULT_WEIGHTS[t.quadrant] || DEFAULT_WEIGHTS.do;
          if ('importance' in body) t.importance = weight(body.importance, defaults.importance);
          if ('urgency' in body) t.urgency = weight(body.urgency, defaults.urgency);
          if ('done' in body) {
            t.done = !!body.done;
            t.doneAt = t.done ? (t.doneAt || new Date().toISOString()) : null;
            if (!t.done) {
              t.archived = false;
              t.archivedAt = null;
            }
          }
          if ('archived' in body) {
            t.archived = !!body.archived;
            t.archivedAt = t.archived ? (t.archivedAt || new Date().toISOString()) : null;
          }
          const moving = 'quadrant' in body && body.quadrant !== t.quadrant;
          if (moving || 'order' in body) {
            if (moving) {
              const old = tasks.filter(x => x.quadrant === t.quadrant && !x.done && !x.archived && x.id !== t.id).sort((a, b) => a.order - b.order);
              old.forEach((x, i) => x.order = i);
              t.quadrant = QUADRANTS.includes(body.quadrant) ? body.quadrant : t.quadrant;
              if (!('importance' in body) && !('urgency' in body)) applyDefaultWeights(t);
            }
            const same = tasks.filter(x => x.quadrant === t.quadrant && !x.done && !x.archived && x.id !== t.id).sort((a, b) => a.order - b.order);
            const idx = Math.min(Number(body.order ?? same.length), same.length);
            same.splice(idx, 0, t);
            same.forEach((x, i) => x.order = i);
          }
          const archivedOverflowIds = t.done && !t.archived ? archiveDoneOverflow() : [];
          await save(); return json(200, { ...t, archivedOverflowIds });
        }
        if (req.method === 'DELETE') { tasks = tasks.filter(x => x.id !== m[1]); await save(); return json(200, { ok: true }); }
      }
      return json(404, { error: 'no route' });
    }

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const p = path.join(__dirname, file);
    if (!p.startsWith(__dirname)) return json(403, { error: 'forbidden' });
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
    json(500, { error: String(e) });
  }
});

load().then(() => {
  server.listen(PORT, () => {
    console.log(`Decisive on http://localhost:${PORT} (data: ${DATA_FILE})`);
    const retentionTimer = setInterval(() => { void runRetentionSweep(); }, 60 * 60 * 1000);
    retentionTimer.unref?.();
    if (process.platform === 'darwin' && !process.env.DATA_FILE) exec(`open http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error(`Couldn't load task data from ${DATA_FILE}:`, error);
  process.exitCode = 1;
});
