// Improvement actions: owned, dated, linked to the evidence that prompted them.
import { h, mount, fmt, toast, dialog, store } from '../lib.js';
import { state, hr, can, go, pageHead, loading, errorBox, themeLabel } from './core.js';
import { setCrumbs } from './app.js';
import { createActionDialog } from './insights.js';
import { table } from './charts.js';

const ORDER = ['proposed', 'accepted', 'in_progress', 'completed', 'closed'];
const KIND = { proposed: '', accepted: 'info', in_progress: 'accent', completed: 'good', closed: '' };

export async function render(el, params, query = {}) {
  setCrumbs('Actions');
  mount(el, loading());
  let data;
  try { data = await hr('/api/hr/actions'); } catch (err) { return mount(el, errorBox(err, () => render(el, params, query))); }
  let view = store.get('pw.hr.actview', 'list');
  let filter = query.filter || '';
  let owner = '';
  const owners = [...new Set(data.actions.map((a) => a.owner))].sort();
  const box = h('div');
  const draw = () => {
    store.set('pw.hr.actview', view);
    let list = data.actions;
    if (filter === 'overdue') list = list.filter((a) => a.overdue);
    else if (filter === 'open') list = list.filter((a) => !['completed', 'closed'].includes(a.status));
    else if (filter) list = list.filter((a) => a.status === filter);
    if (owner) list = list.filter((a) => a.owner === owner);
    if (!list.length) { box.replaceChildren(h('div', { class: 'empty' }, h('h3', 'No actions match'), h('p', 'Create actions from a theme, an objective finding or an assistant answer.'))); return; }
    const badge = (a) => [h('span', { class: `badge ${KIND[a.status]}` }, data.statuses[a.status]), a.overdue ? h('span', { class: 'badge bad', style: { marginLeft: '.3rem' } }, 'Overdue') : null];
    if (view === 'board') {
      box.replaceChildren(h('div', { class: 'board' }, ORDER.map((s) => h('div', { class: 'col' }, h('h3', `${fmt.title(data.statuses[s])} (${list.filter((a) => a.status === s).length})`),
        list.filter((a) => a.status === s).map((a) => h('button', { class: 'mini', type: 'button', onclick: () => go(`#/actions/${a.id}`) }, h('strong', a.title), h('span', { class: 'small muted' }, `${a.owner}${a.dueDate ? ` · due ${fmt.date(a.dueDate)}` : ''}`), a.overdue ? h('span', h('span', { class: 'badge bad' }, 'Overdue')) : null))))));
    } else {
      box.replaceChildren(h('div', { class: 'table-wrap card flat', style: { padding: 0 } }, h('table',
        h('thead', h('tr', ['Action', 'Owner', 'Due', 'Status', 'Themes'].map((c) => h('th', c)))),
        h('tbody', list.map((a) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => go(`#/actions/${a.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`#/actions/${a.id}`); } },
          h('td', h('a', { href: `#/actions/${a.id}`, onclick: (e) => e.stopPropagation() }, a.title)), h('td', a.owner), h('td', { class: 'small' }, fmt.date(a.dueDate)), h('td', badge(a)), h('td', { class: 'small' }, a.themes.map(themeLabel).join(', ')))))))) ;
    }
  };
  mount(el,
    pageHead('Actions', 'What you decided to do about the findings, who owns it, and how it is going.', can('actions') ? h('button', { class: 'btn primary', onclick: () => createActionDialog() }, 'New action') : null),
    h('div', { class: 'filters' },
      h('label', 'Show', h('select', { onchange: (e) => { filter = e.target.value; draw(); } }, [['', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ...ORDER.map((s) => [s, fmt.title(data.statuses[s])])].map(([v, l]) => h('option', { value: v, selected: filter === v }, l)))),
      h('label', 'Owner', h('select', { onchange: (e) => { owner = e.target.value; draw(); } }, h('option', { value: '' }, 'Anyone'), owners.map((o) => h('option', { value: o }, o)))),
      h('span', { class: 'spacer' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, [['list', 'List'], ['board', 'Board']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(view === k), onclick: (e) => { view = k; [...e.target.parentNode.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); draw(); } }, l)))),
    box);
  draw();
}

export async function renderAction(el, [id]) {
  mount(el, loading());
  let d;
  try { d = await hr(`/api/hr/actions/${id}`); } catch (err) { return mount(el, errorBox(err, () => renderAction(el, [id]))); }
  const a = d.action;
  setCrumbs(['Actions', '#/actions'], a.title);
  const editable = can('actions');
  const reload = () => renderAction(el, [id]);
  const statusBtn = (s) => h('button', { class: `btn sm${s === 'completed' ? ' primary' : ''}`, type: 'button', onclick: () => {
    const need = s === 'closed' ? 'Why is it being closed without action?' : s === 'completed' ? 'What was done, and what happened?' : null;
    const note = h('textarea', { rows: 3, id: 'sn' });
    dialog({ title: `Mark as ${d.action && fmt.title(s.replace('_', ' '))}`, body: h('div', { class: 'field' }, h('label', { for: 'sn' }, need || 'Note (optional)'), note),
      actions: [{ label: 'Cancel' }, { label: 'Update status', kind: 'primary', onClick: async () => { await hr(`/api/hr/actions/${id}/status`, { method: 'POST', body: { status: s, note: note.value } }); toast('Status updated.'); reload(); } }] });
  } }, fmt.title(s.replace('_', ' ')));
  const noteText = h('textarea', { rows: 2, id: 'nt', placeholder: 'What has happened since the last update?' });
  const noteLink = h('input', { type: 'text', placeholder: 'Optional link, https://…', 'aria-label': 'Link' });
  const editDialog = () => {
    const v = { title: a.title, owner: a.owner, dueDate: a.dueDate || '', outcome: a.outcome, successMeasure: a.successMeasure || '' };
    const f = (k, l, type = 'text') => h('div', { class: 'field', style: { margin: 0 } }, h('label', l), type === 'textarea' ? h('textarea', { rows: 2, oninput: (e) => { v[k] = e.target.value; } }, v[k]) : h('input', { type, value: v[k], oninput: (e) => { v[k] = e.target.value; } }));
    dialog({ title: 'Edit action', wide: true, body: h('div', { class: 'stack' }, f('title', 'Action'), h('div', { class: 'grid g2' }, f('owner', 'Owner'), f('dueDate', 'Due date', 'date')), f('outcome', 'Intended outcome', 'textarea'), f('successMeasure', 'Success measure', 'textarea')),
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => { await hr(`/api/hr/actions/${id}`, { method: 'PUT', body: v }); toast('Saved.'); reload(); } }] });
  };
  const r = d.related;
  mount(el,
    pageHead(a.title, null, h('span', { class: `badge ${KIND[a.status]}` }, d.action && fmt.title(a.status.replace('_', ' '))), a.overdue ? h('span', { class: 'badge bad' }, 'Overdue') : null, editable ? h('button', { class: 'btn sm', onclick: editDialog }, 'Edit') : null),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('section', { class: 'card stack' },
          h('dl', { class: 'kv' }, h('dt', 'Owner'), h('dd', a.owner), h('dt', 'Due'), h('dd', fmt.date(a.dueDate)), h('dt', 'Intended outcome'), h('dd', a.outcome),
            a.successMeasure ? [h('dt', 'Success measure'), h('dd', a.successMeasure)] : null,
            a.themes.length ? [h('dt', 'Themes'), h('dd', a.themes.map((t, i) => [i ? ', ' : '', h('a', { href: `#/insights/theme/${t}` }, themeLabel(t))]))] : null,
            a.closingNote ? [h('dt', a.status === 'closed' ? 'Reason closed' : 'Outcome note'), h('dd', a.closingNote)] : null),
          a.evidence ? h('div', { class: 'notice' }, h('div', h('strong', 'Evidence that prompted this'), h('div', { class: 'small' }, a.evidence.text), a.evidence.scope ? h('div', { class: 'small muted' }, typeof a.evidence.scope === 'string' ? a.evidence.scope : `${a.evidence.scope.programmes?.map((p) => p.name).join(', ')} · ${a.evidence.scope.periodLabel}`) : null)) : null,
          editable && !['completed', 'closed'].includes(a.status) ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Move to:'), ORDER.filter((s) => s !== a.status).map(statusBtn)) : null),
        r ? h('section', { class: 'card stack' }, h('h3', 'What later respondents said about these themes'),
          h('p', { class: 'small muted', style: { margin: 0 } }, r.note),
          table(['Quarter', 'Responses', ...a.themes.map(themeLabel)], r.periods.map((p) => [`${p.label.split(' (')[0]}${p.inProgress ? ' (in progress)' : ''}`, p.n, ...p.themes.map((t) => (p.available ? `${t.respondents ?? 0} (${fmt.pct(t.share)})` : 'Too few responses'))]), { numeric: [1, 2, 3, 4] })) : null,
        h('section', { class: 'card stack' }, h('h3', 'Progress notes'),
          a.notes.length ? h('ul', { class: 'list-plain' }, [...a.notes].reverse().map((n) => h('li', { class: 'card soft', style: { padding: '.6rem .8rem' } }, h('div', { class: 'small muted' }, `${fmt.dateTime(n.at)} · ${n.author}`), h('div', n.text), n.link ? h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, n.link) : null))) : h('p', { class: 'muted small' }, 'No notes yet.'),
          editable ? h('div', { class: 'stack' }, h('label', { for: 'nt', class: 'sr-only' }, 'Progress note'), noteText, noteLink,
            h('div', h('button', { class: 'btn sm', onclick: async () => { try { await hr(`/api/hr/actions/${id}/notes`, { method: 'POST', body: { text: noteText.value, link: noteLink.value } }); toast('Note added.'); reload(); } catch (err) { toast(err.message, { kind: 'bad' }); } } }, 'Add note'))) : null)),
      h('section', { class: 'card stack sticky-side' }, h('h3', 'History'),
        h('ul', { class: 'small', style: { margin: 0, paddingLeft: '1.1rem' } }, [...a.history].reverse().map((x) => h('li', `${fmt.dateTime(x.at)}: ${x.change}${x.note ? `. “${x.note}”` : ''}`, h('span', { class: 'muted' }, ` (${x.by})`)))))));
}

export { state };
