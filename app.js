const API = '/api/tasks';
const QLABELS = { do: 'Do', schedule: 'Schedule', delegate: 'Delegate', eliminate: 'Eliminate' };
const GRID_VALUES = Array.from({ length: 21 }, (_, index) => index * 5);
const DEFAULT_SCATTER = {
  do: { importance: 75, urgency: 75 },
  schedule: { importance: 75, urgency: 25 },
  delegate: { importance: 25, urgency: 75 },
  eliminate: { importance: 25, urgency: 25 },
};
const SCATTER_COLORS = { do: '--do-color', schedule: '--schedule-color', delegate: '--delegate-color', eliminate: '--eliminate-color' };
let tasks = [];
let captureBusy = false;
let currentView = 'matrix';
let selectedScatterId = null;
let scatterDrag = null;
let scatterNamesVisible = false;
let scatterLabelLayoutFrame = 0;
let scatterLabelCommitFrame = 0;
let scatterLabelLayoutSequence = 0;
const scatterDrafts = new Map();
const scatterPersistence = new Map();
const scatterLabelPositions = new Map();
let scatterLabelPendingCommit = null;
const scatterDotMotions = new WeakMap();
let scatterPersistSequence = 0;

try {
  scatterNamesVisible = localStorage.getItem('decisive.scatterNamesVisible') === 'true';
} catch {}

const $ = sel => document.querySelector(sel);
const quadrants = () => [...document.querySelectorAll('.quadrant:not(.done-section)')];
const cardIn = id => document.querySelector(`.card[data-id="${id}"]`);

async function api(method, path, body) {
  let r;
  try {
    r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('offline');
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function load() {
  try { tasks = await api('GET', API); render(); }
  catch {}
}

function cardsFor(q) { return tasks.filter(t => t.quadrant === q && !t.done).sort((a, b) => a.order - b.order); }
function doneItems() { return tasks.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')); }

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

function updateCounts() {
  for (const q of quadrants()) q.querySelector('.count').textContent = cardsFor(q.dataset.quadrant).length;
  const doneCount = doneItems().length;
  $('#done .count').textContent = doneCount;
  updateDoneDeleteControl(doneCount);
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

function writeScatterDotPosition(dot, x, y) {
  dot.style.setProperty('--scatter-x', `${x}%`);
  dot.style.setProperty('--scatter-y', `${y}%`);
  dot.dataset.scatterX = String(x);
  dot.dataset.scatterY = String(y);
}

function animateScatterDotPosition(dot, x, y) {
  const existing = scatterDotMotions.get(dot);
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
    const follow = dot.classList.contains('is-dragging') ? .32 : .22;
    state.currentX += (state.targetX - state.currentX) * follow;
    state.currentY += (state.targetY - state.currentY) * follow;
    writeScatterDotPosition(dot, state.currentX, state.currentY);
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

const SCATTER_LABEL_GAP = 5;
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
    'below-center': { left: centerX - labelWidth / 2, top: dotRect.bottom + SCATTER_LABEL_GAP },
    'above-center': { left: centerX - labelWidth / 2, top: dotRect.top - labelHeight - SCATTER_LABEL_GAP },
    'below-left': { left: dotRect.left - labelWidth + SCATTER_LABEL_ANCHOR, top: dotRect.bottom + SCATTER_LABEL_GAP },
    'below-right': { left: dotRect.right - SCATTER_LABEL_ANCHOR, top: dotRect.bottom + SCATTER_LABEL_GAP },
    'above-left': { left: dotRect.left - labelWidth + SCATTER_LABEL_ANCHOR, top: dotRect.top - labelHeight - SCATTER_LABEL_GAP },
    'above-right': { left: dotRect.right - SCATTER_LABEL_ANCHOR, top: dotRect.top - labelHeight - SCATTER_LABEL_GAP },
    'left-center': { left: dotRect.left - labelWidth - SCATTER_LABEL_GAP, top: centerY - labelHeight / 2 },
    'right-center': { left: dotRect.right + SCATTER_LABEL_GAP, top: centerY - labelHeight / 2 },
  };
  return positions[placement] || positions['below-center'];
}

function scatterLabelWidth(dot) {
  const titleLength = dot.querySelector('.scatter-task-label')?.textContent.length || 0;
  return Math.max(140, Math.min(260, titleLength * 7.1 + 24));
}

function labelOverflow(rect, bounds, inset = 0) {
  return Math.max(0, bounds.left + inset - rect.left)
    + Math.max(0, rect.right - bounds.right + inset)
    + Math.max(0, bounds.top + inset - rect.top)
    + Math.max(0, rect.bottom - bounds.bottom + inset);
}

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

function labelRectsOverlap(a, b, gap = 6) {
  return !(
    a.right + gap <= b.left
    || a.left >= b.right + gap
    || a.bottom + gap <= b.top
    || a.top >= b.bottom + gap
  );
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

function clearMeasuredLabelPosition(label) {
  label.classList.remove('is-positioned');
  label.style.removeProperty('--scatter-label-left');
  label.style.removeProperty('--scatter-label-top');
}

function layoutScatterLabels() {
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
    const labelWidth = scatterLabelWidth(dot);
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
      for (const position of scatterLabelRailPositions(plotRect, labelWidth, labelHeight)) {
        const measured = measuredLabelRect(position, labelWidth, labelHeight, plotRect);
        const collision = placed.some(previous => labelRectsOverlap(measured, previous));
        if (measured.inside && !collision) {
          best = { measured, score: 0, placement: previousPlacement || preferred, left: position.left, top: position.top };
          break;
        }
      }
    }
    if (!best) {
      const dotRect = dot.getBoundingClientRect();
      const fallback = {
        left: Math.max(plotRect.left + SCATTER_LABEL_INSET, Math.min(dotRect.left, plotRect.right - labelWidth - SCATTER_LABEL_INSET)),
        top: Math.max(plotRect.top + SCATTER_LABEL_INSET, Math.min(dotRect.bottom + SCATTER_LABEL_GAP, plotRect.bottom - labelHeight - SCATTER_LABEL_INSET)),
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
    if (commit.previousOffset) {
      commit.label.classList.add('is-positioned');
      commit.label.style.setProperty('--scatter-label-left', `${commit.previousOffset.left}px`);
      commit.label.style.setProperty('--scatter-label-top', `${commit.previousOffset.top}px`);
    } else {
      commit.label.classList.add('is-positioned');
      commit.label.style.setProperty('--scatter-label-left', `${commit.nextLeft}px`);
      commit.label.style.setProperty('--scatter-label-top', `${commit.nextTop}px`);
    }
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

function scheduleScatterLabelLayout() {
  if (scatterLabelLayoutFrame) cancelAnimationFrame(scatterLabelLayoutFrame);
  scatterLabelLayoutFrame = requestAnimationFrame(() => {
    scatterLabelLayoutFrame = 0;
    layoutScatterLabels();
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
  const items = tasks.filter(task => !task.done).sort((a, b) => a.order - b.order);
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
      return;
    }
    if (scatterDrafts.get(id)?.sequence === sequence) scatterDrafts.delete(id);
    const dot = [...document.querySelectorAll('.scatter-task')].find(item => item.dataset.id === id);
    if (dot && currentView === 'scatter') {
      const next = scatterPosition(task);
      updateScatterDot(dot, task, next.importance, next.urgency);
      dot.classList.toggle('is-selected', id === selectedScatterId);
      dot.classList.toggle('is-frontmost', id === selectedScatterId || dot.classList.contains('is-dragging'));
      scheduleScatterLabelLayout();
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
  scheduleScatterLabelLayout();
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
  scheduleScatterLabelLayout();
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
  empty.classList.toggle('hidden', ul.querySelectorAll('.card').length > 0);
  requestAnimationFrame(() => syncListFade(ul));
}

function cardBodyHtml(t) {
  return `<div class="title"></div>${t.note ? '<div class="note"></div>' : ''}${t.done && t.doneAt ? '<div class="when"></div>' : ''}`;
}

function fillBody(li, t) {
  li.querySelector('.title').textContent = t.title || 'Untitled';
  const note = li.querySelector('.note');
  if (note) note.textContent = t.note;
  const when = li.querySelector('.when');
  if (when) when.textContent = 'done ' + new Date(t.doneAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function setCheckState(li, t) {
  const check = li.querySelector('.check');
  check.setAttribute('aria-pressed', String(t.done));
  check.setAttribute('aria-label', t.done ? 'Mark not done' : 'Mark done');
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

async function deleteTask(li, t) {
  const ul = li.parentElement;
  try { await api('DELETE', `${API}/${t.id}`); }
  catch { return false; }
  tasks = tasks.filter(x => x.id !== t.id);
  li.remove();
  refreshEmpty(ul);
  updateCounts();
  renderScatter();
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
      tasks = tasks.filter(task => !task.done);
      resetDoneDeleteActions();
      render();
    } catch {
      approve.disabled = false;
      resetDoneDeleteActions();
    }
  });
}

function cardEl(t) {
  const li = document.createElement('li');
  li.className = 'card' + (t.done ? ' done' : '');
  li.draggable = true;
  li.dataset.id = t.id;
  li.innerHTML = `<button type="button" class="check" aria-pressed="${t.done}"></button><div class="content" tabindex="0" role="button">${cardBodyHtml(t)}</div><div class="card-actions"><button type="button" class="delete" aria-label="Delete task" title="Delete task"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7l1-3h4l1 3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button><span class="delete-actions" hidden><button type="button" class="delete-cancel" aria-label="Cancel delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><button type="button" class="delete-approve" aria-label="Confirm delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button></span></div>`;
  fillBody(li, t);
  setCheckState(li, t);
  setContentLabel(li, t);
  li.querySelector('.check').addEventListener('click', async e => {
    e.stopPropagation();
    await toggleDone(li, t);
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
  li.addEventListener('dragstart', e => { li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(s => s.classList.remove('drop-target'));
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

async function toggleDone(li, t) {
  if (li.dataset.busy === 'true') return;
  li.dataset.busy = 'true';
  const target = !t.done;
  try {
    const updated = await api('PATCH', `${API}/${t.id}`, { done: target });
    Object.assign(t, updated);
    const from = li.parentElement;
    const to = target ? $('#done .cards') : document.querySelector(`.quadrant[data-quadrant="${t.quadrant}"] .cards`);
    li.classList.toggle('done', target);
    setCheckState(li, t);
    li.querySelector('.content').innerHTML = cardBodyHtml(t);
    fillBody(li, t);
    setContentLabel(li, t);
    to.appendChild(li);
    refreshEmpty(from); refreshEmpty(to);
    updateCounts();
    renderScatter();
  } catch {
  } finally {
    delete li.dataset.busy;
  }
}

function editCard(li, t) {
  if (li.classList.contains('editing')) return;
  li.classList.add('editing');
  li.draggable = false;
  const content = li.querySelector('.content');
  content.innerHTML = `
    <input aria-label="Title" spellcheck="false">
    <textarea aria-label="Note" rows="1"></textarea>`;
  const titleInput = content.querySelector('input');
  const noteArea = content.querySelector('textarea');
  titleInput.value = t.title;
  noteArea.value = t.note;
  noteArea.hidden = !(t.note || '').trim();
  const autoGrow = () => {
    noteArea.style.height = 'auto';
    if (!noteArea.hidden) noteArea.style.height = noteArea.scrollHeight + 'px';
  };
  noteArea.addEventListener('input', autoGrow);
  autoGrow();
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
      return;
    }
    Object.assign(t, updated);
    content.innerHTML = cardBodyHtml(t);
    fillBody(li, t);
    setContentLabel(li, t);
    closeEditor();
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
  catch { return; }
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
  refreshEmpty(ul);
  updateCounts();
  renderScatter();
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
}

function updateScatterNamesToggle() {
  const toggle = $('#task-names-toggle');
  const scatterView = $('#scatter-view');
  if (!toggle || !scatterView) return;
  const visible = currentView === 'scatter';
  toggle.hidden = !visible;
  toggle.setAttribute('aria-pressed', String(scatterNamesVisible));
  toggle.textContent = scatterNamesVisible ? 'Hide names' : 'Show names';
  scatterView.classList.toggle('names-visible', scatterNamesVisible);
}

function toggleScatterNames() {
  scatterNamesVisible = !scatterNamesVisible;
  try { localStorage.setItem('decisive.scatterNamesVisible', String(scatterNamesVisible)); } catch {}
  updateScatterNamesToggle();
  scheduleScatterLabelLayout();
}

// drag & drop (quadrants + done strip)
let draggedId = null;
for (const ul of [...document.querySelectorAll('.cards')]) {
  const section = ul.closest('.quadrant');
  const isDone = section.classList.contains('done-section');
  ul.addEventListener('scroll', () => syncListFade(ul), { passive: true });
  section.addEventListener('dragenter', e => {
    e.preventDefault();
    if (document.querySelector('.dragging')) section.classList.add('drop-target');
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
  });
  section.addEventListener('dragleave', e => { if (e.relatedTarget && !section.contains(e.relatedTarget)) section.classList.remove('drop-target'); });
  section.addEventListener('drop', async e => {
    e.preventDefault();
    section.classList.remove('drop-target');
    const id = draggedId || e.dataTransfer.getData('text/plain');
    const t = tasks.find(x => x.id === id);
    const li = cardIn(id);
    if (!t || !li) return;
    if (isDone && t.done) return;
    const body = isDone
      ? { done: true }
      : { quadrant: section.dataset.quadrant, order: [...ul.querySelectorAll('.card')].indexOf(li), ...(t.done ? { done: false } : {}) };
    let updated;
    try { updated = await api('PATCH', `${API}/${id}`, body); }
    catch { load(); return; }
    Object.assign(t, updated);
    const from = li.parentElement;
    li.classList.toggle('done', isDone);
    setCheckState(li, t);
    li.querySelector('.content').innerHTML = cardBodyHtml(t);
    fillBody(li, t);
    setContentLabel(li, t);
    if (li.parentElement !== ul) ul.appendChild(li);
    refreshEmpty(from); refreshEmpty(ul);
    updateCounts();
    renderScatter();
    settleCard(li);
  });
}
document.addEventListener('dragstart', e => { if (e.target.classList.contains('card')) draggedId = e.target.dataset.id; });
document.addEventListener('dragend', () => { draggedId = null; });
window.addEventListener('resize', () => {
  document.querySelectorAll('.cards').forEach(syncListFade);
  scheduleScatterLabelLayout();
});

function setView(view) {
  currentView = view === 'scatter' ? 'scatter' : 'matrix';
  const scatterActive = currentView === 'scatter';
  const layout = $('#layout');
  layout.classList.toggle('scatter-mode', scatterActive);
  $('#matrix').hidden = scatterActive;
  $('#scatter-view').hidden = !scatterActive;
  document.querySelectorAll('.view-button').forEach(button => {
    const active = button.dataset.view === currentView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateScatterNamesToggle();
  if (scatterActive) renderScatter();
  else render();
  const url = new URL(location.href);
  if (scatterActive) url.searchParams.set('view', 'scatter');
  else url.searchParams.delete('view');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

document.querySelectorAll('.view-button').forEach(button => {
  button.addEventListener('click', () => setView(button.dataset.view));
});
$('#task-names-toggle')?.addEventListener('click', toggleScatterNames);
setupDoneDeleteActions();
setView(new URLSearchParams(location.search).get('view') === 'scatter' ? 'scatter' : 'matrix');

load();
