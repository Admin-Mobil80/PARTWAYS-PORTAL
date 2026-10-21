// Shared HR workspace state: auth token, API wrapper, role, metadata and routing helpers.
import { api, store, h, toast, ApiError } from '../lib.js';

export const state = {
  token: store.get('pw.hr.token'),
  email: store.get('pw.hr.email'),
  role: store.get('pw.hr.role', 'owner'),
  // 'own' is the organisation's workspace; 'demo' is its private copy of the demonstration workspace.
  workspace: store.get('pw.hr.ws', 'own') === 'demo' ? 'demo' : 'own',
  me: null,
  meta: null,
  org: null,
  programmes: [],
};

export const ROLES = {
  owner: { label: 'Owner', can: ['programmes', 'participants', 'insights', 'assistant', 'reports', 'settings', 'edit'] },
  analyst: { label: 'Analyst', can: ['programmes', 'insights', 'assistant', 'reports', 'taxonomy'] },
  leader: { label: 'Leader', can: ['insights', 'assistant', 'reports'] },
};
// Programme owners can also refine themes.
ROLES.owner.can.push('taxonomy');

// "View as" is a demonstration control, so it only applies in the demo workspace.
// In an organisation's own workspace the signed-in person's team role applies.
export const effectiveRole = () => (state.workspace === 'demo' ? state.role : (ROLES[state.me?.role] ? state.me.role : 'owner'));
export const can = (what) => (['billing', 'team'].includes(what) ? state.workspace === 'own' : ROLES[effectiveRole()]?.can.includes(what));

export function setWorkspace(ws) {
  state.workspace = ws === 'demo' ? 'demo' : 'own';
  store.set('pw.hr.ws', state.workspace);
}

export async function refreshMe() {
  state.me = await hr('/api/hr/me');
  return state.me;
}

export function setRole(role) {
  state.role = ROLES[role] ? role : 'owner';
  store.set('pw.hr.role', state.role);
}

export function signOut() {
  state.token = null; state.email = null;
  store.del('pw.hr.token'); store.del('pw.hr.email');
  location.hash = '#/';
  location.reload();
}

const authHeaders = () => ({ authorization: `Bearer ${state.token}`, 'x-workspace': state.workspace });

export async function hr(path, opts = {}) {
  try {
    return await api(path, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { toast('Your session has ended. Please sign in again.', { kind: 'bad' }); signOut(); }
    throw err;
  }
}

// Downloads an authenticated file (PDF, CSV).
export async function download(path, filename, { method = 'GET', body } = {}) {
  const res = await api(path, { method, body, raw: true, headers: authHeaders() });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function refreshProgrammes() {
  state.programmes = (await hr('/api/hr/programmes')).programmes;
  return state.programmes;
}

export const go = (hash) => { location.hash = hash; };

export function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', h('h1', { tabindex: '-1', id: 'page-title' }, title), sub ? h('p', sub) : null),
    actions.length ? h('div', { class: 'row' }, actions) : null);
}

export function themeLabel(id) {
  return state.meta?.themes?.[id]?.label || id;
}

export const STATUS_LABEL = {
  invited: 'Invited', not_started: 'Opened, not started', in_progress: 'In progress', awaiting_review: 'Awaiting employee review',
  submitted: 'Submitted', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled', withdrawn: 'Withdrawn', abandoned: 'Abandoned',
};

export const PROG_STATUS = { active: 'good', paused: 'warn', draft: 'info', archived: '' };

export function errorBox(err, retry) {
  return h('div', { class: 'notice bad', role: 'alert' }, h('div', h('p', { style: { margin: 0 } }, err.message || 'Something went wrong.'),
    retry ? h('button', { class: 'btn sm', style: { marginTop: '.5rem' }, onclick: retry }, 'Try again') : null));
}

export function loading(label = 'Loading…') {
  return h('div', { class: 'stack', 'aria-busy': 'true' }, h('span', { class: 'sr-only' }, label),
    h('div', { class: 'skeleton', style: { height: '28px', width: '40%' } }), h('div', { class: 'skeleton', style: { height: '120px' } }), h('div', { class: 'skeleton', style: { height: '120px' } }));
}

export const MODE_LABEL = { ai_voice: 'Voice', ai_text: 'Text' };

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const LANG_LABEL = { en: 'English', de: 'German', fr: 'French' };

// Theme labels after any analyst renames, merges or splits.
export async function refreshThemes() {
  const { themes } = await hr('/api/hr/taxonomy');
  state.meta.themes = Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, { label: v.label, description: v.description }]));
}
