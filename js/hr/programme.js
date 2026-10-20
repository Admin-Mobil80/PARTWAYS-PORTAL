// Programme pages: overview, objectives-first guide editor with live preview, settings.
import { h, mount, fmt, toast, dialog, confirmDialog, debounce } from '../lib.js';
import { state, hr, can, go, pageHead, PROG_STATUS, refreshProgrammes, loading, errorBox, themeLabel, STATUS_LABEL, MODE_LABEL } from './core.js';
import { setCrumbs } from './app.js';
import { tryInterviewDialog } from './home.js';

const TABS = [['overview', 'Overview'], ['guide', 'Objectives and guide'], ['participants', 'Participants'], ['settings', 'Settings']];
const TIER_LABEL = { quick: 'All lengths', standard: 'Standard and in depth', in_depth: 'In depth only' };

export async function renderNew(el) {
  setCrumbs(['Programmes', '#/programmes'], 'New programme');
  const name = h('input', { type: 'text', id: 'pn', required: true, placeholder: 'For example: Warehouse exits 2027' });
  let template = 'general', dup = '';
  const tpl = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Starting template' }, Object.entries(state.meta.templates).map(([k, v]) => h('label', { class: 'check card flat', style: { padding: '.6rem .8rem' } },
    h('input', { type: 'radio', name: 'tpl', value: k, checked: k === template, onchange: () => { template = k; } }), h('span', h('strong', v.label), h('br'), h('span', { class: 'small muted' }, v.framing)))));
  const dupSel = h('select', { id: 'dup', onchange: (e) => { dup = e.target.value; tpl.hidden = !!dup; } }, h('option', { value: '' }, 'Start from a template'), state.programmes.map((p) => h('option', { value: p.id }, `Duplicate “${p.name}”`)));
  mount(el, pageHead('New programme', 'Start with a template or copy an existing programme. You will set out what you want to learn next, and PartWays proposes the interview plan.'),
    h('form', { class: 'card stack', style: { maxWidth: '720px' }, onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await hr('/api/hr/programmes', { method: 'POST', body: { name: name.value, template, duplicateOf: dup || undefined } });
        await refreshProgrammes();
        go(`#/programmes/${r.programme.id}/guide`);
      } catch (err) { toast(err.message, { kind: 'bad' }); }
    } }, h('div', { class: 'field' }, h('label', { for: 'pn' }, 'Programme name'), name),
    h('div', { class: 'field' }, h('label', { for: 'dup' }, 'Starting point'), dupSel), tpl,
    h('div', h('button', { class: 'btn primary', type: 'submit' }, 'Create draft programme'))));
}

export async function render(el, [id, tab = 'overview'], query) {
  mount(el, loading());
  let data;
  try { data = await hr(`/api/hr/programmes/${id}`); } catch (err) { return mount(el, errorBox(err, () => render(el, [id, tab], query))); }
  const p = data.programme;
  setCrumbs(['Programmes', '#/programmes'], p.name);
  const tabs = TABS.filter(([k]) => k !== 'participants' || can('participants')).filter(([k]) => !['settings'].includes(k) || can('edit'));
  const life = [];
  if (can('edit')) {
    if (p.status === 'active') life.push(h('button', { class: 'btn sm', onclick: () => lifecycle(p, 'pause') }, 'Pause invitations'));
    if (p.status === 'paused') life.push(h('button', { class: 'btn sm', onclick: () => lifecycle(p, 'resume') }, 'Resume'));
    if (p.status !== 'archived') life.push(h('button', { class: 'btn sm ghost', onclick: () => lifecycle(p, 'archive') }, 'Archive'));
    life.push(h('button', { class: 'btn sm ghost', onclick: () => duplicate(p) }, 'Duplicate'));
  }
  const body = h('div');
  mount(el,
    pageHead(p.name, p.description || null, h('span', { class: `badge ${PROG_STATUS[p.status]}` }, fmt.title(p.status)), ...life),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) => h('a', { role: 'tab', href: `#/programmes/${id}/${k}`, 'aria-selected': String(k === tab) }, label))),
    body);
  if (tab === 'guide') return guideEditor(body, data, query);
  if (tab === 'participants') return (await import('./participants.js')).renderProgrammeParticipants(body, p);
  if (tab === 'settings') return settings(body, p);
  return overview(body, data);
}

async function lifecycle(p, action) {
  const msg = { pause: 'No new invitations or reminders can be sent while paused. People who already have a link can still take part.', resume: 'Invitations can be sent again.', archive: 'The programme becomes read-only. Its findings stay available in insights and reports.' }[action];
  if (!(await confirmDialog(`${fmt.title(action)} “${p.name}”?`, msg, { confirmLabel: fmt.title(action) }))) return;
  try { await hr(`/api/hr/programmes/${p.id}/${action}`, { method: 'POST' }); await refreshProgrammes(); toast('Done.'); go(`#/programmes/${p.id}?t=${Date.now()}`); } catch (err) { toast(err.message, { kind: 'bad' }); }
}

async function duplicate(p) {
  try {
    const r = await hr('/api/hr/programmes', { method: 'POST', body: { name: `${p.name} (copy)`, duplicateOf: p.id } });
    await refreshProgrammes();
    toast('Created a draft copy. Its participants and findings are not copied.');
    go(`#/programmes/${r.programme.id}/guide`);
  } catch (err) { toast(err.message, { kind: 'bad' }); }
}

// --- Overview ---------------------------------------------------------------

async function overview(el, { programme: p }) {
  const summary = state.programmes.find((x) => x.id === p.id);
  const c = summary?.counts || {};
  const stat = (k, v, s) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v ?? 0), s ? h('div', { class: 's' }, s) : null);
  const started = (c.participants || 0) - (c.invited || 0) - (c.not_started || 0) - (c.declined || 0) - (c.expired || 0) - (c.cancelled || 0);
  mount(el, h('div', { class: 'stack', style: { gap: '1.25rem' } },
    p.status === 'draft' ? h('div', { class: 'notice' }, 'This programme is a draft. Set out your objectives, review the proposed guide, try it in a live preview, then activate it to start inviting people.', h('a', { class: 'btn sm', href: `#/programmes/${p.id}/guide` }, 'Open the guide')) : null,
    h('div', { class: 'stats' },
      stat('Invited', c.participants), stat('Started', Math.max(0, started)), stat('Submitted', c.submitted),
      stat('Declined', c.declined), stat('Expired', c.expired), stat('Awaiting employee review', c.awaiting_review),
      stat('Follow-up requests', summary?.followUps, 'open')),
    h('div', { class: 'grid g2' },
      h('section', { class: 'card stack' }, h('h3', 'Setup'),
        h('dl', { class: 'kv' },
          h('dt', 'Template'), h('dd', state.meta.templates[p.template]?.label || p.template),
          h('dt', 'Formats'), h('dd', p.modes.map((m) => MODE_LABEL[m]).join(', ')),
          h('dt', 'Languages'), h('dd', p.languages.map((l) => l.toUpperCase()).join(', ')),
          h('dt', 'Lengths'), h('dd', p.durations.map((d) => state.meta.durations[d].label).join(', ')),
          h('dt', 'Reporting'), h('dd', `${p.reportingMode === 'aggregate' ? 'Aggregate only (no quotes)' : 'Individual evidence allowed'} · minimum ${p.reportingMinimum} responses`),
          h('dt', 'Identity'), h('dd', 'De-identified: people are known by PartWays Interview Id')),
        h('div', { class: 'row' },
          can('insights') && p.activeVersion ? h('a', { class: 'btn sm', href: `#/insights?programmeId=${p.id}` }, 'View findings') : null,
          can('programmes') && (p.status === 'active' || !state.org.demo) ? h('button', { class: 'btn sm', onclick: () => tryInterviewDialog(p.id) }, 'Try an interview') : null)),
      h('section', { class: 'card stack' }, h('h3', 'Objectives'),
        p.objectives.length ? h('ul', { class: 'list-plain' }, p.objectives.map((o) => h('li', h('strong', o.title), ' ', h('span', { class: 'badge' }, `${o.priority} priority`),
          o.appliesTo ? h('span', { class: 'small muted' }, ` · only ${o.appliesTo.values.join(', ')}`) : null))) : h('p', { class: 'muted' }, 'No objectives yet.'))),
    h('section', { class: 'card stack' }, h('h3', 'Guide versions'),
      p.guideVersions.length ? h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', h('th', 'Version'), h('th', 'Activated'), h('th', 'Changes'))),
        h('tbody', [...p.guideVersions].reverse().map((v) => h('tr', h('td', `v${v.version}${v.version === p.activeVersion ? ' (active)' : ''}`), h('td', fmt.date(v.activatedAt)), h('td', { class: 'small' }, v.changeSummary))))))
        : h('p', { class: 'muted' }, 'Not activated yet.'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Each interview records the guide version it used, so findings can be read against what was asked.'))));
}

// --- Guide editor -----------------------------------------------------------

function blankObjective() { return { id: `obj_${Math.random().toString(36).slice(2, 9)}`, title: '', description: '', context: '', priority: 'medium', depth: 'standard', appliesTo: null, topicIds: [], themeIds: [] }; }

async function guideEditor(el, data, query) {
  const p = data.programme;
  const editable = can('edit') && p.status !== 'archived';
  const g = structuredClone(data.working);
  let analysis = data.analysis, changes = data.changes;
  let saveState = 'saved';
  const saveEl = h('span', { class: 'small muted', 'aria-live': 'polite' });
  const setSave = (s, extra = '') => { saveState = s; saveEl.textContent = { saved: `Saved${extra}`, saving: 'Saving…', dirty: 'Unsaved changes', error: `Not saved: ${extra}` }[s]; };
  setSave('saved', p.draft ? ' as draft' : '');

  const save = async () => {
    setSave('saving');
    try {
      const r = await hr(`/api/hr/programmes/${p.id}/draft`, { method: 'PUT', body: { objectives: g.objectives, topics: g.topics } });
      Object.assign(p, r.programme); analysis = r.analysis; changes = r.changes;
      setSave('saved', p.status === 'draft' ? '' : ' as draft');
      drawSide();
    } catch (err) { setSave('error', err.message); }
  };
  const autosave = debounce(save, 1200);
  const changed = () => { setSave('dirty'); autosave(); };

  const objBox = h('div', { class: 'stack' });
  const topicBox = h('div', { class: 'stack' });
  const side = h('div', { class: 'stack sticky-side' });

  const drawObjectives = () => {
    objBox.replaceChildren(...g.objectives.map((o, i) => objectiveCard(o, i)), editable ? h('div', { class: 'row' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => { g.objectives.push(blankObjective()); drawObjectives(); objBox.querySelector('.objective:last-of-type input')?.focus(); } }, '+ Add an objective')) : null);
  };
  const objectiveCard = (o, i) => {
    const dimSel = h('select', { 'aria-label': 'Applies to dimension', disabled: !editable, onchange: (e) => { o.appliesTo = e.target.value ? { dimension: e.target.value, values: [] } : null; drawObjectives(); changed(); } },
      h('option', { value: '' }, 'Everyone in the programme'), state.meta.dimensions.map((d) => h('option', { value: d.key, selected: o.appliesTo?.dimension === d.key }, `Only some: ${d.label}`)));
    const valuesInput = o.appliesTo ? h('input', { type: 'text', 'aria-label': 'Values', disabled: !editable, value: o.appliesTo.values.join(', '), placeholder: 'For example: Under 6 months', oninput: (e) => { o.appliesTo.values = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); changed(); } }) : null;
    const linked = g.topics.filter((t) => t.objectiveIds?.includes(o.id));
    return h('div', { class: `objective${query.highlight === o.id ? ' highlight' : ''}`, id: `obj-${o.id}` },
      h('div', { class: 'row between' }, h('strong', `Objective ${i + 1}`),
        editable ? h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
          if (linked.length && !(await confirmDialog('Remove this objective?', `${linked.length} topic(s) are linked to it. The topics stay in the guide but will no longer be linked.`, { confirmLabel: 'Remove' }))) return;
          g.objectives.splice(i, 1); for (const t of g.topics) t.objectiveIds = (t.objectiveIds || []).filter((x) => x !== o.id); drawObjectives(); drawTopics(); changed();
        } }, 'Remove') : null),
      h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `ot-${o.id}` }, 'What do you want to understand?'),
        h('input', { type: 'text', id: `ot-${o.id}`, value: o.title, disabled: !editable, placeholder: 'For example: Why do new starters leave in their first six months?', oninput: (e) => { o.title = e.target.value; changed(); } })),
      h('div', { class: 'grid g2' },
        h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `od-${o.id}` }, 'Why it matters (optional)'),
          h('textarea', { id: `od-${o.id}`, rows: 2, disabled: !editable, oninput: (e) => { o.description = e.target.value; changed(); } }, o.description || '')),
        h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `oc-${o.id}` }, 'Background for the interviewer (optional)'), h('span', { class: 'hint' }, 'Recent changes or hypotheses. Used to ask better follow-ups, never shared with employees.'),
          h('textarea', { id: `oc-${o.id}`, rows: 2, disabled: !editable, oninput: (e) => { o.context = e.target.value; changed(); } }, o.context || ''))),
      h('div', { class: 'row' },
        h('label', { class: 'small' }, 'Priority ', h('select', { disabled: !editable, style: { width: 'auto' }, onchange: (e) => { o.priority = e.target.value; changed(); } }, ['high', 'medium', 'low'].map((x) => h('option', { value: x, selected: o.priority === x }, fmt.title(x))))),
        h('label', { class: 'small' }, 'Depth ', h('select', { disabled: !editable, style: { width: 'auto' }, onchange: (e) => { o.depth = e.target.value; changed(); } }, [['light', 'Light touch'], ['standard', 'Standard'], ['deep', 'Explore in depth']].map(([v, l]) => h('option', { value: v, selected: o.depth === v }, l)))),
        dimSel, valuesInput),
      h('div', { class: 'small muted' }, linked.length ? `Covered by: ${linked.map((t) => t.label).join(', ')}` : h('span', { style: { color: 'var(--warn)' } }, 'No topic covers this objective yet.')));
  };

  const drawTopics = () => {
    topicBox.replaceChildren(...g.topics.map((t, i) => topicCard(t, i)), editable ? h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: addTopic }, '+ Add a custom topic')) : null);
  };
  const addTopic = () => {
    const ta = h('textarea', { rows: 2, id: 'nt-q' });
    const name = h('input', { type: 'text', id: 'nt-n' });
    dialog({ title: 'Add a custom topic', body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { for: 'nt-n' }, 'Topic name'), name),
      h('div', { class: 'field' }, h('label', { for: 'nt-q' }, 'Opening question'), h('span', { class: 'hint' }, 'Ask openly. Avoid assuming the answer, for example “How did you find…” rather than “Was the lack of… a problem?”'), ta)),
    actions: [{ label: 'Cancel' }, { label: 'Add topic', kind: 'primary', onClick: () => {
      if (!name.value.trim() || !ta.value.trim()) { toast('Add a name and an opening question.', { kind: 'bad' }); return false; }
      g.topics.splice(Math.max(0, g.topics.length - 1), 0, { id: name.value, label: name.value.trim(), opening: ta.value.trim(), themes: [], kind: 'optional', tier: 'standard', exact: false, followUps: [], objectiveIds: [] });
      drawTopics(); drawObjectives(); changed();
    } }] });
  };
  const topicCard = (t, i) => {
    const move = (d) => { const j = i + d; if (j < 0 || j >= g.topics.length) return; [g.topics[i], g.topics[j]] = [g.topics[j], g.topics[i]]; drawTopics(); changed(); };
    const objChecks = g.objectives.map((o) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', disabled: !editable, checked: t.objectiveIds?.includes(o.id), onchange: (e) => {
      t.objectiveIds = e.target.checked ? [...new Set([...(t.objectiveIds || []), o.id])] : (t.objectiveIds || []).filter((x) => x !== o.id); drawObjectives(); changed();
    } }), o.title || '(untitled objective)'));
    const details = h('details', h('summary', { class: 'small' }, 'Edit wording, follow-ups and links'),
      h('div', { class: 'stack', style: { marginTop: '.6rem' } },
        h('div', { class: 'field', style: { margin: 0 } }, h('label', 'Topic name'), h('input', { type: 'text', value: t.label, disabled: !editable, oninput: (e) => { t.label = e.target.value; changed(); } })),
        h('div', { class: 'field', style: { margin: 0 } }, h('label', 'Opening question'), h('textarea', { rows: 2, disabled: !editable, oninput: (e) => { t.opening = e.target.value; changed(); } }, t.opening)),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: t.exact, disabled: !editable, onchange: (e) => { t.exact = e.target.checked; changed(); } }), 'Ask with this exact wording (otherwise the interviewer adapts it to the conversation)'),
        h('div', { class: 'field', style: { margin: 0 } }, h('label', 'Possible follow-ups, one per line'), h('textarea', { rows: 2, disabled: !editable, oninput: (e) => { t.followUps = e.target.value.split('\n'); changed(); } }, (t.followUps || []).join('\n'))),
        h('div', h('div', { class: 'small', style: { fontWeight: 550 } }, 'Linked objectives'), g.objectives.length ? objChecks : h('span', { class: 'small muted' }, 'No objectives yet.'))));
    return h('div', { class: 'topic' },
      h('div', { class: 'head' }, h('strong', `${i + 1}. ${t.label}`),
        h('span', { class: `badge ${t.kind === 'core' ? 'accent' : ''}` }, t.kind === 'core' ? 'Core' : 'Optional'),
        t.exact ? h('span', { class: 'badge info' }, 'Exact wording') : null,
        (t.objectiveIds || []).length ? h('span', { class: 'badge good' }, `${t.objectiveIds.length} objective${t.objectiveIds.length > 1 ? 's' : ''}`) : null,
        h('span', { class: 'spacer' }),
        editable ? h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Move ${t.label} up`, onclick: () => move(-1) }, '↑') : null,
        editable ? h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Move ${t.label} down`, onclick: () => move(1) }, '↓') : null,
        editable ? h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Remove ${t.label}`, onclick: () => { g.topics.splice(i, 1); drawTopics(); drawObjectives(); changed(); } }, '✕') : null),
      h('div', { class: 'row small', style: { gap: '.5rem' } },
        editable ? h('select', { 'aria-label': `When to ask ${t.label}`, style: { width: 'auto', minHeight: '30px', padding: '.1rem .4rem', fontSize: '.82rem' }, onchange: (e) => { t.tier = e.target.value; changed(); } },
          Object.entries(TIER_LABEL).map(([k, l]) => h('option', { value: k, selected: t.tier === k }, l))) : h('span', { class: 'small muted' }, TIER_LABEL[t.tier]),
        editable ? h('select', { 'aria-label': `Core or optional: ${t.label}`, style: { width: 'auto', minHeight: '30px', padding: '.1rem .4rem', fontSize: '.82rem' }, onchange: (e) => { t.kind = e.target.value; drawTopics(); changed(); } },
          h('option', { value: 'core', selected: t.kind === 'core' }, 'Always ask (core)'), h('option', { value: 'optional', selected: t.kind !== 'core' }, 'If time allows (optional)')) : null),
      h('div', { class: 'small ink2' }, `“${t.opening}”`),
      t.themes?.length ? h('div', { class: 'small muted' }, `Themes: ${t.themes.map(themeLabel).join(', ')}`) : null,
      details);
  };

  const generate = async (btn) => {
    if (!g.objectives.some((o) => o.title.trim())) return toast('Describe at least one thing you want to understand first.', { kind: 'bad' });
    btn.disabled = true; btn.textContent = 'Proposing a plan…';
    try {
      const r = await hr(`/api/hr/programmes/${p.id}/plan`, { method: 'POST', body: { objectives: g.objectives.filter((o) => o.title.trim()) } });
      const before = g.topics.map((t) => t.id);
      dialog({ title: 'Proposed interview plan', wide: true,
        body: h('div', { class: 'stack' },
          h('p', { class: 'ink2' }, `${r.topics.length} topics, ${r.generatedBy === 'model' ? 'proposed by the AI model' : 'proposed by rule-based offline mode'} from your objectives and the ${state.meta.templates[p.template]?.label.toLowerCase()} template. Nothing changes until you accept it, and you can edit everything afterwards.`),
          h('ol', { class: 'small' }, r.topics.map((t) => h('li', h('strong', t.label), before.includes(t.id) ? '' : h('span', { class: 'badge accent', style: { marginLeft: '.4rem' } }, 'new'),
            (t.objectiveIds || []).length ? h('span', { class: 'muted' }, ` · for ${t.objectiveIds.map((id) => g.objectives.find((o) => o.id === id)?.title || id).join('; ')}`) : null))),
          r.analysis.uncovered.length ? h('div', { class: 'notice warn' }, `Not covered: ${r.analysis.uncovered.map((o) => o.title).join('; ')}`) : null),
        actions: [{ label: 'Keep my current guide' }, { label: 'Use this plan', kind: 'primary', onClick: () => { g.topics = r.topics; g.objectives = r.objectives; drawObjectives(); drawTopics(); changed(); } }] });
    } catch (err) { toast(err.message, { kind: 'bad' }); } finally { btn.disabled = false; btn.textContent = 'Propose interview plan'; }
  };

  const estimate = () => {
    const out = {};
    for (const [k, d] of Object.entries(state.meta.durations)) {
      const order = { quick: 0, standard: 1, in_depth: 2 };
      const eligible = g.topics.filter((t) => order[t.tier] <= order[k]);
      out[k] = { count: Math.min(d.maxTopics, eligible.length), of: eligible.length, max: d.maxTopics, minutes: d.minutes, label: d.label };
    }
    return out;
  };

  const drawSide = () => {
    const est = estimate();
    side.replaceChildren(
      h('section', { class: 'card stack' }, h('h3', 'Check the plan'),
        analysis.uncovered.length ? h('div', { class: 'notice warn' }, h('div', h('strong', 'Objectives without topics'), h('ul', { style: { margin: '.3rem 0 0', paddingLeft: '1.1rem' } }, analysis.uncovered.map((o) => h('li', o.title))))) : h('div', { class: 'notice good' }, 'Every objective is covered by at least one topic.'),
        analysis.redundant.length ? h('div', { class: 'notice' }, h('div', h('strong', 'Possible overlap'), h('ul', { style: { margin: '.3rem 0 0', paddingLeft: '1.1rem' } }, analysis.redundant.map((r) => h('li', `${g.topics.find((t) => t.id === r.a)?.label} and ${g.topics.find((t) => t.id === r.b)?.label}: ${r.reason.toLowerCase()}`))))) : null,
        analysis.leading.length ? h('div', { class: 'notice warn' }, h('div', h('strong', 'Possibly leading questions'), h('ul', { style: { margin: '.3rem 0 0', paddingLeft: '1.1rem' } }, analysis.leading.map((l) => h('li', `“${l.opening}”`))))) : null,
        h('div', h('strong', { class: 'small' }, 'What fits each length'), h('ul', { class: 'small', style: { margin: '.3rem 0 0', paddingLeft: '1.1rem' } }, Object.values(est).map((e) => h('li', `${e.label} (${e.minutes} min): up to ${e.count} of ${e.of} eligible topics, highest-priority objectives first`))))),
      p.status !== 'draft' ? h('section', { class: 'card stack' }, h('h3', 'Changes from the active guide'),
        changes.length ? h('ul', { class: 'diff', style: { margin: 0, paddingLeft: '1.1rem' } }, changes.map((c) => h('li', c))) : h('p', { class: 'muted small', style: { margin: 0 } }, 'No changes. Interviews use guide v' + p.activeVersion + '.'),
        changes.length ? h('p', { class: 'small muted', style: { margin: 0 } }, 'Interviews already started keep the version they began with. New interviews use the new version once you activate it.') : null) : null,
      h('section', { class: 'card stack' }, h('h3', 'Live preview'),
        h('p', { class: 'small ink2', style: { margin: 0 } }, 'Run a real interview against this working guide, including unsaved edits. Preview interviews are never included in findings.'),
        previewForm()),
      editable ? h('section', { class: 'card stack' }, h('h3', p.status === 'draft' ? 'Activate' : 'Publish changes'),
        h('div', { class: 'row' }, saveEl),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', disabled: p.status !== 'draft' && !changes.length && p.status !== 'paused', onclick: activate }, p.status === 'draft' ? 'Activate programme' : `Activate as v${(p.activeVersion || 0) + 1}`),
          p.draft ? h('button', { class: 'btn ghost', type: 'button', onclick: discard }, 'Discard changes') : null)) : null);
  };

  const previewForm = () => {
    let mode = 'ai_text', lang = 'en', dur = 'standard', segVal = '';
    const segOptions = [...new Set(g.objectives.filter((o) => o.appliesTo).flatMap((o) => o.appliesTo.values.map((v) => `${o.appliesTo.dimension}=${v}`)))];
    return h('div', { class: 'stack' },
      h('div', { class: 'grid g2' },
        h('label', { class: 'small' }, 'Format', h('select', { onchange: (e) => { mode = e.target.value; } }, h('option', { value: 'ai_text' }, 'Text'), h('option', { value: 'ai_voice' }, 'Voice'))),
        h('label', { class: 'small' }, 'Language', h('select', { onchange: (e) => { lang = e.target.value; } }, state.meta.languages.map((l) => h('option', { value: l.code }, l.label)))),
        h('label', { class: 'small' }, 'Length', h('select', { onchange: (e) => { dur = e.target.value; } }, Object.entries(state.meta.durations).map(([k, d]) => h('option', { value: k, selected: k === 'standard' }, d.label)))),
        segOptions.length ? h('label', { class: 'small' }, 'Preview as', h('select', { onchange: (e) => { segVal = e.target.value; } }, h('option', { value: '' }, 'Anyone'), segOptions.map((s) => h('option', { value: s }, s.split('=')[1])))) : null),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const segment = segVal ? { [segVal.split('=')[0]]: segVal.split('=')[1] } : null;
          const r = await hr(`/api/hr/programmes/${p.id}/preview`, { method: 'POST', body: { guide: { objectives: g.objectives.filter((o) => o.title.trim()), topics: g.topics }, mode, language: lang, duration: dur, segment } });
          window.open(`/interview/#/s/${r.id}?t=${r.accessToken}`, '_blank', 'noopener');
        } catch (err) { toast(err.message, { kind: 'bad' }); } finally { btn.disabled = false; }
      } }, 'Open live preview'));
  };

  const activate = async () => {
    if (saveState !== 'saved') await save();
    if (saveState === 'error') return;
    const go2 = async (ack) => {
      try {
        const r = await hr(`/api/hr/programmes/${p.id}/activate`, { method: 'POST', body: { acknowledgeGaps: ack } });
        await refreshProgrammes();
        toast(`Guide v${r.version} is active. New interviews will use it.`);
        go(`#/programmes/${p.id}/overview`);
      } catch (err) {
        if (err.status === 409 && err.details?.uncovered) {
          if (await confirmDialog('Some objectives have no topics', `${err.details.uncovered.map((o) => `“${o.title}”`).join(', ')} will not be explored in interviews, so findings for them will show as having no evidence. Activate anyway?`, { confirmLabel: 'Activate anyway' })) go2(true);
        } else toast(err.message, { kind: 'bad' });
      }
    };
    go2(false);
  };
  const discard = async () => {
    if (!(await confirmDialog('Discard the unpublished changes?', `The guide goes back to the active version (v${p.activeVersion}).`, { confirmLabel: 'Discard', kind: 'danger' }))) return;
    await hr(`/api/hr/programmes/${p.id}/discard-draft`, { method: 'POST' });
    await refreshProgrammes();
    go(`#/programmes/${p.id}/guide?d=${Date.now()}`);
  };

  drawObjectives(); drawTopics(); drawSide();
  const genBtn = h('button', { class: 'btn primary', type: 'button', onclick: (e) => generate(e.currentTarget) }, 'Propose interview plan');
  mount(el, h('div', { class: 'split' },
    h('div', { class: 'stack', style: { gap: '1.5rem' } },
      !editable ? h('div', { class: 'notice' }, p.status === 'archived' ? 'This programme is archived, so its guide is read-only.' : 'Your role can view the guide but not change it.') : null,
      p.draft ? h('div', { class: 'notice warn' }, `You are editing a draft. Interviews keep using guide v${p.activeVersion} until you activate the changes.`) : null,
      h('section', { class: 'stack', 'aria-labelledby': 'obj-h' },
        h('div', h('h2', { id: 'obj-h', style: { marginBottom: '.2rem' } }, '1. What do you want to learn?'),
          h('p', { class: 'ink2 small', style: { margin: 0 } }, 'Start with your learning objectives. PartWays proposes topics to cover them, and findings are reported against each objective.')),
        objBox, editable ? h('div', genBtn) : null),
      h('section', { class: 'stack', 'aria-labelledby': 'top-h' },
        h('div', h('h2', { id: 'top-h', style: { marginBottom: '.2rem' } }, '2. Interview guide'),
          h('p', { class: 'ink2 small', style: { margin: 0 } }, 'Topics the interviewer covers, in order. Core topics are always included; optional topics are used when time allows. Employees can skip any topic.')),
        topicBox)),
    side));
  if (query.highlight) setTimeout(() => document.getElementById(`obj-${query.highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}

// --- Settings ---------------------------------------------------------------

function settings(el, p) {
  const f = structuredClone(p);
  const checks = (label, all, sel, key) => h('fieldset', { class: 'field', style: { border: 0, padding: 0 } }, h('legend', { style: { fontWeight: 550, fontSize: '.9rem' } }, label),
    h('div', { class: 'row' }, all.map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sel.includes(v), onchange: (e) => { f[key] = e.target.checked ? [...f[key], v] : f[key].filter((x) => x !== v); } }), l))));
  const ta = (label, key, hint, rows = 3) => h('div', { class: 'field' }, h('label', label), hint ? h('span', { class: 'hint' }, hint) : null, h('textarea', { rows, oninput: (e) => { f[key] = e.target.value; } }, f[key] || ''));
  const msgPreview = h('div', { class: 'whatsapp' });
  const updPreview = () => {
    msgPreview.textContent = (f.messages.invitation || '').replaceAll(' {firstName}', '').replaceAll('{interviewId}', 'PW-7KQ2-M4XD').replaceAll('{org}', state.org.shortName).replaceAll('{minutes}', '10–15').replaceAll('{deadline}', '10 November').replaceAll('{link}', 'https://partways.example/i/…');
  };
  updPreview();
  mount(el, h('form', { class: 'stack', style: { maxWidth: '860px', gap: '1.25rem' }, onsubmit: async (e) => {
    e.preventDefault();
    try {
      await hr(`/api/hr/programmes/${p.id}/settings`, { method: 'PUT', body: { name: f.name, description: f.description, intro: f.intro, completionMessage: f.completionMessage, followUpWording: f.followUpWording, feedbackNotice: f.feedbackNotice, languages: f.languages, modes: f.modes, durations: f.durations, reportingMode: f.reportingMode, reportingMinimum: f.reportingMinimum, reminder: f.reminder, messages: f.messages } });
      await refreshProgrammes();
      toast('Settings saved.');
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  } },
  h('section', { class: 'card' }, h('h3', 'About'),
    h('div', { class: 'field' }, h('label', 'Name'), h('input', { type: 'text', value: f.name, oninput: (e) => { f.name = e.target.value; } })),
    ta('Description (internal)', 'description', null, 2),
    ta('Invitation page introduction', 'intro', 'Shown to employees on the invitation page.'),
    ta('How feedback is used', 'feedbackNotice', 'Plain-language notice shown before the interview.'),
    ta('Completion message', 'completionMessage', null, 2),
    ta('Follow-up wording', 'followUpWording', 'Explains what happens if the employee asks to be contacted.', 2)),
  h('section', { class: 'card' }, h('h3', 'Interview options'),
    checks('Formats offered', Object.entries(MODE_LABEL), f.modes, 'modes'),
    checks('Languages', state.meta.languages.map((l) => [l.code, l.label]), f.languages, 'languages'),
    checks('Lengths', Object.entries(state.meta.durations).map(([k, d]) => [k, `${d.label} (${d.minutes} min)`]), f.durations, 'durations'),
    h('p', { class: 'small muted', style: { margin: 0 } }, 'Employees choose to talk or type with the PartWays AI interviewer, and can switch at any time.')),
  h('section', { class: 'card' }, h('h3', 'Reporting'),
    h('div', { class: 'field' }, h('label', 'Reporting mode'),
      h('select', { onchange: (e) => { f.reportingMode = e.target.value; } }, h('option', { value: 'individual', selected: f.reportingMode === 'individual' }, 'Individual evidence allowed (quotes and paraphrases shown to authorised users)'), h('option', { value: 'aggregate', selected: f.reportingMode === 'aggregate' }, 'Aggregate only (counts and themes, no individual quotes)'))),
    h('div', { class: 'field' }, h('label', 'Reporting minimum'), h('span', { class: 'hint' }, 'Results for any group with fewer submitted responses are hidden. Between 3 and 50.'),
      h('input', { type: 'number', min: 3, max: 50, value: f.reportingMinimum, style: { maxWidth: '8rem' }, oninput: (e) => { f.reportingMinimum = Number(e.target.value); } }))),
  h('section', { class: 'card' }, h('h3', 'WhatsApp messages'),
    h('p', { class: 'small muted' }, 'Placeholders: {org} {minutes} {deadline} {link} {interviewId}. Messages do not use names. Until WhatsApp is connected, messages are recorded but not delivered.'),
    h('div', { class: 'grid g2' },
      h('div', h('div', { class: 'field' }, h('label', 'Invitation'), h('textarea', { rows: 6, oninput: (e) => { f.messages.invitation = e.target.value; updPreview(); } }, f.messages.invitation)),
        h('div', { class: 'field' }, h('label', 'Reminder'), h('textarea', { rows: 4, oninput: (e) => { f.messages.reminder = e.target.value; } }, f.messages.reminder))),
      h('div', h('div', { class: 'small muted', style: { marginBottom: '.4rem' } }, 'Preview'), msgPreview)),
    h('div', { class: 'row' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.reminder?.enabled, onchange: (e) => { f.reminder = { ...f.reminder, enabled: e.target.checked }; } }), 'Send reminders'),
      h('label', { class: 'small' }, 'after ', h('input', { type: 'number', min: 1, max: 14, value: f.reminder?.afterDays, style: { width: '5rem' }, oninput: (e) => { f.reminder = { ...f.reminder, afterDays: Number(e.target.value) }; } }), ' days'),
      h('label', { class: 'small' }, 'at most ', h('input', { type: 'number', min: 0, max: 3, value: f.reminder?.max, style: { width: '5rem' }, oninput: (e) => { f.reminder = { ...f.reminder, max: Number(e.target.value) }; } }), ' times'))),
  h('div', h('button', { class: 'btn primary', type: 'submit' }, 'Save settings'))));
}

export { STATUS_LABEL };
