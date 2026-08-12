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
const scatterDrafts = new Map();
const scatterPersistence = new Map();
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
  $('#done .count').textContent = doneItems().length;
}

function setScatterDotPosition(dot, importance, urgency) {
  dot.style.setProperty('--scatter-x', `${100 - urgency}%`);
  dot.style.setProperty('--scatter-y', `${100 - importance}%`);
  dot.dataset.importance = String(importance);
  dot.dataset.urgency = String(urgency);
  dot.dataset.tooltipPlacement = scatterTooltipPlacement({ importance, urgency });
}

function selectScatterTask(id) {
  selectedScatterId = id == null ? null : String(id);
  document.querySelectorAll('.scatter-task').forEach(dot => {
    const selected = dot.dataset.id === selectedScatterId;
    dot.classList.toggle('is-selected', selected);
    dot.setAttribute('aria-selected', String(selected));
  });
}

function scatterDotLabel(task, position) {
  return `${task.title || 'Untitled'} — Importance ${position.importance}, Urgency ${position.urgency}.`;
}

function scatterTooltipPlacement(position) {
  const vertical = position.importance >= 50 ? 'below' : 'above';
  const horizontal = position.urgency >= 75 ? 'right' : position.urgency <= 25 ? 'left' : 'center';
  return vertical + '-' + horizontal;
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
    dot.addEventListener('pointerdown', startScatterDrag);
    dot.addEventListener('pointermove', moveScatterDrag);
    dot.addEventListener('pointerup', finishScatterDrag);
    dot.addEventListener('pointercancel', finishScatterDrag);
    dot.addEventListener('keydown', moveScatterWithKeys);
    container.appendChild(dot);
  }
  selectScatterTask(selectedScatterId);
}

function updateScatterDot(dot, task, importance, urgency) {
  const position = { importance: snapWeight(importance), urgency: snapWeight(urgency) };
  setScatterDotColor(dot, quadrantForPosition(position.importance, position.urgency));
  setScatterDotPosition(dot, position.importance, position.urgency);
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
  dot.setPointerCapture?.(event.pointerId);
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
    renderScatter();
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
  drag.dot.releasePointerCapture?.(event.pointerId);
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
window.addEventListener('resize', () => document.querySelectorAll('.cards').forEach(syncListFade));

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
setView(new URLSearchParams(location.search).get('view') === 'scatter' ? 'scatter' : 'matrix');

load();
