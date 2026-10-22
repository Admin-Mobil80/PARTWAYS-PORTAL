// PartWays HR workspace: sign-in, navigation shell and hash router.
import { h, mount, api, toast, store, watchForUpdates } from '../lib.js';
import { countryOptions, guessCountry } from '../countries.js';
import { state, ROLES, can, effectiveRole, setRole, setWorkspace, signOut, hr, refreshMe, refreshProgrammes, refreshThemes, plural } from './core.js';

// Silence an interviewer still talking from an interview page left in this tab.
try { speechSynthesis.cancel(); } catch { /* unsupported */ }
watchForUpdates();

const ROUTES = [
  [/^\/$/, () => import('./home.js'), 'home'],
  [/^\/programmes$/, () => import('./home.js').then((m) => ({ render: m.renderPortfolio })), 'programmes'],
  [/^\/programmes\/new$/, () => import('./programme.js').then((m) => ({ render: m.renderNew })), 'programmes'],
  [/^\/programmes\/([^/]+)(?:\/(overview|guide|participants|settings))?$/, () => import('./programme.js'), 'programmes'],
  [/^\/insights$/, () => import('./insights.js'), 'insights'],
  [/^\/insights\/theme\/([^/]+)$/, () => import('./insights.js').then((m) => ({ render: m.renderTheme })), 'insights'],
  // The assistant is the Ask tab of Insights; old links still work.
  [/^\/assistant$/, () => import('./insights.js').then((m) => ({ render: (el) => m.render(el, [], { tab: 'ask' }) })), 'insights'],
  [/^\/reports$/, () => import('./reports.js'), 'reports'],
  [/^\/reports\/([^/]+)$/, () => import('./reports.js').then((m) => ({ render: m.renderReport })), 'reports'],
  [/^\/settings$/, () => import('./settings.js'), 'settings'],
  [/^\/billing$/, () => import('./billing.js'), 'billing'],
  [/^\/team$/, () => import('./team.js'), 'team'],
];

const NAV = [
  ['home', '#/', 'Home', null],
  ['programmes', '#/programmes', 'Programmes', 'programmes'],
  ['insights', '#/insights', 'Insights', 'insights'],
  ['reports', '#/reports', 'Reports', 'reports'],
  ['team', '#/team', 'Team', 'team'],
  ['billing', '#/billing', 'Credits and billing', 'billing'],
  ['settings', '#/settings', 'Settings', 'settings'],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

// --- Sign-in and free sign-up ---------------------------------------------------

function loginScreen() {
  let mode = location.hash.startsWith('#/signup') ? 'signup' : 'signin';
  let step = 'details', session = null;
  const f = { email: '', orgName: '', country: guessCountry() };
  const root = h('main', { id: 'main', class: 'login' });
  const mark = () => h('a', { class: 'pw-mark', href: '/' }, h('span', { class: 'dot' }, 'P'), 'PartWays');
  const switchMode = (m) => { mode = m; step = 'details'; history.replaceState(null, '', m === 'signup' ? '#/signup' : '#/'); render(); };
  const render = (msg, action) => {
    const errEl = msg ? h('div', { class: 'notice bad', role: 'alert' }, h('div', msg, action ? h('div', { style: { marginTop: '.4rem' } }, action) : null)) : null;
    if (step === 'details') {
      const input = (k, label, type = 'text', attrs = {}) => h('div', { class: 'field' }, h('label', { for: `f-${k}` }, label),
        h('input', { type, id: `f-${k}`, value: f[k], required: true, oninput: (e) => { f[k] = e.target.value; }, ...attrs }));
      const country = h('div', { class: 'field' }, h('label', { for: 'f-country' }, 'Country'),
        h('select', { id: 'f-country', required: true, onchange: (e) => { f.country = e.target.value; } }, h('option', { value: '' }, 'Choose…'),
          countryOptions().map(([c, n]) => h('option', { value: c, selected: c === f.country }, n))));
      const fields = mode === 'signup'
        ? [input('orgName', 'Organisation name', 'text', { autocomplete: 'organization' }), country, input('email', 'Work email', 'email', { autocomplete: 'email' })]
        : [input('email', 'Work email', 'email', { autocomplete: 'email' })];
      const btn = h('button', { class: 'btn primary lg', type: 'submit' }, mode === 'signup' ? 'Create my free account' : 'Send me a sign-in code');
      const form = h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        f.email = f.email.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return render('Enter a valid work email address.');
        if (mode === 'signup' && (!f.orgName.trim() || !f.country)) return render('Enter your organisation name and choose your country.');
        btn.disabled = true;
        try {
          const r = mode === 'signup'
            ? await api('/api/auth/signup', { method: 'POST', body: { email: f.email, orgName: f.orgName, country: f.country } })
            : await api('/api/auth/start', { method: 'POST', body: { email: f.email } });
          session = r.session; step = 'code';
          render(); if (r.devCode) toast(`Local development: your code is ${r.devCode}`, { timeout: 12000 });
          else if (r.delivery === 'console') toast('Local development: the code is printed in the server console.', { timeout: 8000 });
        } catch (err) {
          btn.disabled = false;
          if (err.status === 404) render(err.message, h('button', { class: 'btn sm', type: 'button', onclick: () => switchMode('signup') }, 'Create a free account'));
          else if (err.status === 409) render(err.message, h('button', { class: 'btn sm', type: 'button', onclick: () => switchMode('signin') }, 'Sign in instead'));
          else render(err.message);
        }
      } }, ...fields, errEl, btn);
      mount(root, h('div', { class: 'card stack' }, mark(),
        mode === 'signup'
          ? [h('h1', 'Start with 3 free interviews'), h('p', { class: 'ink2' }, 'Create your organisation’s PartWays workspace. No card needed. We will email you a 6-digit code instead of a password.')]
          : [h('h1', 'Sign in to your workspace'), h('p', { class: 'ink2' }, 'For HR and People professionals. We will email you a 6-digit code. There is no password.')],
        form,
        h('p', { class: 'small muted', style: { margin: 0 } }, mode === 'signup'
          ? ['Already have a workspace? ', h('a', { href: '#/', onclick: (e) => { e.preventDefault(); switchMode('signin'); } }, 'Sign in')]
          : ['New to PartWays? ', h('a', { href: '#/signup', onclick: (e) => { e.preventDefault(); switchMode('signup'); } }, 'Create a free account'), ' with 3 free interviews.'])));
      root.querySelector('input').focus();
    } else {
      const input = h('input', { type: 'text', id: 'code', class: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true });
      const form = h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        const code = input.value.replace(/\D/g, '');
        if (code.length !== 6) return render('Enter the 6-digit code from the email.');
        try {
          const r = await api('/api/auth/verify', { method: 'POST', body: { email: f.email, code, session } });
          if (r.retry) { session = r.session; return render(r.error); }
          state.token = r.token; state.email = r.email;
          store.set('pw.hr.token', r.token); store.set('pw.hr.email', r.email);
          setWorkspace('own');
          history.replaceState(null, '', '#/');
          if (r.created) toast('Your workspace is ready, with 3 free interviews.', { timeout: 7000 });
          start();
        } catch (err) { render(err.message); }
      } }, h('div', { class: 'field' }, h('label', { for: 'code' }, 'Sign-in code'), h('span', { class: 'hint' }, `Sent to ${f.email}. It expires in 10 minutes.`), input), errEl,
      h('div', { class: 'row' }, h('button', { class: 'btn primary lg', type: 'submit' }, mode === 'signup' ? 'Create workspace' : 'Sign in'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { step = 'details'; render(); } }, 'Use a different email')));
      mount(root, h('div', { class: 'card stack' }, mark(), h('h1', 'Check your email'), form));
      input.focus();
    }
  };
  render();
  mount('#app', root);
}

// --- Shell ------------------------------------------------------------------

let main, side, crumbs;

function switchWorkspace(ws) {
  if (ws === state.workspace) return;
  setWorkspace(ws);
  location.hash = '#/';
  start();
}

export const showDemo = () => switchWorkspace('demo');

export function creditsBadge() {
  const c = state.me?.credits;
  if (!c || c.unlimited) return null;
  return h('a', { class: `badge ${c.balance ? 'accent' : 'warn'}`, href: '#/billing', title: '1 credit = 1 interview invitation' }, plural(c.balance, 'credit'));
}

let creditsSlot;
export async function updateCredits() {
  try { await refreshMe(); } catch { return; }
  creditsSlot?.replaceChildren(creditsBadge() || '');
}

function buildShell() {
  const roleSel = h('select', { 'aria-label': 'View as role', style: { minHeight: '34px', fontSize: '.85rem' }, onchange: (e) => { setRole(e.target.value); buildShell(); route(); toast(`Viewing as ${ROLES[state.role].label}. Demonstration role switch.`); } },
    Object.entries(ROLES).map(([k, v]) => h('option', { value: k, selected: k === state.role }, v.label)));
  const wsBtn = (ws, label) => h('button', { type: 'button', 'aria-pressed': String(state.workspace === ws), onclick: () => switchWorkspace(ws) }, label);
  side = h('aside', { class: 'side', 'aria-label': 'Workspace navigation' },
    h('a', { class: 'pw-mark', href: '#/' }, h('span', { class: 'dot' }, 'P'), 'PartWays'),
    h('div', { class: 'seg ws-switch', role: 'group', 'aria-label': 'Workspace' }, wsBtn('own', 'My workspace'), wsBtn('demo', 'Demo')),
    h('div', { class: 'org-chip' }, h('span', { class: 'sw', style: { background: state.org?.brandColor } }), state.org?.name || ''),
    h('nav', NAV.filter(([, , , need]) => !need || can(need)).map(([id, href, label]) => h('a', { href, 'data-nav': id }, label))),
    h('div', { class: 'foot' },
      state.workspace === 'demo' ? h('label', { class: 'small muted' }, 'View as (demo)', roleSel) : null,
      h('div', { class: 'small muted', style: { overflowWrap: 'anywhere' } }, state.email),
      h('button', { class: 'btn sm', type: 'button', onclick: signOut }, 'Sign out')));
  crumbs = h('div', { class: 'crumbs' });
  main = h('main', { id: 'main', class: 'page', tabindex: '-1' });
  const menu = h('button', { class: 'btn sm menu-btn', type: 'button', 'aria-label': 'Open navigation', onclick: () => side.classList.toggle('open') }, '☰');
  creditsSlot = h('span', { class: 'credits-slot' }, creditsBadge() || '');
  mount('#app',
    state.org?.demo ? h('div', { class: 'demo-strip' }, 'Demonstration workspace: fictional organisation and data. ', h('button', { class: 'linkish', type: 'button', onclick: () => switchWorkspace('own') }, 'Back to my workspace')) : null,
    h('div', { class: 'shell' }, side,
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'topline' }, menu, crumbs, h('span', { class: 'spacer' }),
          creditsSlot,
          h('span', { class: 'badge role-pill' }, ROLES[effectiveRole()].label),
          state.meta?.llm && !state.meta.llm.live ? h('span', { class: 'badge warn', title: 'No model key configured: rule-based fallback is used.' }, 'Offline developer mode') : null),
        main)));
}

export function setCrumbs(...parts) {
  if (!crumbs) return;
  crumbs.replaceChildren(...parts.flatMap((p, i) => [i ? ' / ' : '', Array.isArray(p) ? h('a', { href: p[1] }, p[0]) : p]));
  document.title = `${typeof parts.at(-1) === 'string' ? parts.at(-1) : parts.at(-1)[0]} · PartWays`;
}

let routeSeq = 0;
async function route() {
  const { path, query } = parseHash();
  side?.classList.remove('open');
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { mount(main, h('div', { class: 'empty' }, h('h3', 'Page not found'), h('a', { href: '#/' }, 'Go to home'))); return; }
  const [re, load, nav] = hit;
  for (const a of side.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const seq = ++routeSeq;
  const params = path.match(re).slice(1);
  try {
    const mod = await load();
    if (seq !== routeSeq) return;
    main.replaceChildren();
    window.scrollTo(0, 0);
    await mod.render(main, params, query);
    if (seq === routeSeq) (main.querySelector('#page-title') || main).focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    if (seq === routeSeq) mount(main, h('div', { class: 'notice bad', role: 'alert' }, err.message || 'This page could not be loaded.'));
  }
}

export function rerender() { route(); }

async function start() {
  try {
    if (!ROLES[state.role]) setRole('owner');
    const [{ org }, meta] = await Promise.all([hr('/api/hr/org'), hr('/api/hr/meta'), refreshMe()]);
    state.org = org; state.meta = meta;
    await Promise.all([refreshProgrammes(), refreshThemes()]);
  } catch (err) {
    if (!state.token) return;
    mount('#app', h('main', { class: 'login' }, h('div', { class: 'card' }, h('p', err.message), h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'))));
    return;
  }
  buildShell();
  window.onhashchange = route;
  route();
}

if (state.token) start(); else loginScreen();
