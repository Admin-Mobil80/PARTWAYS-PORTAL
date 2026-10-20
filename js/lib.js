// Small shared helpers: DOM building, API calls, dialogs, toasts, formatting.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target, ...children) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  el.replaceChildren();
  append(el, children);
  return el;
}

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'You appear to be offline. Your work on this page is kept; try again when you are reconnected.');
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error || 'Request failed.');
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.', data.details);
  return data;
}

// Reads an NDJSON stream, calling onMessage for each object.
export async function streamApi(path, body, headers, onMessage) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Connection lost.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error || 'Request failed.');
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onMessage(JSON.parse(line));
    }
  }
  if (buf.trim()) onMessage(JSON.parse(buf));
}

export function toast(message, { kind = '', timeout = 4200 } = {}) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), timeout);
}

// Shows a reload prompt when a newer version of the app has been deployed.
// /version.json changes on every deploy (and locally whenever a frontend file changes).
export function watchForUpdates({ message = 'A new version of PartWays is available.', note = 'Your work is saved.', reload = 'Reload', later = 'Later' } = {}) {
  let current = null, shown = false;
  const check = async () => {
    if (shown) return;
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const { version } = await res.json();
      if (!current) { current = version; return; }
      if (version !== current) show();
    } catch { /* offline: try again later */ }
  };
  const show = () => {
    shown = true;
    const txt = (v) => (typeof v === 'function' ? v() : v);
    [message, note, reload, later] = [message, note, reload, later].map(txt);
    const bar = h('div', { class: 'update-bar', role: 'alert' },
      h('span', message, ' ', h('span', { class: 'muted-on-ink' }, note)),
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => location.reload() }, reload),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => bar.remove() }, later));
    document.body.append(bar);
  };
  check();
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}

export function dialog({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: wide ? 'wide' : '', 'aria-labelledby': 'dlg-title' });
  const close = (v) => { dlg.close(); dlg.remove(); onClose?.(v); };
  const foot = h('div', { class: 'dlg-foot' }, actions.map((a) => h('button', {
    class: `btn ${a.kind || ''}`, type: 'button',
    onclick: async (e) => {
      if (!a.onClick) return close(a.value);
      const btn = e.currentTarget;
      btn.disabled = true;
      try { const r = await a.onClick(); if (r !== false) close(a.value); } catch (err) { toast(err.message, { kind: 'bad' }); } finally { btn.disabled = false; }
    },
  }, a.label)));
  dlg.append(h('div', { class: 'dlg-head' }, h('h2', { id: 'dlg-title' }, title)), h('div', { class: 'dlg-body' }, body), actions.length ? foot : null);
  dlg.addEventListener('cancel', () => { dlg.remove(); onClose?.(null); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg };
}

export function confirmDialog(title, message, { confirmLabel = 'Confirm', kind = 'primary' } = {}) {
  return new Promise((resolve) => {
    dialog({ title, body: h('p', message), actions: [{ label: 'Cancel', value: false }, { label: confirmLabel, kind, value: true }], onClose: (v) => resolve(!!v) });
  });
}

export const fmt = {
  pct: (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`),
  pp: (x) => (x == null ? '–' : `${x > 0 ? '+' : ''}${x.toFixed(0)} pp`),
  date: (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'),
  dateTime: (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–'),
  minutes: (ms) => `${Math.max(1, Math.round((ms || 0) / 60000))} min`,
  title: (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
};

let tipEl;
export function tooltip(el, text) {
  const show = (e) => {
    tipEl ||= document.body.appendChild(h('div', { class: 'tip', role: 'tooltip' }));
    tipEl.textContent = typeof text === 'function' ? text() : text;
    tipEl.style.display = 'block';
    const x = e.clientX ?? el.getBoundingClientRect().left;
    const y = e.clientY ?? el.getBoundingClientRect().top;
    tipEl.style.left = `${Math.min(x + 12, window.innerWidth - 290)}px`;
    tipEl.style.top = `${y + 14}px`;
  };
  const hide = () => { if (tipEl) tipEl.style.display = 'none'; };
  el.addEventListener('mousemove', show);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('focus', (e) => { const r = el.getBoundingClientRect(); show({ clientX: r.left, clientY: r.bottom }); });
  el.addEventListener('blur', hide);
  return el;
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

export function applyPrefs() {
  const p = store.get('pw.prefs', {});
  if (p.theme) document.documentElement.dataset.theme = p.theme; else delete document.documentElement.dataset.theme;
  document.documentElement.style.setProperty('--text-scale', p.scale || 1);
}

export function prefsControls() {
  const p = store.get('pw.prefs', {});
  const set = (patch) => { store.set('pw.prefs', { ...store.get('pw.prefs', {}), ...patch }); applyPrefs(); };
  return h('div', { class: 'row', style: { gap: '.35rem' } },
    h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Smaller text', onclick: () => set({ scale: Math.max(0.9, (store.get('pw.prefs', {}).scale || 1) - 0.1) }) }, 'A−'),
    h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Larger text', onclick: () => set({ scale: Math.min(1.4, (store.get('pw.prefs', {}).scale || 1) + 0.1) }) }, 'A+'),
    h('select', { 'aria-label': 'Colour theme', style: { width: 'auto', minHeight: '32px', padding: '.2rem .4rem' }, onchange: (e) => set({ theme: e.target.value || null }) },
      h('option', { value: '', selected: !p.theme }, 'Auto'), h('option', { value: 'light', selected: p.theme === 'light' }, 'Light'), h('option', { value: 'dark', selected: p.theme === 'dark' }, 'Dark')),
  );
}

export function debounce(fn, ms = 600) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const ICON = {
  mic: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 9.5V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3"/></svg>',
  pause: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  info: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  warn: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
};

export function icon(name) {
  const s = document.createElement('span');
  s.innerHTML = ICON[name] || '';
  return s.firstChild;
}
