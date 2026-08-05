const API = '/api/tasks';
const QLABELS = { do: 'Do', schedule: 'Schedule', delegate: 'Delegate', eliminate: 'Eliminate' };
let tasks = [];
let captureBusy = false;

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

function updateCounts() {
  for (const q of quadrants()) q.querySelector('.count').textContent = cardsFor(q.dataset.quadrant).length;
  $('#done .count').textContent = doneItems().length;
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
    settleCard(li);
  });
}
document.addEventListener('dragstart', e => { if (e.target.classList.contains('card')) draggedId = e.target.dataset.id; });
document.addEventListener('dragend', () => { draggedId = null; });
window.addEventListener('resize', () => document.querySelectorAll('.cards').forEach(syncListFade));

load();
