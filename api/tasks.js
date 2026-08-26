import { randomUUID } from 'node:crypto';

// The web preview is intentionally session-scoped. It gives visitors a safe,
// realistic board to explore without exposing the author's local task file.
// Durable persistence and offline continuity remain native macOS behaviour.
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

const PREVIEW_TASKS = [
  ['do', 'Ship the interaction spec', 0, 85, 95],
  ['do', 'Polish onboarding focus states', 1, 75, 85],
  ['do', 'Prepare launch screenshots', 2, 65, 75],
  ['schedule', 'Prototype research dashboard filters', 0, 85, 35],
  ['schedule', 'Plan the design-token migration', 1, 75, 25],
  ['schedule', 'Map the next usability study', 2, 65, 15],
  ['delegate', 'QA the component library in Safari', 0, 35, 75],
  ['delegate', 'Write accessibility notes for charts', 1, 45, 65],
  ['eliminate', 'Remove duplicate dashboard variants', 0, 15, 35],
  ['eliminate', 'Archive unused Figma explorations', 1, 10, 25],
  ['do', 'Audit loading and error states', 0, 75, 75, true, -3],
  ['schedule', 'Publish the component usage guide', 0, 65, 55, true, -2],
  ['delegate', 'Review the visual regression report', 0, 45, 45, true, -1],
  ['eliminate', 'Resolve the old navigation fork', 0, 10, 10, true, -8],
];

function createPreviewTasks() {
  return PREVIEW_TASKS.map(([quadrant, title, order, importance, urgency, done = false, daysAgo = 0], index) => {
    const doneAt = done ? new Date(Date.now() - Math.max(0, -daysAgo) * 24 * 60 * 60 * 1000).toISOString() : null;
    return {
      id: `preview-${String(index + 1).padStart(3, '0')}`,
      title,
      note: '',
      quadrant,
      order,
      done,
      doneAt,
      archived: false,
      archivedAt: null,
      importance,
      urgency,
    };
  });
}

let tasks = createPreviewTasks();

function weight(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(0, Math.min(100, n));
  return SNAP_POINTS.reduce((closest, point) => Math.abs(point - clamped) < Math.abs(closest - clamped) ? point : closest, SNAP_POINTS[0]);
}

function defaultsFor(quadrant) {
  return DEFAULT_WEIGHTS[quadrant] || DEFAULT_WEIGHTS.do;
}

function archiveRetentionAndOverflow(now = Date.now()) {
  const cutoff = now - DONE_RETENTION_MS;
  tasks.forEach(task => {
    if (!task.done || task.archived || !task.doneAt) return;
    if (Date.parse(task.doneAt) < cutoff) {
      task.archived = true;
      task.archivedAt ||= new Date(now).toISOString();
    }
  });

  const visible = tasks
    .filter(task => task.done && !task.archived)
    .sort((a, b) => Date.parse(b.doneAt || '') - Date.parse(a.doneAt || ''));
  const overflow = visible.slice(DONE_VISIBLE_LIMIT);
  overflow.forEach(task => {
    task.archived = true;
    task.archivedAt ||= new Date(now).toISOString();
  });
  return overflow.map(task => task.id);
}

function activeIn(quadrant, excluding = null) {
  return tasks
    .filter(task => task.quadrant === quadrant && !task.done && !task.archived && task.id !== excluding)
    .sort((a, b) => a.order - b.order);
}

function reorder(quadrant, moved, requestedOrder) {
  const items = activeIn(quadrant, moved.id);
  const index = Math.max(0, Math.min(Number(requestedOrder ?? items.length), items.length));
  items.splice(index, 0, moved);
  items.forEach((task, order) => { task.order = order; });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res, code, payload) {
  res.status(code).json(payload);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url = new URL(req.url || '/api/tasks', 'https://decisive.vercel.app');
  const parts = url.pathname.split('/').filter(Boolean);
  const taskId = parts.length === 3 && parts[0] === 'api' && parts[1] === 'tasks' ? parts[2] : null;

  try {
    if (!taskId && req.method === 'GET') {
      archiveRetentionAndOverflow();
      return send(res, 200, tasks);
    }

    if (!taskId && req.method === 'POST') {
      if (url.pathname === '/api/demo/restore') {
        tasks = createPreviewTasks();
        return send(res, 200, { ok: true, restored: tasks.length, tasks });
      }
      const body = await readBody(req);
      const quadrant = QUADRANTS.includes(body.quadrant) ? body.quadrant : 'do';
      const defaults = defaultsFor(quadrant);
      const task = {
        id: randomUUID(),
        title: String(body.title || ''),
        note: String(body.note || ''),
        quadrant,
        order: activeIn(quadrant).length,
        done: false,
        doneAt: null,
        archived: false,
        archivedAt: null,
        importance: weight(body.importance, defaults.importance),
        urgency: weight(body.urgency, defaults.urgency),
      };
      tasks.push(task);
      return send(res, 201, task);
    }

    if (!taskId && req.method === 'DELETE' && url.searchParams.get('done') === 'true') {
      let archived = 0;
      tasks.forEach(task => {
        if (task.done && !task.archived) {
          task.archived = true;
          task.archivedAt ||= new Date().toISOString();
          archived += 1;
        }
      });
      return send(res, 200, { ok: true, archived });
    }

    if (!taskId && req.method === 'DELETE' && url.searchParams.get('archived') === 'true') {
      const before = tasks.length;
      tasks = tasks.filter(task => !(task.done === true && task.archived === true));
      return send(res, 200, { ok: true, deleted: before - tasks.length });
    }

    if (!taskId) return send(res, 404, { error: 'no route' });
    const task = tasks.find(item => item.id === taskId);
    if (!task) return send(res, 404, { error: 'not found' });

    if (req.method === 'DELETE') {
      tasks = tasks.filter(item => item.id !== taskId);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const previousQuadrant = task.quadrant;
      const nextDone = 'done' in body ? Boolean(body.done) : task.done;
      const nextQuadrant = 'quadrant' in body ? body.quadrant : task.quadrant;
      if (!QUADRANTS.includes(nextQuadrant)) return send(res, 400, { error: 'invalid quadrant' });
      if ('archived' in body && body.archived && !nextDone) return send(res, 409, { error: 'only completed tasks can be archived' });

      if ('title' in body) task.title = String(body.title);
      if ('note' in body) task.note = String(body.note);
      task.quadrant = nextQuadrant;
      const defaults = defaultsFor(nextQuadrant);
      if ('importance' in body) task.importance = weight(body.importance, defaults.importance);
      if ('urgency' in body) task.urgency = weight(body.urgency, defaults.urgency);
      if ('done' in body) {
        task.done = nextDone;
        task.doneAt = task.done ? (task.doneAt || new Date().toISOString()) : null;
        if (!task.done) {
          task.archived = false;
          task.archivedAt = null;
        }
      }
      if ('archived' in body) {
        task.archived = Boolean(body.archived);
        task.archivedAt = task.archived ? (task.archivedAt || new Date().toISOString()) : null;
      }
      if (!('importance' in body) && !('urgency' in body) && previousQuadrant !== nextQuadrant) {
        task.importance = defaults.importance;
        task.urgency = defaults.urgency;
      }
      if (previousQuadrant !== nextQuadrant || 'order' in body) reorder(nextQuadrant, task, body.order);

      const archivedOverflowIds = task.done && !task.archived ? archiveRetentionAndOverflow() : [];
      return send(res, 200, { ...task, archivedOverflowIds });
    }

    return send(res, 405, { error: 'method not allowed' });
  } catch (error) {
    return send(res, 500, { error: String(error) });
  }
}
