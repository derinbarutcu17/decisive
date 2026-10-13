#!/usr/bin/env node
// decisive — full local control of the Decisive task app for humans and agents.
// Talks to the app's local HTTP API; starts a headless server with the same
// data file when the app is closed. No dependencies.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(__dirname);
const PORT = Number(process.env.DECISIVE_PORT || 4321);
const API_OVERRIDE = process.env.DECISIVE_API || '';
const API = (API_OVERRIDE || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
const DATA_FILE = process.env.DECISIVE_DATA_FILE
  || path.join(process.env.HOME || '', 'Library', 'Application Support', 'eisenhower', 'data.json');
const QUADRANTS = ['do', 'schedule', 'delegate', 'eliminate'];
const QUADRANT_LABELS = {
  do: 'DO (urgent + important)',
  schedule: 'SCHEDULE (important, not urgent)',
  delegate: 'DELEGATE (urgent, not important)',
  eliminate: 'ELIMINATE (neither)',
};

let VERBOSE = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(method, route, body) {
  if (VERBOSE) console.error(`[verbose] ${method} ${API}${route}`);
  const response = await fetch(API + route, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = payload && payload.error ? payload.error : `HTTP ${response.status}`;
    throw new Error(`${method} ${route} failed: ${message}`);
  }
  return payload;
}

async function serverUp() {
  try {
    await api('GET', '/api/tasks');
    return true;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return;
  if (API_OVERRIDE) {
    throw new Error(`Decisive API at ${API} is not reachable (DECISIVE_API is set, so no local server was started)`);
  }
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'server.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_FILE },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 60; i += 1) {
    if (await serverUp()) return;
    await sleep(100);
  }
  throw new Error(`Could not start the Decisive server on port ${PORT} (data: ${DATA_FILE})`);
}

async function allTasks() {
  const tasks = await api('GET', '/api/tasks');
  return Array.isArray(tasks) ? tasks : [];
}

async function resolveId(prefix) {
  if (!prefix || prefix.length < 1) throw new Error('Task id prefix is required');
  const tasks = await allTasks();
  const matches = tasks.filter(task => String(task.id).startsWith(prefix));
  if (matches.length === 0) throw new Error(`No task matches id "${prefix}"`);
  if (matches.length > 1) {
    const list = matches.map(task => `  ${String(task.id).slice(0, 8)}  ${task.title}`).join('\n');
    throw new Error(`Id "${prefix}" is ambiguous:\n${list}`);
  }
  return matches[0];
}

function formatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function taskLine(task) {
  const id = String(task.id).slice(0, 8).padEnd(8);
  const due = (task.dueDate ? formatDate(task.dueDate) : '—').padEnd(6);
  const marks = `${task.done ? ' ✓done' : ''}${task.archived ? ' ✗archived' : ''}`;
  return `  ${id}  ${due}  ${task.title}${marks}`;
}

function printList(tasks) {
  if (!tasks.length) {
    console.log('No tasks.');
    return;
  }
  for (const quadrant of QUADRANTS) {
    const group = tasks.filter(task => task.quadrant === quadrant);
    if (!group.length) continue;
    console.log(QUADRANT_LABELS[quadrant]);
    for (const task of group) console.log(taskLine(task));
    console.log('');
  }
}

function printTask(task) {
  console.log(`id:          ${task.id}`);
  console.log(`title:       ${task.title}`);
  console.log(`quadrant:    ${task.quadrant}`);
  console.log(`due:         ${task.dueDate || '—'}`);
  console.log(`importance:  ${task.importance}   urgency: ${task.urgency}`);
  console.log(`done:        ${Boolean(task.done)}${task.doneAt ? ` (${task.doneAt})` : ''}`);
  console.log(`archived:    ${Boolean(task.archived)}${task.archivedAt ? ` (${task.archivedAt})` : ''}`);
  if (task.note) console.log(`note:        ${task.note}`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function numberFlag(value, name, min, max) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`--${name} must be a number between ${min} and ${max}`);
  return n;
}

function dueFlag(value) {
  if (value === undefined) return undefined;
  if (value === true) throw new Error('--due needs a value: YYYY-MM-DD (or "clear")');
  if (value === 'clear' || value === 'none') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('--due must be YYYY-MM-DD (or "clear")');
  return value;
}

function editsFromFlags(flags) {
  const edits = {};
  if (typeof flags.title === 'string') edits.title = flags.title;
  if (typeof flags.note === 'string') edits.note = flags.note;
  if (flags.quadrant !== undefined) {
    if (!QUADRANTS.includes(flags.quadrant)) throw new Error(`--quadrant must be one of: ${QUADRANTS.join(', ')}`);
    edits.quadrant = flags.quadrant;
  }
  const due = dueFlag(flags.due);
  if (due !== undefined) edits.dueDate = due;
  const importance = numberFlag(flags.importance, 'importance', 0, 100);
  if (importance !== undefined) edits.importance = importance;
  const urgency = numberFlag(flags.urgency, 'urgency', 0, 100);
  if (urgency !== undefined) edits.urgency = urgency;
  return edits;
}

const HELP = `decisive — read and fully control the local Decisive task app.

Usage:
  decisive list [--all] [--quadrant do|schedule|delegate|eliminate] [--date YYYY-MM-DD] [--json]
  decisive show <id>
  decisive add "title" [--quadrant q] [--due YYYY-MM-DD] [--note "text"] [--importance 0-100] [--urgency 0-100] [--json]
  decisive edit <id> [--title "..."] [--note "..."] [--quadrant q] [--due YYYY-MM-DD|clear] [--importance N] [--urgency N] [--json]
  decisive done <id> [--undo] [--json]
  decisive archive <id> [--json]      mark done (if needed), then archive
  decisive restore <id> [--json]      bring an archived task back
  decisive rm <id> --yes [--json]     permanently delete

Notes:
  - <id> accepts any unique prefix of the task id; ids come from "decisive list".
  - --verbose prints each HTTP request URL to stderr (stdout stays machine-readable).
  - list shows active tasks by default; --all includes done and archived.
  - The CLI talks to the running app (127.0.0.1:4321). If the app is closed it
    starts a headless server with the same data file, so agents always work.
  - Data file: ~/Library/Application Support/eisenhower/data.json
  - Override target with env DECISIVE_API / DECISIVE_PORT / DECISIVE_DATA_FILE.

Examples:
  decisive list --json
  decisive add "Prepare weekly review" --quadrant schedule --due 2026-10-17
  decisive done 3f2a11c9
  decisive archive 3f2a11c9
`;

async function main() {
  const argv = process.argv.slice(2);
  const commandIndex = argv.findIndex(arg => !arg.startsWith('-'));
  const command = commandIndex === -1 ? '' : argv[commandIndex];
  const rest = argv.filter((_, index) => index !== commandIndex);
  const { positional, flags } = parseArgs(rest);
  VERBOSE = flags.verbose === true;

  if (!command || command === 'help' || flags.help === true) {
    console.log(HELP.trimEnd());
    return;
  }

  await ensureServer();

  if (command === 'list' || command === 'ls') {
    let tasks = await allTasks();
    if (flags.all !== true) tasks = tasks.filter(task => !task.done && !task.archived);
    if (flags.quadrant !== undefined) {
      if (!QUADRANTS.includes(flags.quadrant)) throw new Error(`--quadrant must be one of: ${QUADRANTS.join(', ')}`);
      tasks = tasks.filter(task => task.quadrant === flags.quadrant);
    }
    if (flags.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) throw new Error('--date must be YYYY-MM-DD');
      tasks = tasks.filter(task => task.dueDate === flags.date);
    }
    tasks.sort((a, b) => QUADRANTS.indexOf(a.quadrant) - QUADRANTS.indexOf(b.quadrant) || a.order - b.order);
    if (flags.json === true) console.log(JSON.stringify(tasks, null, 2));
    else printList(tasks);
    return;
  }

  if (command === 'show') {
    const task = await resolveId(positional[0]);
    if (flags.json === true) console.log(JSON.stringify(task, null, 2));
    else printTask(task);
    return;
  }

  if (command === 'add') {
    const title = positional.join(' ').trim();
    if (!title) throw new Error('add needs a title: decisive add "Buy milk"');
    const body = { title, quadrant: 'do' };
    Object.assign(body, editsFromFlags(flags));
    body.title = title;
    const task = await api('POST', '/api/tasks', body);
    if (flags.json === true) console.log(JSON.stringify(task, null, 2));
    else console.log(`Added ${String(task.id).slice(0, 8)}  ${task.title}${task.dueDate ? ` (due ${formatDate(task.dueDate)})` : ''}`);
    return;
  }

  if (command === 'edit' || command === 'update') {
    const task = await resolveId(positional[0]);
    const edits = editsFromFlags(flags);
    if (!Object.keys(edits).length) throw new Error('Nothing to change. Use flags like --title/--note/--quadrant/--due/--importance/--urgency.');
    const updated = await api('PATCH', `/api/tasks/${task.id}`, edits);
    if (flags.json === true) console.log(JSON.stringify(updated, null, 2));
    else console.log(`Updated ${String(task.id).slice(0, 8)}  ${updated.title}`);
    return;
  }

  if (command === 'done' || command === 'complete') {
    const task = await resolveId(positional[0]);
    const target = flags.undo !== true;
    const updated = await api('PATCH', `/api/tasks/${task.id}`, { done: target });
    if (flags.json === true) console.log(JSON.stringify(updated, null, 2));
    else console.log(`${target ? 'Completed' : 'Reopened'} ${String(task.id).slice(0, 8)}  ${task.title}`);
    return;
  }

  if (command === 'archive') {
    const task = await resolveId(positional[0]);
    if (!task.done) await api('PATCH', `/api/tasks/${task.id}`, { done: true });
    const updated = await api('PATCH', `/api/tasks/${task.id}`, { archived: true });
    if (flags.json === true) console.log(JSON.stringify(updated, null, 2));
    else console.log(`Archived ${String(task.id).slice(0, 8)}  ${task.title}`);
    return;
  }

  if (command === 'restore') {
    const task = await resolveId(positional[0]);
    const updated = await api('PATCH', `/api/tasks/${task.id}`, { archived: false });
    if (flags.json === true) console.log(JSON.stringify(updated, null, 2));
    else console.log(`Restored ${String(task.id).slice(0, 8)}  ${task.title}`);
    return;
  }

  if (command === 'rm' || command === 'delete') {
    const task = await resolveId(positional[0]);
    if (flags.yes !== true) {
      console.error(`Refusing to delete "${task.title}" (${String(task.id).slice(0, 8)}) without --yes.`);
      process.exitCode = 1;
      return;
    }
    await api('DELETE', `/api/tasks/${task.id}`);
    if (flags.json === true) console.log(JSON.stringify({ ok: true, deleted: task.id }));
    else console.log(`Deleted ${String(task.id).slice(0, 8)}  ${task.title}`);
    return;
  }

  throw new Error(`Unknown command "${command}". Run: decisive help`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
