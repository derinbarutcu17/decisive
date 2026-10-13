// cloud.js — optional Supabase-backed accounts for Decisive.
//
// Dependency-free: talks directly to Supabase's Auth (GoTrue) and data
// (PostgREST) HTTP APIs. When no session is present the app keeps working in
// local mode exactly as before; once signed in, every board action flows
// through Supabase with Row Level Security keeping accounts separate.
(() => {
  'use strict';

  const CONFIG = window.DECISIVE_CLOUD || {};
  const BASE = String(CONFIG.url || '').replace(/\/+$/, '');
  const ANON = String(CONFIG.anonKey || '');
  const configured = Boolean(BASE && ANON);

  const SESSION_KEY = 'decisive.cloud.session.v1';
  const VERIFIER_KEY = 'decisive.cloud.verifier.v1';
  const DEFAULT_WEIGHTS = {
    do: { importance: 75, urgency: 75 },
    schedule: { importance: 75, urgency: 25 },
    delegate: { importance: 25, urgency: 75 },
    eliminate: { importance: 25, urgency: 25 },
  };

  let session = null;
  let ready = null;
  const listeners = new Set();

  function readSession() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (parsed && parsed.accessToken) return parsed;
    } catch {}
    return null;
  }

  function emit() {
    listeners.forEach(fn => { try { fn(session); } catch {} });
  }

  function saveSession(next) {
    session = next && next.accessToken ? next : null;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
    emit();
  }

  function toSession(payload) {
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
      email: (payload.user && payload.user.email) || null,
    };
  }

  function b64url(bytes) {
    let s = '';
    new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function makePkce() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(digest) };
  }

  function buildAuthorizeUrl(redirectTo, challenge) {
    const query = new URLSearchParams({
      provider: 'google',
      redirect_to: redirectTo,
      code_challenge: challenge,
      code_challenge_method: 's256',
    });
    return `${BASE}/auth/v1/authorize?${query.toString()}`;
  }

  async function authFetch(route, options = {}) {
    const response = await fetch(`${BASE}${route}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const message = payload && (payload.msg || payload.error_description || payload.error || payload.message);
      throw new Error(message || `Auth failed (HTTP ${response.status})`);
    }
    return payload;
  }

  async function handleRedirect() {
    const params = new URLSearchParams(location.search);
    const error = params.get('error_description') || params.get('error');
    const code = params.get('code');
    if (!error && !code) return;
    const clean = location.origin + location.pathname + location.hash;
    history.replaceState(null, '', clean);
    if (error) {
      saveSession(null);
      window.__decisiveCloudError = error;
      return;
    }
    const verifier = (() => { try { return localStorage.getItem(VERIFIER_KEY); } catch { return null; } })();
    try { localStorage.removeItem(VERIFIER_KEY); } catch {}
    if (!verifier) return;
    try {
      const payload = await authFetch('/auth/v1/token?grant_type=pkce', {
        method: 'POST',
        body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      });
      saveSession(toSession(payload));
    } catch (err) {
      saveSession(null);
      window.__decisiveCloudError = String(err.message || err);
      emit();
    }
  }

  async function refreshSession() {
    if (!session || !session.refreshToken) throw new Error('Session expired. Please sign in again.');
    const payload = await authFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    saveSession(toSession(payload));
    return session;
  }

  async function ensureSession() {
    if (ready) await ready;
    if (!session) throw new Error('Not signed in.');
    if (session.expiresAt - 60000 < Date.now()) await refreshSession();
    return session;
  }

  async function rest(path, options = {}) {
    const active = await ensureSession();
    const response = await fetch(`${BASE}/rest/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${active.accessToken}`,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      if (response.status === 401) saveSession(null);
      const message = payload && (payload.message || payload.error);
      throw new Error(message || `Cloud request failed (HTTP ${response.status})`);
    }
    return payload;
  }

  function rowToTask(row) {
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      quadrant: row.quadrant,
      order: row.order_index,
      importance: row.importance,
      urgency: row.urgency,
      dueDate: row.due_date || null,
      done: Boolean(row.done),
      doneAt: row.done_at,
      archived: Boolean(row.archived),
      archivedAt: row.archived_at,
    };
  }

  function taskPatchToRow(body) {
    const row = {};
    if ('title' in body) row.title = String(body.title);
    if ('note' in body) row.note = String(body.note);
    if ('quadrant' in body) row.quadrant = body.quadrant;
    if ('order' in body) row.order_index = Number(body.order) || 0;
    if ('importance' in body) row.importance = Number(body.importance) || 0;
    if ('urgency' in body) row.urgency = Number(body.urgency) || 0;
    if ('dueDate' in body) row.due_date = body.dueDate || null;
    if ('done' in body) {
      row.done = Boolean(body.done);
      row.done_at = row.done ? new Date().toISOString() : null;
      if (!row.done) { row.archived = false; row.archived_at = null; }
    }
    if ('archived' in body) {
      row.archived = Boolean(body.archived);
      row.archived_at = row.archived ? new Date().toISOString() : null;
    }
    return row;
  }

  async function reindexQuadrant(quadrant) {
    const rows = await rest(`tasks?select=id,order_index&quadrant=eq.${quadrant}&done=eq.false&archived=eq.false&order=order_index.asc`);
    if (!Array.isArray(rows)) return;
    const changed = rows
      .map((row, index) => ({ id: row.id, order_index: index }))
      .filter((row, index) => rows[index].order_index !== index);
    if (!changed.length) return;
    await rest('tasks', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(changed),
    });
  }

  async function request(method, path, body) {
    if (!configured) throw new Error('Cloud is not configured.');
    const tasksRoute = path === '/api/tasks';
    const oneMatch = /^\/api\/tasks\/([^/?]+)$/.exec(path);
    if (path === '/api/demo/restore') throw new Error('Demo restore is available in local mode only.');

    if (method === 'GET' && tasksRoute) {
      const rows = await rest('tasks?select=*&order=order_index.asc');
      return (Array.isArray(rows) ? rows : []).map(rowToTask);
    }
    if (method === 'POST' && tasksRoute) {
      const row = taskPatchToRow(body || {});
      if (!('order_index' in row)) row.order_index = 0;
      if (!row.quadrant) row.quadrant = 'do';
      if (!('importance' in row)) row.importance = DEFAULT_WEIGHTS[row.quadrant].importance;
      if (!('urgency' in row)) row.urgency = DEFAULT_WEIGHTS[row.quadrant].urgency;
      const created = await rest('tasks', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(row),
      });
      const saved = Array.isArray(created) ? created[0] : created;
      if (saved && 'order_index' in row) await reindexQuadrant(saved.quadrant);
      return rowToTask(saved);
    }
    if (oneMatch && (method === 'PATCH' || method === 'DELETE')) {
      const id = oneMatch[1];
      if (method === 'DELETE') {
        await rest(`tasks?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
        return { ok: true };
      }
      const row = taskPatchToRow(body || {});
      if ('quadrant' in row && !('importance' in row) && !('urgency' in row)) {
        row.importance = DEFAULT_WEIGHTS[row.quadrant].importance;
        row.urgency = DEFAULT_WEIGHTS[row.quadrant].urgency;
      }
      const updated = await rest(`tasks?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(row),
      });
      const saved = Array.isArray(updated) ? updated[0] : updated;
      if (saved && ('order_index' in row || 'quadrant' in row)) await reindexQuadrant(saved.quadrant);
      return rowToTask(saved);
    }
    throw new Error(`Cloud adapter does not handle ${method} ${path}`);
  }

  async function signInWithGoogle() {
    if (!configured) throw new Error('Cloud is not configured.');
    const { verifier, challenge } = await makePkce();
    try { localStorage.setItem(VERIFIER_KEY, verifier); } catch {}
    location.href = buildAuthorizeUrl(location.origin + location.pathname, challenge);
  }

  async function signOut() {
    if (!configured) return;
    if (session && session.accessToken) {
      try {
        await fetch(`${BASE}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: ANON, Authorization: `Bearer ${session.accessToken}` },
        });
      } catch {}
    }
    saveSession(null);
  }

  session = readSession();
  ready = handleRedirect().catch(() => {});

  window.DecisiveCloud = {
    configured,
    isActive: () => configured && Boolean(session && session.accessToken),
    getSession: () => session,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    request,
    signInWithGoogle,
    signOut,
    ready: () => ready,
    buildAuthorizeUrl,
    _internal: { rowToTask, taskPatchToRow },
  };
})();
