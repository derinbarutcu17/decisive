const API = '/api/tasks';
const PREVIEW_STORAGE_KEY = 'decisive.preview.tasks.v2';
const isPreviewMode = () => {
  const host = window.location.hostname;
  return host.endsWith('.vercel.app') || host.endsWith('.github.io') || new URLSearchParams(window.location.search).get('demo') === '1';
};
const QLABELS = { do: 'Do', schedule: 'Schedule', delegate: 'Delegate', eliminate: 'Eliminate' };
const GRID_VALUES = Array.from({ length: 21 }, (_, index) => index * 5);
const DEFAULT_SCATTER = {
  do: { importance: 75, urgency: 75 },
  schedule: { importance: 75, urgency: 25 },
  delegate: { importance: 25, urgency: 75 },
  eliminate: { importance: 25, urgency: 25 },
};
const PREVIEW_DEMO_TASKS = [
  ['preview-001', 'Ship the interaction spec', 'do', 0, 85, 95],
  ['preview-002', 'Polish onboarding focus states', 'do', 1, 75, 85],
  ['preview-003', 'Prepare launch screenshots', 'do', 2, 65, 75],
  ['preview-004', 'Prototype research dashboard filters', 'schedule', 0, 85, 35],
  ['preview-005', 'Plan the design-token migration', 'schedule', 1, 75, 25],
  ['preview-006', 'Map the next usability study', 'schedule', 2, 65, 15],
  ['preview-007', 'QA the component library in Safari', 'delegate', 0, 35, 75],
  ['preview-008', 'Write accessibility notes for charts', 'delegate', 1, 45, 65],
  ['preview-009', 'Remove duplicate dashboard variants', 'eliminate', 0, 15, 35],
  ['preview-010', 'Archive unused Figma explorations', 'eliminate', 1, 10, 25],
  ['preview-011', 'Audit loading and error states', 'do', 0, 75, 75, true, -3],
  ['preview-012', 'Publish the component usage guide', 'schedule', 0, 65, 55, true, -2],
  ['preview-013', 'Review the visual regression report', 'delegate', 0, 45, 45, true, -1],
  ['preview-014', 'Resolve the old navigation fork', 'eliminate', 0, 10, 10, true, -8],
];
const SCATTER_COLORS = { do: '--do-color', schedule: '--schedule-color', delegate: '--delegate-color', eliminate: '--eliminate-color' };
let tasks = [];
let captureBusy = false;
let currentView = 'matrix';
let selectedScatterId = null;
let scatterDrag = null;
let viewSwitchPillReady = false;
let scatterLabelLayoutFrame = 0;
let scatterLabelCommitFrame = 0;
let scatterLabelLayoutSequence = 0;
let scatterLabelLayoutRequest = { activeId: null };
const scatterDrafts = new Map();
const scatterPersistence = new Map();
const scatterLabelPositions = new Map();
const scatterLabelMemory = new Map();
let scatterLabelPendingCommit = null;
const scatterDotMotions = new WeakMap();
const valueFlashTimers = new WeakMap();
let scatterPersistSequence = 0;
let statusTimer = 0;
let asciiBackgroundEnabled = true;
let scatterNamesVisible = false;
let metalEffectEnabled = true;
let originalLayoutEnabled = false;
let eliminateRecovery = null;

// Labels are allowed to avoid nearby labels, but they are never allowed to
// become a second, global layout system. These limits keep every name tethered
// to its own dot and keep a drag from reflowing the entire plot.
const SCATTER_LABEL_COLLISION_GAP = 4;
const SCATTER_LABEL_MAX_NUDGE = 12;
const SCATTER_LABEL_ESCAPE = 160;
const SCATTER_LABEL_MAX_REACTIVE_DEPTH = 4;
const SCATTER_LABEL_MAX_REACTIVE_COUNT = 8;
const SCATTER_LABEL_ANCHOR_SWITCH_MARGIN = 0.2;
const SCATTER_LABEL_ANCHOR_LOCK_MS = 120;
const SCATTER_LABEL_OVERFLOW_WEIGHT = 10000;
// A visible collision is more disruptive than a small, bounded escape from
// the plot edge. Keep this priority explicit so dense clusters do not choose
// an overlapping in-bounds label simply to save a few pixels of overflow.
const SCATTER_LABEL_COLLISION_WEIGHT = 50000;
// A small visual gap is part of the collision contract. Penalize candidates
// that leave labels technically separate but still visually touching more
// strongly than a small amount of movement, so dense clusters settle cleanly
// instead of stopping a couple of pixels apart.
const SCATTER_LABEL_GAP_WEIGHT = 25000;
const SCATTER_LABEL_MOVEMENT_WEIGHT = 0.35;

try {
  asciiBackgroundEnabled = localStorage.getItem('decisive.asciiBackgroundEnabled') !== 'false';
  scatterNamesVisible = localStorage.getItem('decisive.scatterNamesVisible') === 'true';
  metalEffectEnabled = localStorage.getItem('decisive.metalEffectEnabled') !== 'false';
  originalLayoutEnabled = localStorage.getItem('decisive.originalLayoutEnabled') === 'true';
} catch {}

const $ = sel => document.querySelector(sel);
const quadrants = () => [...document.querySelectorAll('.quadrant:not(.done-section)')];
const cardIn = id => document.querySelector(`.card[data-id="${id}"]`);

function readPreviewTasks() {
  if (!isPreviewMode()) return null;
  try {
    const value = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY) || 'null');
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}

function persistPreviewTasks() {
  if (!isPreviewMode()) return;
  try { localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(tasks)); } catch {}
}

function previewMutationFallback(method, path, body = {}) {
  if (!isPreviewMode()) return null;
  if (method === 'DELETE') return { ok: true };
  if (method === 'POST' && path === '/api/demo/restore') {
    const restored = PREVIEW_DEMO_TASKS.map(([id, title, quadrant, order, importance, urgency, done = false, daysAgo = 0]) => ({
      id,
      title,
      note: '',
      quadrant,
      order,
      done,
      doneAt: done ? new Date(Date.now() - Math.max(0, -daysAgo) * 24 * 60 * 60 * 1000).toISOString() : null,
      archived: false,
      archivedAt: null,
      importance,
      urgency,
    }));
    return { ok: true, restored: restored.length, tasks: restored };
  }
  if (method === 'POST' && path === API) {
    const quadrant = ['do', 'schedule', 'delegate', 'eliminate'].includes(body.quadrant) ? body.quadrant : 'do';
    const defaults = DEFAULT_SCATTER[quadrant] || DEFAULT_SCATTER.do;
    return {
      id: `preview-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: String(body.title || ''),
      note: String(body.note || ''),
      quadrant,
      order: cardsFor(quadrant).length,
      done: false,
      doneAt: null,
      archived: false,
      archivedAt: null,
      importance: defaults.importance,
      urgency: defaults.urgency,
    };
  }
  if (method !== 'PATCH') return null;
  const id = path.match(/\/api\/tasks\/([^/?]+)/)?.[1];
  const current = tasks.find(task => String(task.id) === String(id));
  if (!current) return null;
  const next = { ...current, ...body };
  if ('done' in body) {
    next.done = Boolean(body.done);
    next.doneAt = next.done ? (next.doneAt || new Date().toISOString()) : null;
    if (!next.done) { next.archived = false; next.archivedAt = null; }
  }
  if ('archived' in body) {
    next.archived = Boolean(body.archived);
    next.archivedAt = next.archived ? (next.archivedAt || new Date().toISOString()) : null;
  }
  return next;
}

async function api(method, path, body) {
  if (method !== 'GET') {
    // Vercel functions are stateless, so preview mutations must stay local.
    const previewFallback = previewMutationFallback(method, path, body);
    if (previewFallback !== null) return previewFallback;
  }
  const retryable = ['GET', 'DELETE'].includes(method) || (method === 'POST' && path === '/api/demo/restore');
  let lastError = new Error('offline');
  for (let attempt = 0; attempt < (retryable ? 3 : 1); attempt += 1) {
    try {
      const r = await fetch(path, {
        method,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.ok) return r.json();
      lastError = new Error(`HTTP ${r.status}`);
      const transient = [408, 425, 429, 500, 502, 503, 504].includes(r.status);
      if (!retryable || !transient || attempt === 2) throw lastError;
    } catch (error) {
      lastError = error;
      if (!retryable || attempt === 2) {
        const fallback = previewMutationFallback(method, path, body);
        if (fallback !== null) return fallback;
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
  }
  throw lastError;
}

function setStatus(message, state = 'neutral', { autoHide = false } = {}) {
  const status = $('#app-status');
  if (!status) return;
  window.clearTimeout(statusTimer);
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = !message;
  if (message && autoHide) {
    statusTimer = window.setTimeout(() => {
      status.hidden = true;
      status.textContent = '';
    }, 2600);
  }
}

function showSaveSuccess() {
  // Successful local writes stay silent; only actionable failures are surfaced.
  persistPreviewTasks();
  setStatus('');
}

function showSaveError() {
  setStatus('Couldn’t save changes. Your input is preserved.', 'error');
}

async function load() {
  setStatus('Loading local data…');
  const cachedTasks = readPreviewTasks();
  try {
    const remoteTasks = await api('GET', API);
    // The hosted preview is intentionally local-first. Vercel functions are
    // ephemeral, so a cold start must never erase a visitor's current board.
    tasks = readPreviewTasks() ?? remoteTasks;
    render();
    persistPreviewTasks();
    setStatus('');
  } catch {
    if (cachedTasks) {
      tasks = cachedTasks;
      render();
      setStatus('');
      return;
    }
    setStatus('Couldn’t load local data. Refresh to retry.', 'error');
  }
}

function cardsFor(q) { return tasks.filter(t => t.quadrant === q && !t.done && !t.archived).sort((a, b) => a.order - b.order); }
function doneItems() { return tasks.filter(t => t.done && !t.archived).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')); }
function archiveItems() { return tasks.filter(t => t.done && t.archived).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')); }

function snapWeight(value) {
  return GRID_VALUES.reduce((closest, point) => Math.abs(point - value) < Math.abs(closest - value) ? point : closest, GRID_VALUES[0]);
}

function scatterPosition(t) {
  const defaults = DEFAULT_SCATTER[t.quadrant] || DEFAULT_SCATTER.do;
  const draft = scatterDrafts.get(String(t.id));
  if (draft) return { importance: draft.importance, urgency: draft.urgency };
  return {
    importance: snapWeight(Number.isFinite(Number(t.importance)) ? Number(t.importance) : defaults.importance),
    urgency: snapWeight(Number.isFinite(Number(t.urgency)) ? Number(t.urgency) : defaults.urgency),
  };
}

function quadrantForPosition(importance, urgency) {
  const important = importance >= 50;
  const urgent = urgency >= 50;
  if (important && urgent) return 'do';
  if (important && !urgent) return 'schedule';
  if (!important && urgent) return 'delegate';
  return 'eliminate';
}

function gridIndex(value) {
  return Math.max(0, GRID_VALUES.indexOf(value));
}

function updateValueFlash(element, nextValue) {
  if (!element) return;
  const next = Number(nextValue);
  const previous = Number(element.dataset.value);
  element.textContent = String(nextValue);
  element.dataset.value = String(next);
  if (!Number.isFinite(previous) || previous === next) return;

  const previousTimer = valueFlashTimers.get(element);
  if (previousTimer) window.clearTimeout(previousTimer);
  element.classList.remove('value-flash', 'value-flash-up', 'value-flash-down');
  // Restart only the short-lived feedback cue. The badge itself keeps its
  // reserved dimensions, so the surrounding matrix never reflows.
  void element.offsetWidth;
  const direction = next > previous ? 'up' : 'down';
  element.classList.add('value-flash', `value-flash-${direction}`);
  valueFlashTimers.set(element, window.setTimeout(() => {
    element.classList.remove('value-flash', `value-flash-${direction}`);
    valueFlashTimers.delete(element);
  }, 700));
}

function updateCounts() {
  for (const q of quadrants()) updateValueFlash(q.querySelector('.count'), cardsFor(q.dataset.quadrant).length);
  const doneCount = doneItems().length;
  updateValueFlash($('#done .count'), doneCount);
  updateDoneDeleteControl(doneCount);
  const archiveCount = $('#archive-count');
  const archivedItems = archiveItems();
  if (archiveCount) updateValueFlash(archiveCount, archivedItems.length);
  updateArchiveDeleteControl(archivedItems.length);
  syncEliminateRail();
}

function updateDoneDeleteControl(doneCount = doneItems().length) {
  const deleteButton = $('#done-delete');
  const deleteActions = $('#done-delete-confirm');
  if (!deleteButton || !deleteActions) return;
  if (!doneCount) {
    deleteButton.hidden = true;
    deleteActions.hidden = true;
    return;
  }
  if (deleteActions.hidden) deleteButton.hidden = false;
}

function syncEliminateRail() {
  const section = document.querySelector('.quadrant[data-quadrant="eliminate"]');
  if (!section) return;
  const populated = cardsFor('eliminate').length > 0;
  section.classList.toggle('is-populated', populated);
  section.classList.toggle('is-empty', !populated);
  section.classList.toggle('has-recovery', Boolean(eliminateRecovery));
}

function showEliminateRecovery(taskId, previous) {
  eliminateRecovery = {
    taskId: String(taskId),
    previousDone: Boolean(previous.done),
    previousQuadrant: previous.quadrant,
    previousOrder: Number.isFinite(Number(previous.order)) ? Number(previous.order) : 0,
  };
  const panel = $('#eliminate-recovery');
  if (!panel) return;
  panel.querySelector('.eliminate-recovery-message').textContent = 'Moved to Eliminate';
  const undo = panel.querySelector('.eliminate-undo');
  undo.disabled = false;
  panel.hidden = false;
  syncEliminateRail();
}

function clearEliminateRecovery() {
  eliminateRecovery = null;
  const panel = $('#eliminate-recovery');
  if (panel) panel.hidden = true;
  syncEliminateRail();
}

async function undoEliminate() {
  const recovery = eliminateRecovery;
  if (!recovery) return;
  const button = $('#eliminate-recovery .eliminate-undo');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const body = recovery.previousDone
    ? { done: true, quadrant: recovery.previousQuadrant }
    : { done: false, quadrant: recovery.previousQuadrant, order: recovery.previousOrder };
  try {
    const updated = await api('PATCH', `${API}/${recovery.taskId}`, body);
    const task = tasks.find(item => String(item.id) === recovery.taskId);
    if (task) Object.assign(task, updated);
    clearEliminateRecovery();
    render();
    const restored = cardIn(recovery.taskId);
    if (restored) settleCard(restored);
    showSaveSuccess();
  } catch {
    if (button) button.disabled = false;
    showSaveError();
  }
}

function setupEliminateRecovery() {
  $('.eliminate-undo')?.addEventListener('click', event => {
    event.stopPropagation();
    void undoEliminate();
  });
}

function writeScatterDotPosition(dot, x, y) {
  dot.style.setProperty('--scatter-x', `${x}%`);
  dot.style.setProperty('--scatter-y', `${y}%`);
  dot.dataset.scatterX = String(x);
  dot.dataset.scatterY = String(y);
}

function animateScatterDotPosition(dot, x, y) {
  const existing = scatterDotMotions.get(dot);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    if (existing?.raf) cancelAnimationFrame(existing.raf);
    writeScatterDotPosition(dot, x, y);
    scatterDotMotions.set(dot, { currentX: x, currentY: y, targetX: x, targetY: y, raf: 0 });
    return;
  }
  if (existing?.raf) {
    existing.targetX = x;
    existing.targetY = y;
    return;
  }
  const fromX = Number.isFinite(existing?.currentX) ? existing.currentX : Number.parseFloat(dot.dataset.scatterX || x);
  const fromY = Number.isFinite(existing?.currentY) ? existing.currentY : Number.parseFloat(dot.dataset.scatterY || y);
  if (Math.abs(fromX - x) < .01 && Math.abs(fromY - y) < .01) {
    writeScatterDotPosition(dot, x, y);
    scatterDotMotions.set(dot, { currentX: x, currentY: y, targetX: x, targetY: y, raf: 0 });
    return;
  }
  const state = { currentX: fromX, currentY: fromY, targetX: x, targetY: y, raf: 0 };
  scatterDotMotions.set(dot, state);
  const tick = () => {
    const dragging = dot.classList.contains('is-dragging');
    const follow = dragging ? .46 : .22;
    state.currentX += (state.targetX - state.currentX) * follow;
    state.currentY += (state.targetY - state.currentY) * follow;
    writeScatterDotPosition(dot, state.currentX, state.currentY);
    // Follow the rendered position while dragging. The scheduler coalesces
    // this to one layout pass per frame so labels stay smooth without thrash.
    if (dragging) scheduleScatterLabelLayout(dot.dataset.id);
    if (Math.abs(state.targetX - state.currentX) > .02 || Math.abs(state.targetY - state.currentY) > .02) {
      state.raf = requestAnimationFrame(tick);
    } else {
      state.currentX = state.targetX;
      state.currentY = state.targetY;
      writeScatterDotPosition(dot, state.currentX, state.currentY);
      state.raf = 0;
    }
  };
  state.raf = requestAnimationFrame(tick);
}

function setScatterDotPosition(dot, importance, urgency, { animate = false } = {}) {
  const x = 100 - urgency;
  const y = 100 - importance;
  if (animate && dot.isConnected) animateScatterDotPosition(dot, x, y);
  else {
    const existing = scatterDotMotions.get(dot);
    if (existing?.raf) cancelAnimationFrame(existing.raf);
    writeScatterDotPosition(dot, x, y);
    scatterDotMotions.set(dot, { currentX: x, currentY: y, targetX: x, targetY: y, raf: 0 });
  }
  dot.dataset.importance = String(importance);
  dot.dataset.urgency = String(urgency);
  dot.dataset.tooltipPlacement = scatterTooltipPlacement({ importance, urgency });
}

function selectScatterTask(id) {
  selectedScatterId = id == null ? null : String(id);
  document.querySelectorAll('.scatter-task').forEach(dot => {
    const selected = dot.dataset.id === selectedScatterId;
    dot.classList.toggle('is-selected', selected);
    dot.classList.toggle('is-frontmost', selected);
    dot.setAttribute('aria-selected', String(selected));
  });
  scheduleScatterLabelLayout();
}

function scatterDotLabel(task, position) {
  return `${task.title || 'Untitled'} — Importance ${position.importance}, Urgency ${position.urgency}.`;
}

function scatterTooltipPlacement(position) {
  const vertical = position.importance >= 50 ? 'below' : 'above';
  const horizontal = position.urgency >= 75 ? 'right' : position.urgency <= 25 ? 'left' : 'center';
  return vertical + '-' + horizontal;
}

// The hit target is 32px but the visible dot is 12px. A -5px tether gap leaves
// the task tag about 5px from the visible dot instead of 21px from it. Keep
// this separate from the positive clearance required between two labels.
const SCATTER_LABEL_TETHER_GAP = -5;
const SCATTER_LABEL_GAP = 4;
const SCATTER_LABEL_ANCHOR = 10;
const SCATTER_LABEL_INSET = 6;
const SCATTER_LABEL_CANDIDATES = [
  'below-center', 'above-center', 'below-left', 'below-right', 'above-left', 'above-right',
  'left-center', 'right-center',
];

function labelIsVisible(dot) {
  return scatterNamesVisible
    || dot.matches(':hover')
    || dot.matches(':focus-visible')
    || dot.classList.contains('is-dragging');
}

function labelCandidatePosition(dotRect, labelWidth, labelHeight, placement) {
  const centerX = dotRect.left + dotRect.width / 2;
  const centerY = dotRect.top + dotRect.height / 2;
  const positions = {
    'below-center': { left: centerX - labelWidth / 2, top: dotRect.bottom + SCATTER_LABEL_TETHER_GAP },
    'above-center': { left: centerX - labelWidth / 2, top: dotRect.top - labelHeight - SCATTER_LABEL_TETHER_GAP },
    'below-left': { left: dotRect.left - labelWidth + SCATTER_LABEL_ANCHOR, top: dotRect.bottom + SCATTER_LABEL_TETHER_GAP },
    'below-right': { left: dotRect.right - SCATTER_LABEL_ANCHOR, top: dotRect.bottom + SCATTER_LABEL_TETHER_GAP },
    'above-left': { left: dotRect.left - labelWidth + SCATTER_LABEL_ANCHOR, top: dotRect.top - labelHeight - SCATTER_LABEL_TETHER_GAP },
    'above-right': { left: dotRect.right - SCATTER_LABEL_ANCHOR, top: dotRect.top - labelHeight - SCATTER_LABEL_TETHER_GAP },
    'left-center': { left: dotRect.left - labelWidth - SCATTER_LABEL_TETHER_GAP, top: centerY - labelHeight / 2 },
    'right-center': { left: dotRect.right + SCATTER_LABEL_TETHER_GAP, top: centerY - labelHeight / 2 },
  };
  return positions[placement] || positions['below-center'];
}

function scatterLabelWidth(dot, plotRect) {
  const label = dot.querySelector('.scatter-task-label');
  if (!label) return 96;
  const maxWidth = dot.classList.contains('is-frontmost') ? 380 : 320;
  const plotWidth = plotRect ? Math.max(96, plotRect.width - SCATTER_LABEL_INSET * 2) : maxWidth;
  const widthLimit = Math.min(maxWidth, plotWidth);
  // Measure in an isolated probe instead of mutating the positioned label.
  // A positioned label can retain the previous solver width (or inherit a
  // max-width during a concurrent render), which makes max-content resolve to
  // the 320px cap in slower browsers. That inflated every label and made the
  // collision solver nondeterministic. The probe has no transform, offsets, or
  // parent constraints, so its width is always the actual single-line content
  // width before the plot limit is applied.
  const probe = label.cloneNode(true);
  probe.classList.remove('is-positioned', 'is-measuring', 'is-reactive');
  probe.style.setProperty('position', 'fixed', 'important');
  probe.style.setProperty('left', '-10000px', 'important');
  probe.style.setProperty('top', '-10000px', 'important');
  probe.style.setProperty('width', 'max-content', 'important');
  probe.style.setProperty('max-width', 'none', 'important');
  probe.style.setProperty('min-width', '0', 'important');
  probe.style.setProperty('white-space', 'nowrap', 'important');
  probe.style.setProperty('transform', 'none', 'important');
  probe.style.setProperty('visibility', 'hidden', 'important');
  document.body.appendChild(probe);
  const intrinsicWidth = Math.ceil(probe.getBoundingClientRect().width);
  probe.remove();
  return Math.max(96, Math.min(widthLimit, intrinsicWidth));
}

function labelOverflow(rect, bounds, inset = 0) {
  return Math.max(0, bounds.left + inset - rect.left)
    + Math.max(0, rect.right - bounds.right + inset)
    + Math.max(0, bounds.top + inset - rect.top)
    + Math.max(0, rect.bottom - bounds.bottom + inset);
}

// Original collision fallback: when the nearby anchor candidates are full,
// place the label on a stable plot rail instead of letting it drift away from
// its dot. This is intentionally kept separate from the newer reactive solver
// so the original Scatter behavior can be restored without touching sizing.
function scatterLabelRailPositions(plotRect, labelWidth, labelHeight) {
  const columns = Math.max(1, Math.floor((plotRect.width - SCATTER_LABEL_INSET * 2 + SCATTER_LABEL_GAP) / (labelWidth + SCATTER_LABEL_GAP)));
  const rowHeight = labelHeight + SCATTER_LABEL_GAP;
  const positions = [];
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push({
        left: plotRect.left + SCATTER_LABEL_INSET + column * (labelWidth + SCATTER_LABEL_GAP),
        top: plotRect.top + SCATTER_LABEL_INSET + row * rowHeight,
      });
    }
  }
  return positions;
}

function scatterLabelFallbackSlots(plotRect, measurements, count) {
  const maxWidth = Math.max(...[...measurements.values()].map(measurement => measurement.labelWidth), 96);
  const maxHeight = Math.max(...[...measurements.values()].map(measurement => measurement.labelHeight), 34);
  const columns = Math.max(1, Math.floor((plotRect.width - SCATTER_LABEL_INSET * 2 + SCATTER_LABEL_GAP) / (maxWidth + SCATTER_LABEL_GAP)));
  const rows = Math.ceil(Math.max(count, 1) / columns);
  const slots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        left: plotRect.left + SCATTER_LABEL_INSET + column * (maxWidth + SCATTER_LABEL_GAP),
        top: plotRect.top + SCATTER_LABEL_INSET + row * (maxHeight + SCATTER_LABEL_GAP),
      });
    }
  }
  return slots;
}

function measuredLabelRect(position, labelWidth, labelHeight, plotRect) {
  return {
    left: position.left,
    top: position.top,
    right: position.left + labelWidth,
    bottom: position.top + labelHeight,
    width: labelWidth,
    height: labelHeight,
    inside: position.left >= plotRect.left + SCATTER_LABEL_INSET
      && position.left + labelWidth <= plotRect.right - SCATTER_LABEL_INSET
      && position.top >= plotRect.top + SCATTER_LABEL_INSET
      && position.top + labelHeight <= plotRect.bottom - SCATTER_LABEL_INSET,
  };
}

function labelRectsOverlap(a, b, gap = 6) {
  return !(a.right + gap <= b.left
    || b.right + gap <= a.left
    || a.bottom + gap <= b.top
    || b.bottom + gap <= a.top);
}

function labelOverlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function labelGapDeficit(a, b, gap = SCATTER_LABEL_COLLISION_GAP) {
  const horizontalOverlap = a.left < b.right && b.left < a.right;
  const verticalOverlap = a.top < b.bottom && b.top < a.bottom;
  if (horizontalOverlap) return Math.max(0, gap - Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)));
  if (verticalOverlap) return Math.max(0, gap - Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)));
  return 0;
}

function labelMemoryFor(taskKey) {
  let memory = scatterLabelMemory.get(taskKey);
  if (!memory) {
    memory = { collisionSince: 0, lockedUntil: 0 };
    scatterLabelMemory.set(taskKey, memory);
  }
  return memory;
}

function labelCandidateScore(candidate, obstacles, previousRect, previousPlacement, plotRect) {
  let collisionArea = 0;
  let gapDeficit = 0;
  for (const obstacle of obstacles) {
    collisionArea += labelOverlapArea(candidate.measured, obstacle);
    gapDeficit += labelGapDeficit(candidate.measured, obstacle);
  }
  const movement = previousRect
    ? Math.hypot(candidate.left - previousRect.left, candidate.top - previousRect.top)
    : 0;
  const switchedAnchor = previousPlacement && candidate.placement !== previousPlacement ? 1 : 0;
  return labelOverflow(candidate.measured, plotRect, SCATTER_LABEL_INSET) * SCATTER_LABEL_OVERFLOW_WEIGHT
    + collisionArea * SCATTER_LABEL_COLLISION_WEIGHT
    + gapDeficit * SCATTER_LABEL_GAP_WEIGHT
    + movement * SCATTER_LABEL_MOVEMENT_WEIGHT
    + switchedAnchor * SCATTER_LABEL_ANCHOR_SWITCH_MARGIN * 100;
}

function labelCandidateSet(measurement) {
  const { dotRect, labelWidth, labelHeight, previousOffset } = measurement;
  const preferred = measurement.dot.dataset.tooltipPlacement;
  const previousPlacement = previousOffset?.placement;
  const placements = [previousPlacement, preferred, ...SCATTER_LABEL_CANDIDATES]
    .filter((placement, index, list) => placement && list.indexOf(placement) === index);
  const candidates = [];

  if (previousOffset) {
    candidates.push({
      placement: previousPlacement || preferred,
      left: dotRect.left + Number(previousOffset.left || 0),
      top: dotRect.top + Number(previousOffset.top || 0),
      isCurrent: true,
    });
  }

  // Keep the first choices close to the dot, then offer a small set of
  // diagonal/ring positions for dense clusters. This lets labels separate
  // without falling onto distant rails or making the whole plot reflow.
  const nudges = [{ x: 0, y: 0 }];
  for (const radius of [SCATTER_LABEL_MAX_NUDGE, 24, 40, 64, 88, 112, 136, 160]) {
    for (const x of [-radius, 0, radius]) {
      for (const y of [-radius, 0, radius]) {
        if (x || y) nudges.push({ x, y });
      }
    }
  }
  for (const placement of placements) {
    const base = labelCandidatePosition(dotRect, labelWidth, labelHeight, placement);
    for (const nudge of nudges) {
      candidates.push({
        placement,
        left: base.left + nudge.x,
        top: base.top + nudge.y,
        isCurrent: false,
      });
    }
  }
  return candidates;
}

function labelPriority(dot, activeKey) {
  if (activeKey && dot.dataset.id === activeKey) return 0;
  if (dot.classList.contains('is-dragging')) return 1;
  if (dot.matches(':focus-visible')) return 2;
  if (dot.matches(':hover')) return 3;
  if (dot.classList.contains('is-selected')) return 4;
  return 5;
}

function labelRectFromOffset(measurement, offset, plotRect) {
  return measuredLabelRect({
    left: measurement.dotRect.left + Number(offset?.left || 0),
    top: measurement.dotRect.top + Number(offset?.top || 0),
  }, measurement.labelWidth, measurement.labelHeight, plotRect);
}

function clearMeasuredLabelPosition(label) {
  label.classList.remove('is-positioned');
  label.style.removeProperty('--scatter-label-left');
  label.style.removeProperty('--scatter-label-top');
}

function layoutScatterLabels({ activeId = null } = {}) {
  const plot = $('#scatter-plot');
  const container = $('#scatter-tasks');
  if (!plot || !container) return;
  const layoutSequence = ++scatterLabelLayoutSequence;
  const activeKey = activeId == null ? null : String(activeId);
  const plotRect = plot.getBoundingClientRect();
  const labelBounds = {
    left: plotRect.left - SCATTER_LABEL_ESCAPE,
    right: plotRect.right + SCATTER_LABEL_ESCAPE,
    top: plotRect.top - SCATTER_LABEL_ESCAPE,
    bottom: plotRect.bottom + SCATTER_LABEL_ESCAPE,
  };
  const dots = [...container.querySelectorAll('.scatter-task')];
  const domOrder = new Map(dots.map((dot, index) => [dot, index]));
  const visibleDots = dots.filter(labelIsVisible).sort((a, b) => {
    const aActive = activeKey && a.dataset.id === activeKey ? 0 : 1;
    const bActive = activeKey && b.dataset.id === activeKey ? 0 : 1;
    const aFront = a.classList.contains('is-frontmost') ? 0 : 1;
    const bFront = b.classList.contains('is-frontmost') ? 0 : 1;
    return aActive - bActive || aFront - bFront || domOrder.get(a) - domOrder.get(b);
  });
  for (const dot of dots) {
    const label = dot.querySelector('.scatter-task-label');
    if (label && !labelIsVisible(dot)) clearMeasuredLabelPosition(label);
  }
  // Measure every visible label before solving. The solver only uses these
  // stable target offsets; it never feeds an in-flight transform back into the
  // next target, which is what makes a label chase/jitter during a drag.
  const measurements = new Map();
  for (const dot of visibleDots) {
    const label = dot.querySelector('.scatter-task-label');
    if (!label) continue;
    const taskKey = dot.dataset.id;
    const dotRect = dot.getBoundingClientRect();
    const previousOffset = scatterLabelPositions.get(taskKey);
    label.classList.add('is-measuring');
    label.style.setProperty('visibility', 'hidden');
    const labelWidth = scatterLabelWidth(dot, plotRect);
    label.style.width = `${labelWidth}px`;
    label.style.maxWidth = `${labelWidth}px`;
    const labelHeight = label.offsetHeight;
    measurements.set(dot, { dot, label, taskKey, dotRect, previousOffset, labelWidth, labelHeight });
  }

  const measurementByKey = new Map([...measurements.values()].map(measurement => [measurement.taskKey, measurement]));
  const currentRects = new Map();
  for (const measurement of measurements.values()) {
    const previous = measurement.previousOffset;
    const preferred = labelCandidatePosition(
      measurement.dotRect,
      measurement.labelWidth,
      measurement.labelHeight,
      measurement.dot.dataset.tooltipPlacement,
    );
    currentRects.set(measurement.taskKey, previous
      ? labelRectFromOffset(measurement, previous, plotRect)
      : measuredLabelRect(preferred, measurement.labelWidth, measurement.labelHeight, plotRect));
  }

  // Build a small collision-connected component around the active label. A
  // first render solves all labels; later drags leave unrelated labels at their
  // existing targets so the plot never ripples as one global packer.
  const stableLayout = visibleDots.every(dot => scatterLabelPositions.has(dot.dataset.id));
  const reactiveKeys = new Set();
  const activeMeasurement = activeKey ? measurementByKey.get(activeKey) : null;
  if (!activeMeasurement || !stableLayout) {
    for (const measurement of measurements.values()) reactiveKeys.add(measurement.taskKey);
  } else {
    const queue = [{ key: activeKey, depth: 0 }];
    reactiveKeys.add(activeKey);
    while (queue.length && reactiveKeys.size < SCATTER_LABEL_MAX_REACTIVE_COUNT) {
      const current = queue.shift();
      const currentRect = currentRects.get(current.key);
      if (!currentRect || current.depth >= SCATTER_LABEL_MAX_REACTIVE_DEPTH) continue;
      for (const measurement of measurements.values()) {
        if (reactiveKeys.has(measurement.taskKey)) continue;
        if (!labelRectsOverlap(currentRect, currentRects.get(measurement.taskKey))) continue;
        reactiveKeys.add(measurement.taskKey);
        queue.push({ key: measurement.taskKey, depth: current.depth + 1 });
        if (reactiveKeys.size >= SCATTER_LABEL_MAX_REACTIVE_COUNT) break;
      }
    }
  }

  const reactiveDots = visibleDots
    .filter(dot => reactiveKeys.has(dot.dataset.id))
    .sort((a, b) => labelPriority(a, activeKey) - labelPriority(b, activeKey)
      || domOrder.get(a) - domOrder.get(b));
  const fixedObstacles = visibleDots
    .filter(dot => !reactiveKeys.has(dot.dataset.id))
    .map(dot => currentRects.get(dot.dataset.id))
    .filter(Boolean);
  const placedObstacles = [];
  const commits = [];
  const now = performance.now();

  for (const dot of reactiveDots) {
    const measurement = measurements.get(dot);
    if (!measurement) continue;
    const { label, taskKey, dotRect, previousOffset, labelWidth, labelHeight } = measurement;
    const previousPlacement = previousOffset?.placement;
    const previousRect = previousOffset ? labelRectFromOffset(measurement, previousOffset, plotRect) : null;
    const candidates = labelCandidateSet(measurement).map(candidate => ({
      ...candidate,
      measured: measuredLabelRect(
        { left: candidate.left, top: candidate.top },
        labelWidth,
        labelHeight,
        plotRect,
      ),
    }));
    const obstacles = [...fixedObstacles, ...placedObstacles];
    let best = null;
    let current = null;
    for (const candidate of candidates) {
      const score = labelCandidateScore(candidate, obstacles, previousRect, previousPlacement, labelBounds);
      candidate.score = score;
      if (candidate.isCurrent && !current) current = candidate;
      if (!best || score < best.score) best = candidate;
    }

    const memory = labelMemoryFor(taskKey);
    const currentScore = current?.score ?? Number.POSITIVE_INFINITY;
    if (current && previousPlacement && currentScore > 0) memory.collisionSince ||= now;
    else memory.collisionSince = 0;
    const collisionAge = memory.collisionSince ? now - memory.collisionSince : 0;
    const currentOverflow = current ? labelOverflow(current.measured, labelBounds, SCATTER_LABEL_INSET) : Number.POSITIVE_INFINITY;
    const currentIsClear = current
      ? obstacles.every(obstacle => !labelRectsOverlap(current.measured, obstacle, SCATTER_LABEL_GAP))
      : false;
    const bestImprovement = currentScore > 0 && Number.isFinite(currentScore)
      ? (currentScore - best.score) / currentScore
      : 0;
    const active = activeKey === taskKey;
    const anchorLocked = now < memory.lockedUntil && currentOverflow <= 12;
    const hysteresisHold = !active
      && current
      && currentIsClear
      && (anchorLocked || (collisionAge < 100 && currentOverflow <= 12) || bestImprovement < SCATTER_LABEL_ANCHOR_SWITCH_MARGIN);
    if (hysteresisHold) best = current;
    if (best.placement !== previousPlacement) memory.lockedUntil = now + SCATTER_LABEL_ANCHOR_LOCK_MS;

    const nextLeft = best.left - dotRect.left;
    const nextTop = best.top - dotRect.top;
    const next = {
      left: nextLeft,
      top: nextTop,
      placement: best.placement,
    };
    scatterLabelPositions.set(taskKey, next);
    commits.push({ dot, label, taskKey, nextLeft, nextTop, placement: best.placement, rect: best.measured });
    placedObstacles.push(best.measured);
  }

  // Labels outside the local component keep their logical targets verbatim.
  // This is the key difference between reactive local avoidance and a global
  // packing layout that makes every name jump on every drag.
  for (const dot of visibleDots) {
    if (reactiveKeys.has(dot.dataset.id)) continue;
    const measurement = measurements.get(dot);
    if (!measurement) continue;
    const previous = measurement.previousOffset;
    if (!previous) continue;
    commits.push({
      dot,
      label: measurement.label,
      taskKey: measurement.taskKey,
      nextLeft: Number(previous.left || 0),
      nextTop: Number(previous.top || 0),
      placement: previous.placement || measurement.dot.dataset.tooltipPlacement,
      rect: currentRects.get(measurement.taskKey),
    });
  }

  // Responsive layout and eased dot motion can expose a collision after the
  // local component has been solved. Repair only the colliding label, using
  // the same bounded candidate ring, so unrelated labels keep their targets
  // and the final committed geometry is deterministic across viewports.
  const labelPriorityByKey = new Map(visibleDots.map(dot => [
    dot.dataset.id,
    labelPriority(dot, activeKey),
  ]));
  const maxRepairs = Math.max(visibleDots.length * 2, 1);
  for (let repair = 0; repair < maxRepairs; repair += 1) {
    let collision = null;
    for (let i = 0; i < commits.length && !collision; i += 1) {
      for (let j = i + 1; j < commits.length; j += 1) {
        if (labelRectsOverlap(commits[i].rect, commits[j].rect, SCATTER_LABEL_GAP)) {
          collision = [commits[i], commits[j]];
          break;
        }
      }
    }
    if (!collision) break;

    const [first, second] = collision;
    const target = reactiveKeys.has(first.taskKey) && !reactiveKeys.has(second.taskKey)
      ? first
      : reactiveKeys.has(second.taskKey) && !reactiveKeys.has(first.taskKey)
        ? second
        : (labelPriorityByKey.get(first.taskKey) > labelPriorityByKey.get(second.taskKey) ? first : second);
    const measurement = measurements.get(target.dot);
    if (!measurement) break;
    const obstacles = commits
      .filter(commit => commit !== target && commit.rect)
      .map(commit => commit.rect);
    const repairCandidates = labelCandidateSet(measurement);
    // The regular candidate ring is intentionally sparse for normal motion.
    // When a responsive reflow leaves a collision behind, add exact separating
    // positions derived from the blocking rectangles. This keeps the repair
    // bounded and tethered while avoiding a case where every coarse ring
    // position remains a few pixels inside a neighboring label.
    for (const obstacle of obstacles) {
      const currentRect = target.rect;
      const horizontalOverlap = currentRect.left < obstacle.right + SCATTER_LABEL_GAP
        && currentRect.right + SCATTER_LABEL_GAP > obstacle.left;
      const verticalOverlap = currentRect.top < obstacle.bottom + SCATTER_LABEL_GAP
        && currentRect.bottom + SCATTER_LABEL_GAP > obstacle.top;
      if (horizontalOverlap && verticalOverlap) {
        repairCandidates.push(
          { placement: target.placement, left: obstacle.left - measurement.labelWidth - SCATTER_LABEL_GAP, top: currentRect.top },
          { placement: target.placement, left: obstacle.right + SCATTER_LABEL_GAP, top: currentRect.top },
          { placement: target.placement, left: currentRect.left, top: obstacle.top - measurement.labelHeight - SCATTER_LABEL_GAP },
          { placement: target.placement, left: currentRect.left, top: obstacle.bottom + SCATTER_LABEL_GAP },
        );
      }
    }
    // A dense CI-sized plot can exhaust every local anchor even after the
    // exact separating positions above have been tried. Reuse the bounded
    // plot rails as a deterministic last-resort escape hatch; unlike a free
    // packing layout, this still chooses the nearest clear slot to the dot
    // and never leaves the label outside the documented escape budget.
    for (const position of scatterLabelRailPositions(plotRect, measurement.labelWidth, measurement.labelHeight)) {
      repairCandidates.push({
        placement: target.placement,
        left: position.left,
        top: position.top,
        isRailFallback: true,
      });
    }
    const scoredCandidates = repairCandidates.map(candidate => {
      const measured = measuredLabelRect(
        { left: candidate.left, top: candidate.top },
        measurement.labelWidth,
        measurement.labelHeight,
        plotRect,
      );
      return {
        ...candidate,
        measured,
        score: labelCandidateScore(
          { ...candidate, measured },
          obstacles,
          target.rect,
          target.placement,
          labelBounds,
        ),
      };
    });
    const clearCandidates = scoredCandidates.filter(candidate => obstacles.every(obstacle => (
      !labelRectsOverlap(candidate.measured, obstacle, SCATTER_LABEL_GAP)
    )));
    const candidates = clearCandidates.length ? clearCandidates : scoredCandidates;
    const best = candidates.reduce((currentBest, candidate) => (
      !currentBest || candidate.score < currentBest.score ? candidate : currentBest
    ), null);
    if (!best) break;

    const nextLeft = best.left - measurement.dotRect.left;
    const nextTop = best.top - measurement.dotRect.top;
    const unchanged = Math.abs(nextLeft - target.nextLeft) <= 0.1
      && Math.abs(nextTop - target.nextTop) <= 0.1;
    if (unchanged) break;
    target.nextLeft = nextLeft;
    target.nextTop = nextTop;
    target.placement = best.placement;
    target.rect = best.measured;
    reactiveKeys.add(target.taskKey);
  }

  // If a sequence of responsive commits still leaves a collision, use a
  // deterministic in-plot slot map as a final safety net. This branch is
  // intentionally rare: normal layouts stay on the local tethered solver,
  // while dense or heavily resized layouts get a guaranteed non-overlapping
  // final geometry instead of exposing a stale overlap to the user.
  const remainingCollision = commits.some((commit, index) => commits
    .slice(index + 1)
    .some(other => labelRectsOverlap(commit.rect, other.rect, SCATTER_LABEL_GAP)));
  if (remainingCollision) {
    const slots = scatterLabelFallbackSlots(plotRect, measurements, commits.length);
    const assigned = new Set();
    const fallbackCommits = [...commits].sort((a, b) => (
      labelPriorityByKey.get(a.taskKey) - labelPriorityByKey.get(b.taskKey)
        || domOrder.get(a.dot) - domOrder.get(b.dot)
    ));
    for (const commit of fallbackCommits) {
      const measurement = measurements.get(commit.dot);
      if (!measurement) continue;
      const currentCenter = {
        x: commit.rect.left + commit.rect.width / 2,
        y: commit.rect.top + commit.rect.height / 2,
      };
      let bestSlot = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < slots.length; index += 1) {
        if (assigned.has(index)) continue;
        const slot = slots[index];
        const distance = Math.hypot(
          slot.left + measurement.labelWidth / 2 - currentCenter.x,
          slot.top + measurement.labelHeight / 2 - currentCenter.y,
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSlot = { index, slot };
        }
      }
      if (!bestSlot) continue;
      assigned.add(bestSlot.index);
      commit.nextLeft = bestSlot.slot.left - measurement.dotRect.left;
      commit.nextTop = bestSlot.slot.top - measurement.dotRect.top;
      commit.placement = commit.placement || measurement.dot.dataset.tooltipPlacement;
      commit.rect = measuredLabelRect(
        bestSlot.slot,
        measurement.labelWidth,
        measurement.labelHeight,
        plotRect,
      );
      reactiveKeys.add(commit.taskKey);
    }
  }

  for (const commit of commits) {
    commit.label.classList.add('is-positioned');
    commit.label.classList.toggle('is-reactive', reactiveKeys.has(commit.taskKey));
    const currentLeft = Number.parseFloat(commit.label.style.getPropertyValue('--scatter-label-left'));
    const currentTop = Number.parseFloat(commit.label.style.getPropertyValue('--scatter-label-top'));
    // Commit the latest target in this same layout frame. This lets CSS ease
    // directly from the current transform without exposing a stale frame.
    if (!Number.isFinite(currentLeft) || Math.abs(currentLeft - commit.nextLeft) > .1) {
      commit.label.style.setProperty('--scatter-label-left', `${commit.nextLeft}px`);
    }
    if (!Number.isFinite(currentTop) || Math.abs(currentTop - commit.nextTop) > .1) {
      commit.label.style.setProperty('--scatter-label-top', `${commit.nextTop}px`);
    }
    commit.label.classList.remove('is-measuring');
    commit.label.style.removeProperty('visibility');
  }
  scatterLabelPendingCommit = { sequence: layoutSequence, commits };
  scatterLabelPendingCommit = null;
}

function layoutScatterLabelsOriginal() {
  const plot = $('#scatter-plot');
  const container = $('#scatter-tasks');
  if (!plot || !container) return;
  const layoutSequence = ++scatterLabelLayoutSequence;
  const plotRect = plot.getBoundingClientRect();
  const dots = [...container.querySelectorAll('.scatter-task')];
  const domOrder = new Map(dots.map((dot, index) => [dot, index]));
  const visibleDots = dots.filter(labelIsVisible).sort((a, b) => {
    const aFront = a.classList.contains('is-frontmost') ? 0 : 1;
    const bFront = b.classList.contains('is-frontmost') ? 0 : 1;
    return aFront - bFront || domOrder.get(a) - domOrder.get(b);
  });
  const placed = [];
  const commits = [];

  for (const dot of dots) {
    const label = dot.querySelector('.scatter-task-label');
    if (label && !labelIsVisible(dot)) clearMeasuredLabelPosition(label);
  }

  for (const dot of visibleDots) {
    const label = dot.querySelector('.scatter-task-label');
    if (!label) continue;
    const taskKey = dot.dataset.id;
    const dotRect = dot.getBoundingClientRect();
    const previousOffset = scatterLabelPositions.get(taskKey);
    label.classList.add('is-measuring');
    label.style.setProperty('visibility', 'hidden');
    const labelWidth = scatterLabelWidth(dot, plotRect);
    label.style.width = `${labelWidth}px`;
    label.style.maxWidth = `${labelWidth}px`;
    const labelHeight = label.offsetHeight;
    const preferred = dot.dataset.tooltipPlacement;
    const previousPlacement = previousOffset?.placement;
    const candidates = [previousPlacement, preferred, ...SCATTER_LABEL_CANDIDATES]
      .filter((placement, index, list) => placement && list.indexOf(placement) === index);
    let best = null;

    for (const placement of candidates) {
      const position = labelCandidatePosition(dotRect, labelWidth, labelHeight, placement);
      const measured = measuredLabelRect(position, labelWidth, labelHeight, plotRect);
      const collisions = placed.filter(previous => labelRectsOverlap(measured, previous)).length;
      const score = collisions * 1000 + labelOverflow(measured, plotRect, SCATTER_LABEL_INSET);
      if (!best || score < best.score) best = { measured, score, placement, left: position.left, top: position.top };
      if (score === 0) break;
    }

    if (!best || best.score >= 1000) {
      let closestRail = null;
      const dotCenter = { x: dotRect.left + dotRect.width / 2, y: dotRect.top + dotRect.height / 2 };
      for (const position of scatterLabelRailPositions(plotRect, labelWidth, labelHeight)) {
        const measured = measuredLabelRect(position, labelWidth, labelHeight, plotRect);
        const collision = placed.some(previous => labelRectsOverlap(measured, previous));
        if (measured.inside && !collision) {
          const distance = Math.hypot(
            position.left + labelWidth / 2 - dotCenter.x,
            position.top + labelHeight / 2 - dotCenter.y,
          );
          if (!closestRail || distance < closestRail.distance) {
            closestRail = { measured, distance, placement: previousPlacement || preferred, left: position.left, top: position.top };
          }
        }
      }
      if (closestRail) best = { ...closestRail, score: 0 };
    }

    if (!best) {
      const fallback = {
        left: Math.max(plotRect.left + SCATTER_LABEL_INSET, Math.min(dotRect.left, plotRect.right - labelWidth - SCATTER_LABEL_INSET)),
        top: Math.max(plotRect.top + SCATTER_LABEL_INSET, Math.min(dotRect.bottom + SCATTER_LABEL_TETHER_GAP, plotRect.bottom - labelHeight - SCATTER_LABEL_INSET)),
      };
      best = { score: 2000, placement: previousPlacement || preferred, left: fallback.left, top: fallback.top };
    }

    commits.push({
      dot,
      label,
      taskKey,
      previousOffset,
      nextLeft: best.left - dotRect.left,
      nextTop: best.top - dotRect.top,
      placement: best.placement,
      rect: best.measured,
    });
    placed.push(best.measured);
  }

  for (const commit of commits) {
    commit.label.classList.add('is-positioned');
    commit.label.style.setProperty('--scatter-label-left', `${commit.previousOffset?.left ?? commit.nextLeft}px`);
    commit.label.style.setProperty('--scatter-label-top', `${commit.previousOffset?.top ?? commit.nextTop}px`);
    commit.label.classList.remove('is-measuring');
    commit.label.style.removeProperty('visibility');
  }

  scatterLabelPendingCommit = { sequence: layoutSequence, commits };
  if (!scatterLabelCommitFrame) scatterLabelCommitFrame = requestAnimationFrame(() => {
    scatterLabelCommitFrame = 0;
    const pending = scatterLabelPendingCommit;
    scatterLabelPendingCommit = null;
    if (!pending || pending.sequence !== scatterLabelLayoutSequence) return;
    for (const commit of pending.commits) {
      if (!document.contains(commit.label)) continue;
      commit.label.classList.add('is-positioned');
      commit.label.style.setProperty('--scatter-label-left', `${commit.nextLeft}px`);
      commit.label.style.setProperty('--scatter-label-top', `${commit.nextTop}px`);
      scatterLabelPositions.set(commit.taskKey, { left: commit.nextLeft, top: commit.nextTop, placement: commit.placement });
    }
  });
}

function scheduleScatterLabelLayout(activeId = null) {
  const resolvedActiveId = activeId == null
    ? scatterDrag?.dot?.dataset.id || selectedScatterId
    : activeId;
  scatterLabelLayoutRequest = {
    activeId: resolvedActiveId == null ? null : String(resolvedActiveId),
  };
  if (scatterLabelLayoutFrame) cancelAnimationFrame(scatterLabelLayoutFrame);
  scatterLabelLayoutFrame = requestAnimationFrame(() => {
    scatterLabelLayoutFrame = 0;
    layoutScatterLabels(scatterLabelLayoutRequest);
  });
}

function setScatterDotColor(dot, quadrant) {
  dot.dataset.quadrant = quadrant;
  dot.style.setProperty('--task-color', `var(${SCATTER_COLORS[quadrant] || SCATTER_COLORS.do})`);
}

function renderScatter() {
  const container = $('#scatter-tasks');
  const empty = $('#scatter-empty');
  if (!container || !empty) return;
  container.replaceChildren();
  const items = tasks.filter(task => !task.done && !task.archived).sort((a, b) => a.order - b.order);
  empty.hidden = items.length > 0;
  if (!items.length) {
    selectedScatterId = null;
    return;
  }
  if (!items.some(task => String(task.id) === selectedScatterId)) selectedScatterId = String(items[0].id);
  for (const task of items) {
    const position = scatterPosition(task);
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'scatter-task';
    dot.dataset.id = task.id;
    setScatterDotColor(dot, quadrantForPosition(position.importance, position.urgency));
    setScatterDotPosition(dot, position.importance, position.urgency);
    dot.setAttribute('aria-label', scatterDotLabel(task, position));
    dot.setAttribute('aria-selected', String(String(task.id) === selectedScatterId));
    const label = document.createElement('span');
    label.className = 'scatter-task-label';
    label.textContent = task.title || 'Untitled';
    label.setAttribute('aria-hidden', 'true');
    dot.appendChild(label);
    dot.addEventListener('focus', () => selectScatterTask(task.id));
    dot.addEventListener('click', () => selectScatterTask(task.id));
    dot.addEventListener('pointerenter', () => {
      if (scatterDrag && scatterDrag.dot !== dot) return;
      selectScatterTask(task.id);
    });
    dot.addEventListener('pointerleave', () => {
      if (scatterDrag?.dot === dot) return;
      dot.classList.toggle('is-frontmost', dot.matches(':focus-visible') || dot.classList.contains('is-dragging') || dot.classList.contains('is-selected'));
      scheduleScatterLabelLayout();
    });
    dot.addEventListener('pointerdown', startScatterDrag);
    dot.addEventListener('pointermove', moveScatterDrag);
    dot.addEventListener('pointerup', finishScatterDrag);
    dot.addEventListener('pointercancel', finishScatterDrag);
    dot.addEventListener('keydown', moveScatterWithKeys);
    container.appendChild(dot);
  }
  selectScatterTask(selectedScatterId);
  scheduleScatterLabelLayout();
}

function updateScatterDot(dot, task, importance, urgency) {
  const position = { importance: snapWeight(importance), urgency: snapWeight(urgency) };
  setScatterDotColor(dot, quadrantForPosition(position.importance, position.urgency));
  setScatterDotPosition(dot, position.importance, position.urgency, { animate: true });
  dot.setAttribute('aria-label', scatterDotLabel(task, position));
}

function scatterPositionFromPointer(event) {
  const plot = $('#scatter-plot');
  const rect = plot.getBoundingClientRect();
  const inset = 16;
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left - inset) / (rect.width - inset * 2)));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top - inset) / (rect.height - inset * 2)));
  return { importance: snapWeight((1 - y) * 100), urgency: snapWeight((1 - x) * 100) };
}

function startScatterDrag(event) {
  if (event.button !== 0) return;
  const dot = event.currentTarget;
  const task = tasks.find(item => String(item.id) === dot.dataset.id && !item.done);
  if (!task) return;
  event.preventDefault();
  selectScatterTask(task.id);
  scatterDrag = { dot, task, pointerId: event.pointerId, next: scatterPosition(task) };
  dot.classList.add('is-dragging');
  dot.classList.add('is-frontmost');
  dot.setPointerCapture?.(event.pointerId);
  scheduleScatterLabelLayout();
}

function moveScatterDrag(event) {
  if (!scatterDrag || event.pointerId !== scatterDrag.pointerId) return;
  event.preventDefault();
  const position = scatterPositionFromPointer(event);
  scatterDrag.next = position;
  updateScatterDot(scatterDrag.dot, scatterDrag.task, position.importance, position.urgency);
  // Schedule from pointer motion as well as grid changes: the dot eases
  // toward the snapped point, so the label must be re-solved while it moves.
  scheduleScatterLabelLayout(scatterDrag.dot.dataset.id);
}

async function persistScatterPosition(task, position) {
  const id = String(task.id);
  const sequence = ++scatterPersistSequence;
  scatterDrafts.set(id, { ...position, sequence });
  const previous = scatterPersistence.get(id) || Promise.resolve();
  const request = previous.catch(() => {}).then(async () => {
    const quadrant = quadrantForPosition(position.importance, position.urgency);
    try {
      const updated = await api('PATCH', API + '/' + task.id, { importance: position.importance, urgency: position.urgency, quadrant });
      Object.assign(task, updated);
    } catch {
      if (scatterDrafts.get(id)?.sequence === sequence) scatterDrafts.delete(id);
      renderScatter();
      showSaveError();
      return;
    }
    showSaveSuccess();
    if (scatterDrafts.get(id)?.sequence === sequence) scatterDrafts.delete(id);
    const dot = [...document.querySelectorAll('.scatter-task')].find(item => item.dataset.id === id);
    if (dot && currentView === 'scatter') {
      const next = scatterPosition(task);
      updateScatterDot(dot, task, next.importance, next.urgency);
      dot.classList.toggle('is-selected', id === selectedScatterId);
      dot.classList.toggle('is-frontmost', id === selectedScatterId || dot.classList.contains('is-dragging'));
      scheduleScatterLabelLayout(id);
    } else {
      renderScatter();
    }
  });
  scatterPersistence.set(id, request);
  request.finally(() => {
    if (scatterPersistence.get(id) === request) scatterPersistence.delete(id);
  });
  return request;
}

function finishScatterDrag(event) {
  if (!scatterDrag || event.pointerId !== scatterDrag.pointerId) return;
  const drag = scatterDrag;
  scatterDrag = null;
  drag.dot.classList.remove('is-dragging');
  drag.dot.classList.add('is-frontmost');
  drag.dot.releasePointerCapture?.(event.pointerId);
  scheduleScatterLabelLayout(drag.dot.dataset.id);
  void persistScatterPosition(drag.task, drag.next);
}

function moveScatterWithKeys(event) {
  const task = tasks.find(item => String(item.id) === event.currentTarget.dataset.id && !item.done);
  if (!task) return;
  const current = scatterPosition(task);
  let importance = gridIndex(current.importance);
  let urgency = gridIndex(current.urgency);
  if (event.key === 'ArrowLeft') urgency += 1;
  else if (event.key === 'ArrowRight') urgency -= 1;
  else if (event.key === 'ArrowDown') importance -= 1;
  else if (event.key === 'ArrowUp') importance += 1;
  else return;
  event.preventDefault();
  importance = Math.max(0, Math.min(GRID_VALUES.length - 1, importance));
  urgency = Math.max(0, Math.min(GRID_VALUES.length - 1, urgency));
  const position = { importance: GRID_VALUES[importance], urgency: GRID_VALUES[urgency] };
  updateScatterDot(event.currentTarget, task, position.importance, position.urgency);
  scheduleScatterLabelLayout(event.currentTarget.dataset.id);
  void persistScatterPosition(task, position);
}

function syncListFade(ul) {
  const hasOverflow = ul.scrollHeight > ul.clientHeight + 1;
  const atBottom = !hasOverflow || ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 1;
  const frame = ul.closest('.cards-frame');
  ul.classList.toggle('has-overflow', hasOverflow);
  ul.classList.toggle('at-bottom', atBottom);
  frame?.classList.toggle('has-overflow', hasOverflow);
  frame?.classList.toggle('at-bottom', atBottom);
}

function refreshEmpty(ul) {
  const empty = ul.querySelector('.empty');
  if (!empty) return;
  empty.classList.toggle('hidden', ul.querySelectorAll('.card, .archive-item').length > 0);
  requestAnimationFrame(() => syncListFade(ul));
}

function cardBodyHtml(t) {
  // Task cards stay single-level: supporting notes remain editable data, but
  // they do not become a competing sub-heading beneath the task title.
  return `<div class="title"></div>${t.done && t.doneAt ? '<div class="when"></div>' : ''}`;
}

function formatDoneDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function fillBody(li, t) {
  li.querySelector('.title').textContent = t.title || 'Untitled';
  const note = li.querySelector('.note');
  if (note) note.textContent = t.note;
  const when = li.querySelector('.when');
  if (when) when.textContent = 'done ' + formatDoneDate(t.doneAt);
}

function setCheckState(li, t, { animate = false } = {}) {
  const check = li.querySelector('.check');
  check.setAttribute('aria-pressed', String(t.done));
  check.setAttribute('aria-checked', String(t.done));
  check.setAttribute('aria-label', t.done ? 'Mark not done' : 'Mark done');
  if (animate) {
    check.classList.remove('is-init');
    void check.offsetWidth;
    check.classList.add('is-init');
  }
}

function setContentLabel(li, t) {
  li.querySelector('.content')?.setAttribute('aria-label', `Edit: ${t.title || 'Untitled'}`);
}

function settleCard(li) {
  li.classList.remove('drop-settle');
  requestAnimationFrame(() => {
    li.classList.add('drop-settle');
    li.addEventListener('animationend', () => li.classList.remove('drop-settle'), { once: true });
  });
}

function enterCard(li) {
  if (!li) return;
  li.classList.remove('card-entered');
  requestAnimationFrame(() => {
    if (!li.isConnected) return;
    li.classList.add('card-entered');
    li.addEventListener('animationend', () => li.classList.remove('card-entered'), { once: true });
    // Reduced-motion mode intentionally has no animationend event.
    window.setTimeout(() => li.classList.remove('card-entered'), 280);
  });
}

function animateCardResize(li, update) {
  if (!li?.isConnected) {
    update();
    return;
  }
  const before = li.getBoundingClientRect().height;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  li.classList.add('t-resize');
  li.style.height = `${before}px`;
  update();
  li.style.height = 'auto';
  const after = li.getBoundingClientRect().height;
  if (reducedMotion || Math.abs(after - before) < 1) {
    li.classList.remove('t-resize');
    li.style.removeProperty('height');
    return;
  }
  li.style.height = `${before}px`;
  li.offsetHeight;
  const finish = event => {
    if (event.propertyName !== 'height') return;
    li.classList.remove('t-resize');
    li.style.removeProperty('height');
  };
  li.addEventListener('transitionend', finish, { once: true });
  requestAnimationFrame(() => {
    if (li.isConnected) li.style.height = `${after}px`;
  });
}

async function deleteTask(li, t, { permanent = false } = {}) {
  const ul = li.parentElement;
  let updated;
  try {
    updated = permanent || t.archived
      ? await api('DELETE', `${API}/${t.id}`)
      : t.done
      ? await api('PATCH', `${API}/${t.id}`, { archived: true })
      : await api('PATCH', `${API}/${t.id}`, { done: true, archived: true });
  }
  catch { showSaveError(); return false; }
  if (permanent || t.archived) tasks = tasks.filter(x => x.id !== t.id);
  else Object.assign(t, updated);
  if (eliminateRecovery?.taskId === String(t.id)) clearEliminateRecovery();
  li.remove();
  refreshEmpty(ul);
  updateCounts();
  renderScatter();
  renderArchive();
  showSaveSuccess();
  return true;
}

function resetDoneDeleteActions(focusButton = false) {
  const deleteButton = $('#done-delete');
  const deleteActions = $('#done-delete-confirm');
  if (!deleteButton || !deleteActions) return;
  deleteActions.hidden = true;
  deleteButton.hidden = doneItems().length === 0;
  if (focusButton) deleteButton.focus();
}

function setupDoneDeleteActions() {
  const deleteButton = $('#done-delete');
  const deleteActions = $('#done-delete-confirm');
  if (!deleteButton || !deleteActions) return;
  deleteButton.addEventListener('click', event => {
    event.stopPropagation();
    deleteButton.hidden = true;
    deleteActions.hidden = false;
    deleteActions.querySelector('.delete-cancel').focus();
  });
  deleteActions.querySelector('.delete-cancel').addEventListener('click', event => {
    event.stopPropagation();
    resetDoneDeleteActions(true);
  });
  deleteActions.querySelector('.delete-approve').addEventListener('click', async event => {
    event.stopPropagation();
    const approve = event.currentTarget;
    if (approve.disabled) return;
    approve.disabled = true;
    try {
      await api('DELETE', `${API}?done=true`);
      const archivedAt = new Date().toISOString();
      tasks.forEach(task => {
        if (task.done) {
          task.archived = true;
          task.archivedAt = task.archivedAt || archivedAt;
        }
      });
      resetDoneDeleteActions();
      render();
      showSaveSuccess();
    } catch {
      approve.disabled = false;
      resetDoneDeleteActions();
      showSaveError();
    }
  });
}

function updateArchiveDeleteControl(archiveCount = archiveItems().length) {
  const deleteButton = $('#archive-delete');
  const deleteActions = $('#archive-delete-confirm');
  if (!deleteButton || !deleteActions) return;
  if (!archiveCount) {
    deleteButton.hidden = true;
    deleteActions.hidden = true;
    return;
  }
  if (deleteActions.hidden) deleteButton.hidden = false;
}

function resetArchiveDeleteActions(focusButton = false) {
  const deleteButton = $('#archive-delete');
  const deleteActions = $('#archive-delete-confirm');
  if (!deleteButton || !deleteActions) return;
  deleteActions.hidden = true;
  deleteButton.hidden = archiveItems().length === 0;
  if (focusButton) deleteButton.focus();
}

function setupArchiveDeleteActions() {
  const deleteButton = $('#archive-delete');
  const deleteActions = $('#archive-delete-confirm');
  if (!deleteButton || !deleteActions) return;
  deleteButton.addEventListener('click', event => {
    event.stopPropagation();
    deleteButton.hidden = true;
    deleteActions.hidden = false;
    deleteActions.querySelector('.delete-cancel').focus();
  });
  deleteActions.querySelector('.delete-cancel').addEventListener('click', event => {
    event.stopPropagation();
    resetArchiveDeleteActions(true);
  });
  deleteActions.querySelector('.delete-approve').addEventListener('click', async event => {
    event.stopPropagation();
    const approve = event.currentTarget;
    if (approve.disabled) return;
    approve.disabled = true;
    try {
      await api('DELETE', `${API}?archived=true`);
      tasks = tasks.filter(task => !(task.done && task.archived));
      resetArchiveDeleteActions();
      render();
      showSaveSuccess();
    } catch {
      approve.disabled = false;
      resetArchiveDeleteActions();
      showSaveError();
    }
  });
}

function cardEl(t, { readOnly = false } = {}) {
  const li = document.createElement('li');
  li.className = 'card' + (t.done ? ' done' : '') + (readOnly ? ' is-readonly' : '');
  li.draggable = !readOnly;
  li.dataset.id = t.id;
  const actionLabel = 'Archive task';
  const confirmLabel = 'Confirm archive task';
  const eliminateAction = !t.done && t.quadrant !== 'eliminate'
    ? `<button type="button" class="eliminate-task" aria-label="Move task to Eliminate" title="Move to Eliminate"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg></button>`
    : '';
  li.innerHTML = `<button type="button" class="check" role="checkbox" aria-checked="${t.done}" aria-pressed="${t.done}"><svg viewBox="0 0 10.1668 10.1668" aria-hidden="true" focusable="false"><path d="M1 5.52L3.92 9.17L9.17 1"></path></svg></button><div class="content" tabindex="0" role="button">${cardBodyHtml(t)}</div><div class="card-actions">${eliminateAction}<button type="button" class="delete" aria-label="${actionLabel}" title="${actionLabel}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16v12H4zM3 4.5h18v3H3zM9 12h6"/></svg></button><span class="delete-actions" hidden><button type="button" class="delete-cancel" aria-label="Cancel" title="Cancel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><button type="button" class="delete-approve" aria-label="${confirmLabel}" title="${confirmLabel}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button></span></div>`;
  fillBody(li, t);
  setCheckState(li, t);
  setContentLabel(li, t);
  if (readOnly) {
    li.querySelector('.check').disabled = true;
    li.querySelector('.content').removeAttribute('tabindex');
    li.querySelector('.content').removeAttribute('role');
    li.querySelector('.card-actions')?.remove();
    return li;
  }
  li.querySelector('.check').addEventListener('click', async e => {
    e.stopPropagation();
    await toggleDone(li, t);
  });
  const eliminateButton = li.querySelector('.eliminate-task');
  eliminateButton?.addEventListener('click', e => {
    e.stopPropagation();
    void moveTaskToEliminate(li, t);
  });
  const deleteButton = li.querySelector('.delete');
  const deleteActions = li.querySelector('.delete-actions');
  deleteButton.addEventListener('click', e => {
    e.stopPropagation();
    deleteButton.hidden = true;
    deleteActions.hidden = false;
    deleteActions.querySelector('.delete-cancel').focus();
  });
  deleteActions.querySelector('.delete-cancel').addEventListener('click', e => {
    e.stopPropagation();
    deleteActions.hidden = true;
    deleteButton.hidden = false;
    deleteButton.focus();
  });
  deleteActions.querySelector('.delete-approve').addEventListener('click', async e => {
    e.stopPropagation();
    if (e.currentTarget.disabled) return;
    e.currentTarget.disabled = true;
    const deleted = await deleteTask(li, t);
    if (!deleted && document.contains(li)) {
      deleteActions.hidden = true;
      deleteButton.hidden = false;
      e.currentTarget.disabled = false;
    }
  });
  const content = li.querySelector('.content');
  content.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && !li.classList.contains('editing')) {
      e.preventDefault();
      editCard(li, t);
    }
  });
  li.addEventListener('dragstart', e => {
    li._dragSource = li.parentElement;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.id);
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    li._dragSource = null;
    document.querySelectorAll('.drop-target').forEach(s => s.classList.remove('drop-target'));
    document.querySelectorAll('.is-drop-ready').forEach(s => s.classList.remove('is-drop-ready'));
  });
  li.addEventListener('click', e => {
    if (e.target.closest('.check') || e.target.closest('.card-actions')) return;
    if (li.classList.contains('editing')) {
      if (!e.target.closest('input, textarea')) li._finishEdit?.();
      return;
    }
    editCard(li, t);
  });
  return li;
}

async function moveTaskToEliminate(li, t) {
  if (li.dataset.busy === 'true' || t.done || t.quadrant === 'eliminate') return;
  li.dataset.busy = 'true';
  const previous = { done: t.done, quadrant: t.quadrant, order: t.order };
  try {
    const updated = await api('PATCH', `${API}/${t.id}`, {
      quadrant: 'eliminate',
      order: cardsFor('eliminate').length,
    });
    Object.assign(t, updated);
    render();
    showEliminateRecovery(t.id, previous);
    const moved = cardIn(t.id);
    if (moved) settleCard(moved);
    showSaveSuccess();
  } catch {
    showSaveError();
  } finally {
    delete li.dataset.busy;
  }
}

async function toggleDone(li, t) {
  if (li.dataset.busy === 'true') return;
  li.dataset.busy = 'true';
  const target = !t.done;
  try {
    const updated = await api('PATCH', `${API}/${t.id}`, { done: target });
    const archivedOverflowIds = new Set(updated.archivedOverflowIds || []);
    Object.assign(t, updated);
    tasks.forEach(task => {
      if (archivedOverflowIds.has(String(task.id))) {
        task.archived = true;
        task.archivedAt = task.archivedAt || new Date().toISOString();
      }
    });
    if (target && eliminateRecovery?.taskId === String(t.id)) clearEliminateRecovery();
    const from = li.parentElement;
    const to = target ? $('#done .cards') : document.querySelector(`.quadrant[data-quadrant="${t.quadrant}"] .cards`);
    li.classList.toggle('done', target);
    setCheckState(li, t, { animate: true });
    li.querySelector('.content').innerHTML = cardBodyHtml(t);
    fillBody(li, t);
    setContentLabel(li, t);
    to.appendChild(li);
    refreshEmpty(from); refreshEmpty(to);
    updateCounts();
    renderScatter();
    renderArchive();
    settleCard(li);
    showSaveSuccess();
  } catch {
    showSaveError();
  } finally {
    delete li.dataset.busy;
  }
}

function editCard(li, t) {
  if (li.classList.contains('editing')) return;
  const content = li.querySelector('.content');
  let titleInput;
  let noteArea;
  let autoGrow;
  animateCardResize(li, () => {
    li.classList.add('editing');
    li.draggable = false;
    content.innerHTML = `
      <input aria-label="Title" spellcheck="false">
      <textarea aria-label="Note" rows="1"></textarea>`;
    titleInput = content.querySelector('input');
    noteArea = content.querySelector('textarea');
    titleInput.value = t.title;
    noteArea.value = t.note;
    noteArea.hidden = !(t.note || '').trim();
    autoGrow = () => {
      noteArea.style.height = 'auto';
      if (!noteArea.hidden) noteArea.style.height = noteArea.scrollHeight + 'px';
    };
    noteArea.addEventListener('input', autoGrow);
    autoGrow();
  });
  titleInput.focus();

  const closeEditor = () => { li.classList.remove('editing'); li.draggable = true; };
  let saving = false;
  const save = async () => {
    if (saving || !document.contains(li)) return;
    saving = true;
    titleInput.disabled = true;
    noteArea.disabled = true;
    let updated;
    try { updated = await api('PATCH', `${API}/${t.id}`, { title: titleInput.value.trim(), note: noteArea.value }); }
    catch {
      saving = false;
      titleInput.disabled = false;
      noteArea.disabled = false;
      showSaveError();
      return;
    }
    Object.assign(t, updated);
    animateCardResize(li, () => {
      content.innerHTML = cardBodyHtml(t);
      fillBody(li, t);
      setContentLabel(li, t);
      closeEditor();
    });
    showSaveSuccess();
    renderScatter();
    delete li._finishEdit;
  };
  li._finishEdit = save;

  noteArea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); save(); }
  });
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      noteArea.hidden = false;
      autoGrow();
      noteArea.focus();
    }
  });
  const blurSave = () => setTimeout(() => {
    if (li.classList.contains('editing') && !li.contains(document.activeElement)) save();
  }, 150);
  titleInput.addEventListener('blur', blurSave);
  noteArea.addEventListener('blur', blurSave);
}

document.addEventListener('click', e => {
  const eventPath = e.composedPath();
  document.querySelectorAll('.card.editing').forEach(li => {
    if (!li.contains(e.target) && !eventPath.includes(li)) li._finishEdit?.();
  });
});

// quick add
$('#quick-add').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const val = e.target.value.trim();
  if (!val || captureBusy) return;
  captureBusy = true;
  e.target.disabled = true;
  e.target.setAttribute('aria-busy', 'true');
  let t;
  try { t = await api('POST', API, { title: val, quadrant: 'do' }); }
  catch { showSaveError(); return; }
  finally {
    captureBusy = false;
    e.target.disabled = false;
    e.target.removeAttribute('aria-busy');
    e.target.focus();
  }
  tasks.push(t);
  e.target.value = '';
  const ul = document.querySelector('.quadrant[data-quadrant="do"] .cards');
  const li = cardEl(t);
  ul.appendChild(li);
  enterCard(li);
  refreshEmpty(ul);
  updateCounts();
  renderScatter();
  showSaveSuccess();
});

function render() {
  for (const q of quadrants()) {
    const ul = q.querySelector('.cards');
    const items = cardsFor(q.dataset.quadrant);
    ul.querySelectorAll('.card').forEach(c => c.remove());
    items.forEach(t => ul.appendChild(cardEl(t)));
    refreshEmpty(ul);
  }
  const doneUl = $('#done .cards');
  const items = doneItems();
  doneUl.querySelectorAll('.card').forEach(c => c.remove());
  items.forEach(t => doneUl.appendChild(cardEl(t)));
  refreshEmpty(doneUl);
  updateCounts();
  renderScatter();
  renderArchive();
}

function renderArchive() {
  const ul = $('#archive-view .archive-cards');
  if (!ul) return;
  const items = archiveItems();
  updateArchiveDeleteControl(items.length);
  ul.querySelectorAll('.archive-item').forEach(item => item.remove());
  items.forEach(t => ul.appendChild(archiveCardEl(t)));
  refreshEmpty(ul);
}

function archiveCardEl(t) {
  const li = document.createElement('li');
  li.className = 'archive-item';
  li.dataset.id = t.id;
  li.innerHTML = '<div class="archive-item-content"><div class="title"></div><div class="when"></div></div><div class="card-actions archive-actions"><button type="button" class="archive-restore" aria-label="Restore task to Do" title="Restore to Do"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 5v5h5"/></svg></button><button type="button" class="delete" aria-label="Delete archived task" title="Delete archived task"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7l1-3h4l1 3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button><span class="delete-actions" hidden><button type="button" class="delete-cancel" aria-label="Cancel delete" title="Cancel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><button type="button" class="delete-approve" aria-label="Confirm delete" title="Delete permanently"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button></span></div>';
  li.querySelector('.title').textContent = t.title || 'Untitled';
  const date = formatDoneDate(t.doneAt);
  li.querySelector('.when').textContent = date ? `Completed ${date}` : 'Completed';
  const restoreButton = li.querySelector('.archive-restore');
  restoreButton.addEventListener('click', async event => {
    event.stopPropagation();
    if (restoreButton.disabled) return;
    restoreButton.disabled = true;
    try {
      const updated = await api('PATCH', `${API}/${t.id}`, { archived: false, done: false, quadrant: 'do' });
      const archivedOverflowIds = new Set(updated.archivedOverflowIds || []);
      Object.assign(t, updated);
      tasks.forEach(task => {
        if (archivedOverflowIds.has(String(task.id))) {
          task.archived = true;
          task.archivedAt = task.archivedAt || new Date().toISOString();
        }
      });
      render();
      showSaveSuccess();
    } catch {
      restoreButton.disabled = false;
      showSaveError();
    }
  });
  const deleteButton = li.querySelector('.delete');
  const deleteActions = li.querySelector('.delete-actions');
  deleteButton.addEventListener('click', event => {
    event.stopPropagation();
    deleteButton.hidden = true;
    deleteActions.hidden = false;
    deleteActions.querySelector('.delete-cancel').focus();
  });
  deleteActions.querySelector('.delete-cancel').addEventListener('click', event => {
    event.stopPropagation();
    deleteActions.hidden = true;
    deleteButton.hidden = false;
    deleteButton.focus();
  });
  deleteActions.querySelector('.delete-approve').addEventListener('click', async event => {
    event.stopPropagation();
    const approve = event.currentTarget;
    if (approve.disabled) return;
    approve.disabled = true;
    const deleted = await deleteTask(li, t, { permanent: true });
    if (!deleted && document.contains(li)) {
      deleteActions.hidden = true;
      deleteButton.hidden = false;
      approve.disabled = false;
    }
  });
  return li;
}

function setSettingsOpen(open) {
  const panel = $('#settings-panel');
  const toggle = $('#settings-toggle');
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

function setAsciiBackgroundEnabled(enabled) {
  asciiBackgroundEnabled = Boolean(enabled);
  syncSettingsToggle($('#ascii-background-toggle'), asciiBackgroundEnabled, true);
  try { localStorage.setItem('decisive.asciiBackgroundEnabled', String(asciiBackgroundEnabled)); } catch {}
  window.dispatchEvent(new CustomEvent('decisive:ascii-background', { detail: { enabled: asciiBackgroundEnabled } }));
  setStatus('');
}

function setOriginalLayoutEnabled(enabled) {
  originalLayoutEnabled = Boolean(enabled);
  $('#layout')?.classList.toggle('original-layout', originalLayoutEnabled);
  syncSettingsToggle($('#original-layout-toggle'), originalLayoutEnabled, true);
  try { localStorage.setItem('decisive.originalLayoutEnabled', String(originalLayoutEnabled)); } catch {}
}

function setScatterNamesVisible(visible) {
  scatterNamesVisible = Boolean(visible);
  try { localStorage.setItem('decisive.scatterNamesVisible', String(scatterNamesVisible)); } catch {}
  $('#scatter-view')?.classList.toggle('names-visible', scatterNamesVisible);
  const button = $('#scatter-names-button');
  if (button) {
    button.setAttribute('aria-pressed', String(scatterNamesVisible));
    button.textContent = scatterNamesVisible ? 'Hide names' : 'Show names';
  }
  scheduleScatterLabelLayout();
}

function syncSettingsToggle(input, on, animate = false) {
  if (!input) return;
  input.dataset.on = String(Boolean(on));
  if (!animate) {
    input.classList.remove('is-init');
    return;
  }
  input.classList.remove('is-init');
  input.offsetWidth;
  input.classList.add('is-init');
}

async function restoreDemoContent() {
  const button = $('#restore-demo-content');
  if (!button || button.disabled) return;
  const confirmed = window.confirm('Restore the demo board? This removes the current tasks and replaces them with the built-in examples.');
  if (!confirmed) return;
  button.disabled = true;
  try {
    const result = await api('POST', '/api/demo/restore');
    const restored = Array.isArray(result.tasks) ? result.tasks : [];
    const validQuadrants = new Set(['do', 'schedule', 'delegate', 'eliminate']);
    if (!restored.length || restored.some(task => !task || task.id == null || !validQuadrants.has(task.quadrant))) {
      throw new Error('invalid demo fixture');
    }
    tasks = restored.map(task => ({ ...task }));
    render();
    setSettingsOpen(false);
    showSaveSuccess();
  } catch {
    showSaveError();
  } finally {
    button.disabled = false;
  }
}

function setupSettings() {
  const toggle = $('#settings-toggle');
  const panel = $('#settings-panel');
  const backgroundToggle = $('#ascii-background-toggle');
  const originalLayoutToggle = $('#original-layout-toggle');
  const namesButton = $('#scatter-names-button');
  const restoreDemoButton = $('#restore-demo-content');
  if (!toggle || !panel || !backgroundToggle) return;
  backgroundToggle.checked = asciiBackgroundEnabled;
  syncSettingsToggle(backgroundToggle, asciiBackgroundEnabled);
  if (originalLayoutToggle) {
    originalLayoutToggle.checked = originalLayoutEnabled;
    syncSettingsToggle(originalLayoutToggle, originalLayoutEnabled);
  }
  setOriginalLayoutEnabled(originalLayoutEnabled);
  setScatterNamesVisible(scatterNamesVisible);
  toggle.addEventListener('click', event => {
    event.stopPropagation();
    setSettingsOpen(panel.hidden);
  });
  panel.addEventListener('click', event => event.stopPropagation());
  backgroundToggle.addEventListener('change', () => setAsciiBackgroundEnabled(backgroundToggle.checked));
  originalLayoutToggle?.addEventListener('change', () => setOriginalLayoutEnabled(originalLayoutToggle.checked));
  namesButton?.addEventListener('click', () => setScatterNamesVisible(!scatterNamesVisible));
  restoreDemoButton?.addEventListener('click', () => void restoreDemoContent());
  document.addEventListener('click', event => {
    if (!event.target.closest('.settings-wrap')) setSettingsOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      setSettingsOpen(false);
      toggle.focus();
    }
  });
}

// drag & drop (quadrants + done strip)
let draggedId = null;
for (const ul of [...document.querySelectorAll('.quadrant .cards')]) {
  const section = ul.closest('.quadrant');
  const isDone = section.classList.contains('done-section');
  const resetDropTarget = () => {
    section.classList.remove('drop-target');
    section.classList.remove('is-drop-ready');
  };
  ul.addEventListener('scroll', () => syncListFade(ul), { passive: true });
  section.addEventListener('dragenter', e => {
    e.preventDefault();
    if (!document.querySelector('.dragging')) return;
    section.classList.add('drop-target');
    section.classList.toggle('is-drop-ready', section.dataset.quadrant === 'eliminate');
  });
  section.addEventListener('dragover', e => {
    e.preventDefault();
    const dragging = document.querySelector('.dragging');
    if (!dragging) return;
    const after = [...ul.querySelectorAll('.card:not(.dragging)')].find(c => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) ul.insertBefore(dragging, after); else ul.appendChild(dragging);
    section.classList.add('drop-target');
    section.classList.toggle('is-drop-ready', section.dataset.quadrant === 'eliminate');
  });
  section.addEventListener('dragleave', e => {
    // Ignore transitions between the header, cards, and their children.
    if (e.relatedTarget && section.contains(e.relatedTarget)) return;
    resetDropTarget();
  });
  section.addEventListener('drop', async e => {
    e.preventDefault();
    resetDropTarget();
    const id = draggedId || e.dataTransfer.getData('text/plain');
    const t = tasks.find(x => x.id === id);
    const li = cardIn(id);
    if (!t || !li) return;
    if (isDone && t.done) return;
    const from = li._dragSource || li.parentElement;
    const previous = { done: t.done, quadrant: t.quadrant, order: t.order };
    const body = isDone
      ? { done: true }
      : { quadrant: section.dataset.quadrant, order: [...ul.querySelectorAll('.card')].indexOf(li), ...(t.done ? { done: false } : {}) };
    let updated;
    try { updated = await api('PATCH', `${API}/${id}`, body); }
    catch {
      await load();
      showSaveError();
      return;
    }
    Object.assign(t, updated);
    li.classList.toggle('done', isDone);
    setCheckState(li, t, { animate: true });
    li.querySelector('.content').innerHTML = cardBodyHtml(t);
    fillBody(li, t);
    setContentLabel(li, t);
    if (li.parentElement !== ul) ul.appendChild(li);
    refreshEmpty(from); refreshEmpty(ul);
    updateCounts();
    renderScatter();
    settleCard(li);
    li._dragSource = null;
    if (!isDone && section.dataset.quadrant === 'eliminate' && previous.quadrant !== 'eliminate') {
      showEliminateRecovery(t.id, previous);
    } else if (!isDone && previous.quadrant === 'eliminate' && section.dataset.quadrant !== 'eliminate') {
      clearEliminateRecovery();
    }
    showSaveSuccess();
  });
}
document.addEventListener('dragstart', e => { if (e.target.classList.contains('card')) draggedId = e.target.dataset.id; });
document.addEventListener('dragend', () => {
  draggedId = null;
  document.querySelectorAll('.quadrant.drop-target').forEach(section => {
    section.classList.remove('drop-target');
    section.classList.remove('is-drop-ready');
  });
});
window.addEventListener('resize', () => {
  document.querySelectorAll('.cards').forEach(syncListFade);
  scheduleScatterLabelLayout();
  positionViewSwitchPill(false);
});

function setView(view) {
  currentView = ['scatter', 'archive'].includes(view) ? view : 'matrix';
  const scatterActive = currentView === 'scatter';
  const archiveActive = currentView === 'archive';
  const layout = $('#layout');
  $('#console')?.classList.toggle('matrix-mode', !scatterActive && !archiveActive);
  $('#console')?.classList.toggle('scatter-mode', scatterActive);
  layout.classList.toggle('scatter-mode', scatterActive);
  layout.classList.toggle('archive-mode', archiveActive);
  $('#matrix').hidden = scatterActive || archiveActive;
  $('#scatter-view').hidden = !scatterActive;
  $('#archive-view').hidden = !archiveActive;
  $('#done').hidden = archiveActive;
  const namesButton = $('#scatter-names-button');
  if (namesButton) namesButton.hidden = !scatterActive;
  $('#scatter-view').classList.toggle('names-visible', scatterNamesVisible);
  document.querySelectorAll('.view-button').forEach(button => {
    const active = button.dataset.view === currentView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  positionViewSwitchPill(viewSwitchPillReady);
  viewSwitchPillReady = true;
  if (scatterActive) renderScatter();
  else if (archiveActive) renderArchive();
  else render();
  const url = new URL(location.href);
  if (scatterActive) url.searchParams.set('view', 'scatter');
  else if (archiveActive) url.searchParams.set('view', 'archive');
  else url.searchParams.delete('view');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function positionViewSwitchPill(animate = true) {
  const switcher = document.querySelector('.view-switch');
  const pill = switcher?.querySelector('.view-switch-pill');
  const active = switcher?.querySelector('.view-button.is-active');
  if (!switcher || !pill || !active) return;
  if (!animate) pill.style.transition = 'none';
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!animate) {
    pill.offsetHeight;
    pill.style.removeProperty('transition');
  }
}

document.querySelectorAll('.view-button').forEach(button => {
  button.addEventListener('click', () => setView(button.dataset.view));
});
setupDoneDeleteActions();
setupArchiveDeleteActions();
setupEliminateRecovery();
setupSettings();
const initialView = new URLSearchParams(location.search).get('view');
setView(['scatter', 'archive'].includes(initialView) ? initialView : 'matrix');

load();
