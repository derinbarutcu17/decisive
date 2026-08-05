import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 4321;
const QUADRANTS = ['do', 'schedule', 'delegate', 'eliminate'];

let tasks = [];

async function load() {
  try {
    tasks = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(tasks)) throw new Error('data file must contain an array');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    tasks = [];
    await save();
  }
}
async function save() { await writeFile(DATA_FILE, JSON.stringify(tasks, null, 2)); }

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
      if (url.pathname === '/api/tasks' && req.method === 'GET') return json(200, tasks);

      if (url.pathname === '/api/tasks' && req.method === 'POST') {
        const q = QUADRANTS.includes(body.quadrant) ? body.quadrant : 'do';
        const t = { id: randomUUID(), title: String(body.title || ''), note: String(body.note || ''), quadrant: q, order: tasks.filter(x => x.quadrant === q).length, done: false, doneAt: null };
        tasks.push(t); await save(); return json(201, t);
      }

      const m = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
      if (m) {
        const t = tasks.find(x => x.id === m[1]);
        if (!t) return json(404, { error: 'not found' });
        if (req.method === 'PATCH') {
          if ('title' in body) t.title = String(body.title);
          if ('note' in body) t.note = String(body.note);
          if ('done' in body) { t.done = !!body.done; t.doneAt = t.done ? new Date().toISOString() : null; }
          const moving = 'quadrant' in body && body.quadrant !== t.quadrant;
          if (moving || 'order' in body) {
            if (moving) {
              const old = tasks.filter(x => x.quadrant === t.quadrant && x.id !== t.id).sort((a, b) => a.order - b.order);
              old.forEach((x, i) => x.order = i);
              t.quadrant = QUADRANTS.includes(body.quadrant) ? body.quadrant : t.quadrant;
            }
            const same = tasks.filter(x => x.quadrant === t.quadrant && x.id !== t.id).sort((a, b) => a.order - b.order);
            const idx = Math.min(Number(body.order ?? same.length), same.length);
            same.splice(idx, 0, t);
            same.forEach((x, i) => x.order = i);
          }
          await save(); return json(200, t);
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
    if (process.platform === 'darwin' && !process.env.DATA_FILE) exec(`open http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error(`Couldn't load task data from ${DATA_FILE}:`, error);
  process.exitCode = 1;
});
