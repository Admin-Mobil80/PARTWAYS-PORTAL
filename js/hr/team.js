// Team members: the owner adds colleagues by email and chooses what each can do.
import { h, mount, fmt, toast, confirmDialog } from '../lib.js';
import { state, hr, pageHead, loading, errorBox, effectiveRole, ROLES } from './core.js';
import { setCrumbs } from './app.js';

const ROLE_HELP = {
  owner: 'Everything: programmes, inviting people, credits and the team.',
  analyst: 'Findings, the assistant, reports, actions and theme changes. Cannot invite people or buy credits.',
  leader: 'Reads findings and reports, asks the assistant and tracks actions.',
};

export async function render(el) {
  setCrumbs('Team');
  if (state.workspace !== 'own') return mount(el, pageHead('Team'), h('div', { class: 'notice' }, 'Team members are managed in your own workspace. Switch to “My workspace” in the sidebar.'));
  mount(el, loading());
  let members;
  try { members = (await hr('/api/hr/team')).members; } catch (err) { return mount(el, errorBox(err, () => render(el))); }
  const owner = effectiveRole() === 'owner';
  const roleSel = (value, onchange, attrs = {}) => h('select', { onchange: (e) => onchange(e.target.value), ...attrs }, Object.entries(ROLES).map(([k, v]) => h('option', { value: k, selected: k === value }, v.label)));

  const add = { email: '', role: 'analyst' };
  const email = h('input', { type: 'email', id: 'tm-email', placeholder: 'colleague@yourcompany.com', autocomplete: 'off', oninput: (e) => { add.email = e.target.value.trim(); } });
  const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Add to team');
  const addForm = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    addBtn.disabled = true;
    try {
      await hr('/api/hr/team', { method: 'POST', body: add });
      toast(`${add.email} can now sign in at ${location.origin}/hr/ with a 6-digit code sent to their email.`, { timeout: 9000 });
      render(el);
    } catch (err) { toast(err.message, { kind: 'bad' }); addBtn.disabled = false; }
  } },
  h('h3', { style: { margin: 0 } }, 'Add a team member'),
  h('div', { class: 'grid g2' },
    h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: 'tm-email' }, 'Work email'), email),
    h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: 'tm-role' }, 'Role'), roleSel(add.role, (v) => { add.role = v; }, { id: 'tm-role' }))),
  h('p', { class: 'small muted', style: { margin: 0 } }, 'They sign in with their email and a 6-digit code; there is no password. Let them know they have been added.'),
  h('div', addBtn));

  mount(el,
    pageHead('Team', `People from ${state.org.name} who can use this workspace.`),
    h('div', { class: 'stack', style: { gap: '1.25rem', maxWidth: '900px' } },
      h('div', { class: 'table-wrap card flat', style: { padding: 0 } }, h('table',
        h('thead', h('tr', ['Email', 'Role', 'Added', ''].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', members.map((m) => h('tr',
          h('td', { style: { overflowWrap: 'anywhere' } }, m.email, m.you ? h('span', { class: 'badge', style: { marginLeft: '.35rem' } }, 'You') : null),
          h('td', owner && !m.you
            ? roleSel(m.role, async (v) => { try { await hr(`/api/hr/team/${encodeURIComponent(m.email)}`, { method: 'PUT', body: { role: v } }); toast('Role updated.'); } catch (err) { toast(err.message, { kind: 'bad' }); render(el); } }, { 'aria-label': `Role for ${m.email}`, style: { width: 'auto' } })
            : ROLES[m.role]?.label || m.role),
          h('td', { class: 'small' }, fmt.date(m.addedAt)),
          h('td', owner && !m.you ? h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            if (!(await confirmDialog(`Remove ${m.email}?`, 'They will no longer be able to sign in to this workspace. Nothing they created is deleted.', { confirmLabel: 'Remove', kind: 'danger' }))) return;
            try { await hr(`/api/hr/team/${encodeURIComponent(m.email)}`, { method: 'DELETE' }); toast('Removed.'); render(el); } catch (err) { toast(err.message, { kind: 'bad' }); }
          } }, 'Remove') : null)))))),
      owner ? addForm : h('p', { class: 'muted' }, 'Only owners can add or remove team members.'),
      h('section', { class: 'card stack' }, h('h3', { style: { margin: 0 } }, 'Roles'),
        h('dl', { class: 'kv' }, Object.entries(ROLE_HELP).flatMap(([k, t]) => [h('dt', ROLES[k].label), h('dd', t)])))));
}
