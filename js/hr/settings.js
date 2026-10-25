// Organisation appearance, service configuration, and demonstration controls.
import { h, mount, toast, confirmDialog, dialog, fmt } from '../lib.js';
import { state, hr, can, pageHead, refreshProgrammes, refreshThemes, effectiveRole } from './core.js';
import { setCrumbs, rerender } from './app.js';
import { tryInterviewDialog } from './home.js';

// API keys let the organisation's HR system start exit interviews through the PartWays API.
// Owners of the organisation's own workspace manage them; a new key is shown once.
function apiAccess() {
  const list = h('div', h('p', { class: 'small muted' }, 'Loading…'));
  const showSecret = (secret) => dialog({
    title: 'Copy your API key now',
    body: h('div', { class: 'stack' },
      h('p', { class: 'ink2', style: { margin: 0 } }, 'This is the only time the full key is shown. Store it in your HR system’s secure settings. If it is lost, revoke it and create a new one.'),
      h('code', { style: { display: 'block', padding: '.6rem .75rem', background: 'var(--panel-2)', borderRadius: '8px', overflowWrap: 'anywhere', fontSize: '.85rem' } }, secret)),
    actions: [{ label: 'Copy key', onClick: async () => { try { await navigator.clipboard.writeText(secret); toast('Key copied.'); } catch { toast('Copy is not available here; select the key and copy it.', { kind: 'bad' }); } return false; } }, { label: 'Done', kind: 'primary' }],
  });
  const create = () => {
    let name = '';
    dialog({
      title: 'Create an API key',
      body: h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: 'ak-name' }, 'Name'), h('span', { class: 'hint' }, 'The system that will use it, for example “Workday”.'),
        h('input', { type: 'text', id: 'ak-name', maxlength: 60, oninput: (e) => { name = e.target.value; } })),
      actions: [{ label: 'Cancel' }, { label: 'Create key', kind: 'primary', onClick: async () => { const r = await hr('/api/hr/apikeys', { method: 'POST', body: { name } }); load(); showSecret(r.secret); } }],
    });
  };
  const revoke = async (k) => {
    if (!(await confirmDialog(`Revoke “${k.name}”?`, 'Systems using this key stop working straight away. Invitations already sent are unaffected.', { confirmLabel: 'Revoke', kind: 'danger' }))) return;
    try { await hr(`/api/hr/apikeys/${k.id}`, { method: 'DELETE' }); toast('Key revoked.'); load(); } catch (err) { toast(err.message, { kind: 'bad' }); }
  };
  const load = async () => {
    try {
      const { keys } = await hr('/api/hr/apikeys');
      list.replaceChildren(keys.length ? h('div', { class: 'table-wrap' }, h('table',
        h('thead', h('tr', ['Name', 'Key', 'Created', 'Last used', ''].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', keys.map((k) => h('tr',
          h('td', k.name, k.revokedAt ? h('span', { class: 'badge', style: { marginLeft: '.35rem' } }, 'Revoked') : null),
          h('td', h('code', { class: 'small' }, k.display)),
          h('td', { class: 'small' }, fmt.date(k.createdAt), h('br'), h('span', { class: 'muted' }, k.createdBy)),
          h('td', { class: 'small' }, k.lastUsedAt ? fmt.dateTime(k.lastUsedAt) : 'Never'),
          h('td', k.revokedAt ? null : h('button', { class: 'btn sm danger', type: 'button', onclick: () => revoke(k) }, 'Revoke'))))))) : h('p', { class: 'small muted', style: { margin: 0 } }, 'No API keys yet.'));
    } catch (err) { list.replaceChildren(h('p', { class: 'small', style: { margin: 0 } }, err.message)); }
  };
  load();
  return h('section', { class: 'card stack' }, h('h3', { style: { margin: 0 } }, 'API access'),
    h('p', { class: 'small ink2', style: { margin: 0 } }, 'Let your HR system start exit interviews automatically, for example when a resignation is recorded. Each invitation sent through the API uses one credit, just as from this workspace, and the API never returns interview content. ',
      h('a', { href: '/developers/', target: '_blank', rel: 'noopener' }, 'API reference')),
    list,
    h('div', h('button', { class: 'btn', type: 'button', onclick: create }, 'Create API key')));
}

export async function render(el) {
  setCrumbs('Settings');
  const org = { ...state.org };
  const preview = h('div', { class: 'org-chip' });
  const drawPreview = () => preview.replaceChildren(h('span', { class: 'sw', style: { background: org.brandColor } }), `Exit interview for ${org.name}`);
  drawPreview();
  const field = (k, label, hint) => h('div', { class: 'field' }, h('label', { for: `o-${k}` }, label), hint ? h('span', { class: 'hint' }, hint) : null, h('input', { type: 'text', id: `o-${k}`, value: org[k] || '', oninput: (e) => { org[k] = e.target.value; drawPreview(); } }));
  const reset = async (scope) => {
    const msg = scope === 'all'
      ? 'Everything returns to the original demonstration state: programmes, participants, interviews, reports and theme changes. Your evaluation interviews are removed.'
      : 'Interviews, participants and imports you added during this evaluation are removed. The demonstration data is unchanged.';
    if (!(await confirmDialog(scope === 'all' ? 'Reset the whole demonstration?' : 'Remove your evaluation data?', msg, { confirmLabel: 'Reset', kind: 'danger' }))) return;
    try {
      await hr('/api/hr/demo/reset', { method: 'POST', body: { scope } });
      await Promise.all([refreshProgrammes(), refreshThemes()]);
      toast('Reset complete.');
      rerender();
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  };
  const demo = state.org.demo;
  mount(el, pageHead('Settings', demo ? 'These settings belong to the demonstration workspace. Your own workspace is unaffected.' : null),
    h('div', { class: 'stack', style: { gap: '1.25rem', maxWidth: '860px' } },
      h('section', { class: 'card' }, h('h3', 'Organisation'),
        h('p', { class: 'small muted' }, 'Employees see your organisation name and colour alongside the PartWays identity, so it is clear who commissioned the interview and who runs it.'),
        field('name', 'Organisation name'), field('shortName', 'Short name', 'Used in messages, for example “Calder & Finch”.'),
        h('div', { class: 'field' }, h('label', { for: 'o-col' }, 'Brand colour'), h('div', { class: 'row' }, h('input', { type: 'color', id: 'o-col', value: org.brandColor, oninput: (e) => { org.brandColor = e.target.value; drawPreview(); } }), preview)),
        can('edit') ? h('button', { class: 'btn primary', onclick: async () => { try { const r = await hr('/api/hr/org', { method: 'PUT', body: { name: org.name, shortName: org.shortName, brandColor: org.brandColor } }); state.org = r.org; toast('Saved.'); } catch (err) { toast(err.message, { kind: 'bad' }); } } }, 'Save') : null),
      demo ? h('section', { class: 'card stack' }, h('h3', 'Demonstration'),
        h('p', { class: 'small ink2', style: { margin: 0 } }, `${state.org.name} is a fictional organisation. Its data covers three programmes and three quarters of 2026, including declines, expiries, corrections and a withdrawal. This copy is private to your organisation.`),
        h('div', { class: 'row' },
          can('programmes') ? h('button', { class: 'btn', onclick: () => tryInterviewDialog() }, 'Try an interview') : null,
          h('button', { class: 'btn', onclick: () => reset('evaluation') }, 'Remove my evaluation data'),
          can('taxonomy') ? h('button', { class: 'btn', onclick: async () => { if (await confirmDialog('Undo all theme changes?', 'Renames, merges and splits are removed. Employee summaries were never changed.', { confirmLabel: 'Undo theme changes' })) { await hr('/api/hr/taxonomy/reset', { method: 'POST' }); await refreshThemes(); toast('Theme changes removed.'); } } }, 'Undo theme changes') : null,
          h('button', { class: 'btn danger', onclick: () => reset('all') }, 'Reset the whole demonstration')),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Use “View as” in the sidebar to see the workspace as a programme owner, people analyst or leader.')) : null,
      !demo && effectiveRole() === 'owner' ? apiAccess() : null));
}
