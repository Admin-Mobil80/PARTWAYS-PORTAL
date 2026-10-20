// Insights: one set of numbers (from the server's computeInsights) behind the narrative,
// charts, tables, theme pages, assistant, reports and exports.
import { h, mount, fmt, toast, dialog, store, tooltip } from '../lib.js';
import { state, hr, can, go, pageHead, loading, errorBox, download, MODE_LABEL, refreshThemes } from './core.js';
import { setCrumbs } from './app.js';
import { chartCard, table, bars, pairBars, toneBar, toneLegend, TONE, ofN } from './charts.js';

const DIMS = [['businessUnit', 'Business unit'], ['function', 'Function'], ['location', 'Location'], ['tenureBand', 'Tenure band'], ['roleLevel', 'Role level'], ['language', 'Interview language'], ['mode', 'Interview format']];
const STATUS_BADGE = { supported: ['good', 'Supported by evidence'], emerging: ['warn', 'Emerging'], insufficient: ['', 'Not enough evidence'] };
const PREVENT = { yes: 'Yes', maybe: 'Possibly', no: 'No', unsure: 'Not sure', not_discussed: 'Not discussed' };

// The selection is remembered per workspace. An organisation's own workspace starts on its live interviews this quarter.
const queryKey = () => `pw.hr.insq.${state.workspace}`;
export function getQuery() {
  const now = new Date();
  const base = state.org?.demo
    ? { programmeId: 'prog_general', period: '2026-Q3', population: 'demo' }
    : { programmeId: state.programmes.find((p) => p.activeVersion)?.id || 'all', period: `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`, population: 'live' };
  return { ...base, basis: 'submission', filters: {}, ...store.get(queryKey(), {}) };
}
export function setQuery(q) { store.set(queryKey(), q); }

export function scopeLine(ins) {
  const s = ins.scope;
  return h('div', { class: 'row small ink2', style: { gap: '.4rem' } },
    h('strong', s.programmes.map((p) => p.name).join(', ') || 'No programme'), h('span', '·'), h('span', s.periodLabel), h('span', '·'), h('span', s.basisLabel), h('span', '·'), h('span', `${ins.current.n} submitted response${ins.current.n === 1 ? '' : 's'}`),
    Object.keys(s.filters).length ? [h('span', '·'), `Filtered: ${Object.entries(s.filters).map(([k, v]) => `${DIMS.find((d) => d[0] === k)?.[1] || k} = ${v.join(', ')}`).join('; ')}`] : null,
    s.population === 'demo' ? h('span', { class: 'badge demo' }, 'Fictional demonstration data') : s.population === 'evaluation' ? h('span', { class: 'badge info' }, 'Evaluation interviews only') : s.population === 'all' ? h('span', { class: 'badge info' }, 'Demonstration and evaluation data') : null,
    s.reportingMode === 'aggregate' ? h('span', { class: 'badge' }, 'Aggregate reporting: no individual quotes') : null);
}

function filterBar(q, ins, onChange) {
  const sel = (label, value, opts, set) => h('label', label, h('select', { onchange: (e) => { set(e.target.value); onChange(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(value) === String(v) }, l))));
  const periods = ins?.periods || ['2026-Q4', '2026-Q3', '2026-Q2'];
  const qLabel = (p) => `Q${p.slice(-1)} ${p.slice(0, 4)}${p === periods[0] ? ' (in progress)' : ''}`;
  const groups = ins?.segments || {};
  let dim = '';
  const valSel = h('select', { 'aria-label': 'Segment value', disabled: true, onchange: (e) => { if (!e.target.value) return; q.filters = { ...q.filters, [dim]: [...new Set([...(q.filters[dim] || []), e.target.value])] }; onChange(); } }, h('option', '–'));
  const valuesFor = (d) => {
    if (d === 'language') return ['en', 'de', 'fr'];
    if (d === 'mode') return Object.keys(MODE_LABEL);
    return (groups[d]?.groups || []).map((g) => g.value);
  };
  const dimSel = h('select', { 'aria-label': 'Add a segment filter', onchange: (e) => {
    dim = e.target.value;
    valSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...valuesFor(dim).map((v) => h('option', { value: v }, dim === 'mode' ? MODE_LABEL[v] : dim === 'language' ? v.toUpperCase() : v)));
    valSel.disabled = !dim;
  } }, h('option', { value: '' }, 'Add a filter…'), DIMS.map(([k, l]) => h('option', { value: k }, l)));
  const progs = state.programmes.filter((p) => p.activeVersion);
  return h('div', { class: 'stack', style: { gap: '.5rem', marginBottom: '1rem' } },
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Data selection', style: { marginBottom: 0 } },
      sel('Programme', q.programmeId, [['all', 'All programmes'], ...progs.map((p) => [p.id, p.name])], (v) => { q.programmeId = v; }),
      sel('Period', q.period, periods.map((p) => [p, qLabel(p)]), (v) => { q.period = v; q.compareTo = undefined; }),
      sel('Compare with', q.compareTo === null ? 'none' : q.compareTo || 'prev', [['prev', 'Previous quarter'], ['none', 'No comparison'], ...periods.filter((p) => p < q.period).map((p) => [p, qLabel(p)])], (v) => { q.compareTo = v === 'none' ? null : v === 'prev' ? undefined : v; }),
      sel('Period based on', q.basis, [['submission', 'When feedback was submitted'], ['departure', 'Leaving date'], ['invitation', 'When invited']], (v) => { q.basis = v; }),
      state.org.demo ? sel('Data', q.population, [['demo', 'Demonstration data'], ['evaluation', 'Your evaluation interviews'], ['all', 'Both']], (v) => { q.population = v; }) : null,
      h('label', 'Segment', h('span', { class: 'row', style: { gap: '.3rem' } }, dimSel, valSel))),
    Object.keys(q.filters).length ? h('div', { class: 'active-filters', 'aria-label': 'Active filters' }, Object.entries(q.filters).flatMap(([k, vals]) => vals.map((v) => h('span', { class: 'fchip' },
      `${DIMS.find((d) => d[0] === k)?.[1]}: ${k === 'mode' ? MODE_LABEL[v] : v}`, h('button', { type: 'button', 'aria-label': `Remove filter ${v}`, onclick: () => { const rest = q.filters[k].filter((x) => x !== v); q.filters = { ...q.filters }; if (rest.length) q.filters[k] = rest; else delete q.filters[k]; onChange(); } }, '×')))),
    h('button', { class: 'linkbtn small', type: 'button', onclick: () => { q.filters = {}; onChange(); } }, 'Clear filters')) : null);
}

function refLink(ref) {
  if (ref.type === 'theme' || (ref.type === 'segment' && ref.id) || ref.type === 'comparison') return ref.id ? h('a', { class: 'ref', href: `#/insights/theme/${ref.id}` }, 'View evidence') : null;
  if (ref.type === 'objective') return h('a', { class: 'ref', href: '#/insights?tab=objectives' }, 'View objective');
  return null;
}

function narrative(ins) {
  const n = ins.narrative;
  const block = (title, items) => (items?.length ? h('div', { class: 'stack', style: { gap: '.35rem' } }, h('h4', { style: { margin: 0 } }, title),
    items.map((x) => h('p', { class: x.caveat ? 'small muted' : '' }, x.text, ...(x.refs || []).slice(0, 1).map(refLink)))) : null);
  return h('section', { class: 'card narr', 'aria-labelledby': 'nar-h' }, h('h3', { id: 'nar-h' }, 'Summary'),
    block('What we are hearing', n.hearing), block('What has changed', n.changed), block('What deserves attention', n.attention), block('What is working', n.working),
    h('p', { class: 'small muted' }, 'Generated from submitted, employee-reviewed feedback. Every statement links to its evidence. Results describe the people who responded and are not a measure of all turnover.'));
}

export function reasonsChart(ins) {
  const c = ins.current;
  const rows = Object.values(c.themes).filter((t) => t.confirmedReason).sort((a, b) => b.confirmedReason - a.confirmedReason);
  return chartCard({
    title: 'Confirmed reasons for leaving', sub: `Share of ${c.n} respondents who confirmed each as a reason in their own review`,
    chart: bars(rows.map((t) => ({ label: t.label, share: t.reasonShare, value: `${t.confirmedReason} (${fmt.pct(t.reasonShare)})`, tip: `${t.label}: confirmed by ${t.confirmedReason} of ${c.n}; main reason for ${t.primary}. ${t.suggestedOnly ? `${t.suggestedOnly} more mentioned it without confirming it as a reason.` : ''}`, onClick: () => go(`#/insights/theme/${t.id}`) })), { max: 1 }),
    table: table(['Reason', 'Confirmed as a reason', 'Main reason', 'Mentioned, not confirmed', 'Pull factor'], rows.map((t) => [t.label, ofN(t.confirmedReason, c.n), t.primary, t.suggestedOnly, t.pull]), { numeric: [1, 2, 3, 4] }),
    note: c.noSingleMainReason ? `${c.noSingleMainReason} respondent(s) said there was no single main reason. People can confirm more than one reason, so shares add up to more than 100%.` : 'People can confirm more than one reason, so shares add up to more than 100%.',
  });
}

export function comparisonChart(ins) {
  const cmp = ins.comparison;
  if (!cmp) return null;
  if (!cmp.available) return h('section', { class: 'card' }, h('h3', 'Change from the comparison period'), h('div', { class: 'unavailable' }, `A comparison with ${cmp.periodLabel} is not available: it has ${cmp.n} submitted responses and the reporting minimum is ${ins.current.minimum}.`));
  const rows = cmp.rows.filter((r) => r.now || r.prev).slice(0, 10);
  const lbl = [ins.current.periodLabel.split(' (')[0], cmp.periodLabel.split(' (')[0]];
  return chartCard({
    title: 'Change from the comparison period', sub: `Share of respondents raising each theme. ${lbl[0]}: ${ins.current.n} responses; ${lbl[1]}: ${cmp.n} responses.`,
    chart: pairBars(rows.map((r) => ({ label: r.label, a: r.nowShare, b: r.prevShare, value: r.ppChange == null ? '–' : fmt.pp(r.ppChange), tip: `${r.label}. ${lbl[0]}: ${r.now} of ${ins.current.n} (${fmt.pct(r.nowShare)}). ${lbl[1]}: ${r.prev} of ${cmp.n} (${fmt.pct(r.prevShare)}). Change ${fmt.pp(r.ppChange)}.`, onClick: () => go(`#/insights/theme/${r.id}`) })), { labels: lbl }),
    table: table(['Theme', lbl[0], lbl[1], 'Change'], rows.map((r) => [r.label, ofN(r.now, ins.current.n), ofN(r.prev, cmp.n), fmt.pp(r.ppChange)]), { numeric: [1, 2, 3] }),
    note: ['Change is in percentage points (pp) of respondents in each period, not a count of people.', ...(cmp.compositionNote || [])].join(' '),
  });
}

function themesTable(ins) {
  const c = ins.current;
  const rows = Object.values(c.themes).filter((t) => t.respondents).sort((a, b) => b.respondents - a.respondents);
  return h('section', { class: 'card stack' },
    h('div', { class: 'chart-head' }, h('div', h('h3', 'All themes'), h('div', { class: 'small muted' }, 'Each respondent counts once per theme, however often they mentioned it. Tone shows how respondents spoke about it.')), toneLegend()),
    h('div', { class: 'table-wrap' }, h('table',
      h('thead', h('tr', h('th', 'Theme'), h('th', { class: 'num' }, 'Respondents'), h('th', { class: 'num' }, 'Confirmed reason'), h('th', { class: 'num' }, 'Mentions'), h('th', { style: { minWidth: '160px' } }, 'Tone'))),
      h('tbody', rows.map((t) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => go(`#/insights/theme/${t.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`#/insights/theme/${t.id}`); } },
        h('td', h('a', { href: `#/insights/theme/${t.id}`, onclick: (e) => e.stopPropagation() }, t.label)), h('td', { class: 'num' }, ofN(t.respondents, c.n)), h('td', { class: 'num' }, t.confirmedReason), h('td', { class: 'num' }, t.mentions),
        h('td', toneBar(t.tone, t.label))))))));
}

function segmentsView(ins) {
  let dim = 'businessUnit';
  const box = h('div');
  const draw = () => {
    const seg = ins.segments[dim];
    const themes = Object.values(ins.current.themes).filter((t) => t.respondents).sort((a, b) => b.respondents - a.respondents).slice(0, 6);
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table',
      h('thead', h('tr', h('th', seg.label), h('th', { class: 'num' }, 'Responses'), themes.map((t) => h('th', { class: 'num', style: { maxWidth: '120px' } }, t.label)))),
      h('tbody', seg.groups.map((g) => h('tr', h('td', g.value), h('td', { class: 'num' }, g.n),
        g.available ? themes.map((t) => {
          const x = g.themes[t.id];
          const td = h('td', { class: 'num', tabindex: '0', style: { background: x ? `color-mix(in srgb, var(--series-1) ${Math.round((x.share || 0) * 55)}%, transparent)` : null } }, x ? `${x.respondents} (${fmt.pct(x.share)})` : '0');
          tooltip(td, `${g.value}: ${x?.respondents || 0} of ${g.n} raised ${t.label.toLowerCase()} (${fmt.pct(x?.share || 0)}), against ${fmt.pct(t.share)} overall.`);
          return td;
        }) : h('td', { colspan: themes.length, class: 'small muted' }, `Not shown: fewer than ${ins.current.minimum} responses`)))))));
  };
  draw();
  return h('section', { class: 'card stack' },
    h('div', { class: 'chart-head' }, h('div', h('h3', 'Themes by segment'), h('div', { class: 'small muted' }, 'Share of respondents in each group raising the theme. Darker cells mean a higher share.')),
      h('select', { 'aria-label': 'Segment by', style: { width: 'auto' }, onchange: (e) => { dim = e.target.value; draw(); } }, Object.entries(ins.segments).map(([k, s]) => h('option', { value: k }, s.label)))),
    box, h('p', { class: 'small muted', style: { margin: 0 } }, 'Small groups are hidden to protect the people in them. Differences between groups describe who responded and may reflect group size.'));
}

export function evidenceItem(e, { showSummary = true } = {}) {
  const kindLabel = { quote: 'Quote', translated_quote: 'Translated quote', paraphrase: 'Paraphrase' }[e.kind] || 'Paraphrase';
  return h('div', { class: 'evidence-item' },
    h('div', { class: 'row small muted', style: { gap: '.4rem' } }, h('span', { class: 'tone-dot', style: { background: TONE.find(([k]) => k === e.tone)?.[2] } }), fmt.title(e.tone), '·', e.section, '·', e.respondent, e.mentions > 1 ? ` · raised ${e.mentions} times` : '', e.similar ? h('span', { class: 'badge' }, `${e.similar} other respondent${e.similar > 1 ? 's' : ''} gave the same account`) : null),
    e.kind === 'paraphrase' || !e.text ? h('p', { style: { margin: 0 } }, e.summary, ' ', h('span', { class: 'badge' }, 'Paraphrase'))
      : h('div', { class: 'quote' }, h('div', { class: 'kind' }, kindLabel, e.lang !== 'en' ? ` · original in ${e.lang.toUpperCase()}` : ''), h('p', { style: { margin: '.2rem 0' } }, `“${e.text}”`),
        e.translation ? h('p', { class: 'small ink2', style: { margin: 0 } }, `English: “${e.translation}”`) : e.lang !== 'en' && showSummary ? h('p', { class: 'small ink2', style: { margin: 0 } }, `In English (summary): ${e.summary}`) : null));
}

function objectivesView(ins) {
  if (!ins.objectives.length) return h('div', { class: 'empty' }, h('h3', 'No learning objectives'), h('p', 'This programme does not have learning objectives yet.'));
  return h('div', { class: 'stack' }, ins.objectives.map((o) => {
    const [kind, label] = STATUS_BADGE[o.status] || ['', o.status];
    const c = o.counts;
    return h('section', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, o.title), h('span', { class: `badge ${kind}` }, label)),
      ins.scope.programmes.length > 1 ? h('div', { class: 'small muted' }, o.programmeName) : null,
      h('p', { style: { margin: 0 } }, o.heard),
      h('div', { class: 'small ink2' }, `Addressed by ${o.addressed} of ${o.total} respondents: ${c.explored} explored, ${c.insufficient} touched on, ${c.skipped} skipped, ${c.declined} declined, ${c.not_asked} not asked${c.not_applicable ? `, ${c.not_applicable} not applicable` : ''}${c.not_in_guide ? `, ${c.not_in_guide} interviewed before this objective was added` : ''}.`),
      o.themes.length ? bars(o.themes.map((t) => ({ label: t.label, share: o.addressed ? t.n / o.addressed : 0, value: `${t.n} of ${o.addressed}`, tip: `${t.label}: ${t.n} of ${o.addressed} who addressed this objective${t.measure ? ` (${t.measure})` : ''}.${t.tone ? ` Tone: ${TONE.map(([k, l]) => `${l} ${t.tone[k]}`).join(', ')}` : ''}`, onClick: () => go(`#/insights/theme/${t.id}`) })), { max: 1 }) : null,
      o.unclear.length ? h('div', { class: 'notice' }, h('div', h('strong', 'What remains unclear'), h('ul', { style: { margin: '.3rem 0 0', paddingLeft: '1.1rem' } }, o.unclear.map((u) => h('li', u))))) : null,
      o.evidence?.length ? h('details', h('summary', `Supporting evidence (${o.evidence.length})`), o.evidence.map((e) => evidenceItem(e))) : ins.scope.reportingMode === 'aggregate' ? h('p', { class: 'small muted', style: { margin: 0 } }, 'This programme uses aggregate reporting, so individual evidence is not shown.') : null);
  }));
}

function participationView(ins) {
  const c = ins.current, p = c.participation;
  const stat = (k, v, s) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null);
  const modes = Object.keys(MODE_LABEL);
  return h('div', { class: 'stack', style: { gap: '1rem' } },
    h('div', { class: 'stats' }, stat('Invited in period', p.eligible), stat('Started', p.started, `${fmt.pct(p.participationRate)} of invited`), stat('Submitted', p.submitted, `${fmt.pct(p.submissionRate)} of invited`), stat('Submitted after starting', fmt.pct(p.completionAfterStart))),
    h('div', { class: 'grid g2' },
      chartCard({ title: 'Where people are', sub: 'Current status of everyone invited in the period',
        chart: bars(Object.entries(p.statusCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: fmt.title(k), share: p.eligible ? v / p.eligible : 0, value: `${v}`, tip: `${fmt.title(k)}: ${v} of ${p.eligible}` }))),
        table: table(['Status', 'People'], Object.entries(p.statusCounts).map(([k, v]) => [fmt.title(k), v]), { numeric: [1] }) }),
      c.available ? chartCard({ title: 'Interview formats', sub: 'Format chosen first, and formats used (some people switched)',
        chart: pairBars(modes.map((m) => ({ label: MODE_LABEL[m], a: c.n ? (c.modeMix.initial[m] || 0) / c.n : 0, b: c.n ? (c.modeMix.used[m] || 0) / c.n : 0, value: `${c.modeMix.initial[m] || 0} / ${c.modeMix.used[m] || 0}`, tip: `${MODE_LABEL[m]}: chosen first by ${c.modeMix.initial[m] || 0}, used by ${c.modeMix.used[m] || 0} of ${c.n}. Average active time ${c.durationMinutes?.[m] ? `${Math.round(c.durationMinutes[m])} min` : '–'}.` })), { labels: ['Chosen first', 'Used at any point'] }),
        table: table(['Format', 'Chosen first', 'Used', 'Average active minutes'], modes.map((m) => [MODE_LABEL[m], c.modeMix.initial[m] || 0, c.modeMix.used[m] || 0, c.durationMinutes?.[m] ? Math.round(c.durationMinutes[m]) : '–']), { numeric: [1, 2, 3] }) }) : null),
    c.available ? h('div', { class: 'grid g2' },
      chartCard({ title: 'Could anything have changed the decision?', sub: 'As confirmed by employees in their review',
        chart: bars(Object.entries(c.preventability).map(([k, v]) => ({ label: PREVENT[k], share: c.n ? v / c.n : 0, value: `${v} (${fmt.pct(c.n ? v / c.n : 0)})` })), { max: 1 }),
        table: table(['Answer', 'Respondents'], Object.entries(c.preventability).map(([k, v]) => [PREVENT[k], ofN(v, c.n)]), { numeric: [1] }) }),
      h('section', { class: 'card stack' }, h('h3', 'Interview experience'), h('p', { class: 'small muted', style: { margin: 0 } }, 'Optional ratings of PartWays itself, collected separately from feedback about the organisation.'),
        c.experience ? h('dl', { class: 'kv' }, ...Object.entries({ ease: 'Easy to use', heard: 'Felt heard', accuracy: 'Summary was accurate' }).flatMap(([k, l]) => [h('dt', l), h('dd', c.experience[k]?.n ? `${c.experience[k].average.toFixed(1)} out of 5 (${c.experience[k].n} ratings)` : 'No ratings')])) : null)) : null);
}

export async function render(el, params, query = {}) {
  setCrumbs('Insights');
  const q = getQuery();
  if (query.programmeId) { q.programmeId = query.programmeId; setQuery(q); }
  let tab = query.tab || store.get('pw.hr.instab', 'overview');
  const head = pageHead('Insights', 'What departing employees confirmed after reviewing their own summaries.',
    h('button', { class: 'btn sm', onclick: () => download('/api/hr/insights/export', 'partways-findings.csv', { method: 'POST', body: { query: getQuery() } }).catch((e) => toast(e.message, { kind: 'bad' })) }, 'Export CSV'),
    can('reports') ? h('button', { class: 'btn sm', onclick: () => newReportDialog(getQuery()) }, 'Create report') : null,
    can('assistant') ? h('a', { class: 'btn sm primary', href: '#/assistant' }, 'Ask a question') : null);
  const filtersBox = h('div');
  const body = h('div');
  mount(el, head, filtersBox, body);
  const load = async () => {
    const cur = getQuery();
    body.replaceChildren(loading('Loading findings'));
    let ins;
    try { ins = await hr('/api/hr/insights', { method: 'POST', body: { query: cur } }); } catch (err) { body.replaceChildren(errorBox(err, load)); return; }
    filtersBox.replaceChildren(filterBar(cur, ins, () => { setQuery(cur); load(); }));
    const tabs = [['overview', 'Overview'], ['themes', 'Themes'], ['segments', 'Segments'], ['objectives', 'Objectives'], ['participation', 'Participation']];
    const content = h('div');
    const draw = () => {
      store.set('pw.hr.instab', tab);
      tabBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === tab)));
      if (!ins.current.available && tab !== 'participation') {
        content.replaceChildren(h('div', { class: 'unavailable', role: 'status' }, h('strong', 'Not enough responses to show findings.'), h('p', { style: { margin: '.3rem 0 0' } }, `This selection has ${ins.current.n} submitted response${ins.current.n === 1 ? '' : 's'}. Findings are shown from ${ins.current.minimum} responses, so that no one can be identified. Try a longer period, fewer filters, or a different programme. Participation figures are still available.`)));
        return;
      }
      if (tab === 'overview') content.replaceChildren(h('div', { class: 'stack', style: { gap: '1rem' } }, narrative(ins), h('div', { class: 'grid g2' }, reasonsChart(ins), comparisonChart(ins))));
      else if (tab === 'themes') content.replaceChildren(themesTable(ins));
      else if (tab === 'segments') content.replaceChildren(segmentsView(ins));
      else if (tab === 'objectives') content.replaceChildren(objectivesView(ins));
      else content.replaceChildren(participationView(ins));
    };
    const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', 'data-k': k, type: 'button', onclick: () => { tab = k; draw(); } }, l)));
    body.replaceChildren(h('div', { class: 'stack', style: { gap: '.75rem' } }, scopeLine(ins), tabBar, content));
    draw();
  };
  load();
}

// --- Theme detail -------------------------------------------------------------

export async function renderTheme(el, [themeId]) {
  const q = getQuery();
  mount(el, loading());
  let d;
  try { d = await hr('/api/hr/insights/theme', { method: 'POST', body: { query: q, themeId } }); } catch (err) { return mount(el, errorBox(err, () => renderTheme(el, [themeId]))); }
  const t = d.theme;
  setCrumbs(['Insights', '#/insights'], t.label);
  if (!d.available) {
    return mount(el, pageHead(t.label, t.description), h('div', { class: 'unavailable' }, `Not enough responses in this selection (${d.n}) to show this theme.`));
  }
  const n = d.n;
  const ev = d.evidence;
  const evBox = (title, list) => (list?.length ? h('section', { class: 'card' }, h('h3', title), list.map((e) => evidenceItem(e))) : null);
  mount(el,
    pageHead(t.label, t.description,
      h('button', { class: 'btn sm', onclick: () => bookmark(t, q) }, 'Bookmark'),
      can('reports') ? h('button', { class: 'btn sm', onclick: () => newReportDialog(q, t.id) }, 'Investigate in a report') : null,
      can('actions') ? h('button', { class: 'btn sm primary', onclick: () => createActionDialog({ themes: [t.id], programmeId: q.programmeId === 'all' ? null : q.programmeId, evidence: { kind: 'theme', themeId: t.id, text: `${t.label}: raised by ${t.respondents} of ${n} respondents (${fmt.pct(t.share)}) in ${d.scope.periodLabel}.`, scope: d.scope } }) }, 'Create action') : null),
    h('div', { class: 'stack', style: { gap: '1rem' } },
      scopeLine({ scope: d.scope, current: { n } }),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Respondents raising it'), h('div', { class: 'v' }, t.respondents), h('div', { class: 's' }, `${fmt.pct(t.share)} of ${n}`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Confirmed as a reason'), h('div', { class: 'v' }, t.confirmedReason), h('div', { class: 's' }, `main reason for ${t.primary}`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Mentioned, not confirmed'), h('div', { class: 'v' }, t.suggestedOnly), h('div', { class: 's' }, 'not counted as a reason')),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Mentions'), h('div', { class: 'v' }, t.mentions), h('div', { class: 's' }, 'repeat mentions by one person count once above'))),
      h('div', { class: 'grid g2' },
        h('section', { class: 'card stack' }, h('div', { class: 'chart-head' }, h('h3', 'How people spoke about it'), toneLegend()), toneBar(t.tone, t.label),
          table(['Tone', 'Respondents'], TONE.map(([k, l]) => [l, t.tone[k] || 0]), { numeric: [1] }),
          Object.keys(t.subthemes || {}).length ? h('div', h('h4', 'Sub-themes'), bars(Object.entries(t.subthemes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, share: v / t.respondents, value: `${v}`, tip: `${k}: ${v} of ${t.respondents} who raised the theme` })), { max: 1 })) : null),
        chartCard({ title: 'Over time', sub: 'Share of respondents raising it, by quarter',
          chart: bars(d.trend.map((p) => ({ label: p.label.split(' (')[0], share: p.available ? p.share : 0, value: p.available ? `${p.respondents} of ${p.n} (${fmt.pct(p.share)})` : `Fewer than ${d.scope.minimum}`, tip: p.available ? `${p.label}: ${p.respondents} of ${p.n}` : `${p.label}: not enough responses` })), { max: 1 }),
          table: table(['Quarter', 'Respondents', 'Responses', 'Share'], d.trend.map((p) => [p.label, p.available ? p.respondents : '–', p.n, p.available ? fmt.pct(p.share) : 'Not shown']), { numeric: [1, 2, 3] }) })),
      h('section', { class: 'card stack' }, h('h3', 'Where it appears'),
        h('div', { class: 'grid g2' }, Object.entries(d.segments).map(([k, s]) => h('div', h('h4', s.label),
          bars(s.groups.map((g) => ({ label: g.value, share: g.available ? g.share : 0, value: g.available ? `${g.respondents} of ${g.n}` : `Fewer than ${d.scope.minimum}`, tip: g.available ? `${g.value}: ${g.respondents} of ${g.n} (${fmt.pct(g.share)})` : `${g.value}: hidden, fewer than ${d.scope.minimum} responses` })), { max: 1 }))))),
      d.reportingMode === 'aggregate'
        ? h('section', { class: 'card stack' }, h('h3', 'What people said'), h('p', { class: 'small muted' }, 'This programme uses aggregate reporting, so individual quotes are not shown.'), d.aggregateSummary ? h('p', d.aggregateSummary) : null)
        : h('div', { class: 'stack' },
          h('p', { class: 'small muted', style: { margin: 0 } }, 'Evidence is shown from every side, including people who spoke positively. Quotes are the employee’s exact words as they confirmed them; translations and paraphrases are labelled.'),
          evBox('Negative experiences', ev.negative), evBox('Mixed experiences', ev.mixed), evBox('Positive experiences', ev.positive), evBox('Neutral mentions', ev.neutral)),
      can('taxonomy') ? taxonomyCard(t, q) : null));
}

async function bookmark(t, q) {
  try { await hr('/api/hr/bookmarks', { method: 'POST', body: { kind: 'theme', ref: t.id, title: t.label, query: q } }); toast('Bookmarked. Find it on the Insight assistant page.'); } catch (err) { toast(err.message, { kind: 'bad' }); }
}

function taxonomyCard(t, q) {
  const preview = h('div');
  const run = async (edit, apply) => {
    try {
      const r = await hr(`/api/hr/taxonomy/${apply ? 'apply' : 'preview'}`, { method: 'POST', body: { edit, query: q } });
      if (apply) { await refreshThemes(); toast('Theme updated. All findings, reports you refresh and exports now use it.'); go(`#/insights/theme/${edit.op === 'merge' ? edit.into : t.id}?u=${Date.now()}`); return; }
      preview.replaceChildren(h('div', { class: 'card soft stack' }, h('strong', 'Effect on this selection'),
        table(['Theme', 'Before', 'After'], [...new Set([...r.effect.before, ...r.effect.after].map((x) => x.id))].map((id) => {
          const b = r.effect.before.find((x) => x.id === id), a = r.effect.after.find((x) => x.id === id);
          return [a?.label || b?.label || id, b?.removed ? '–' : `${b?.respondents ?? 0} respondents`, a?.removed ? 'Merged away' : `${a?.respondents ?? 0} respondents`];
        })),
        h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: () => run(edit, true) }, 'Apply change'), h('button', { class: 'btn ghost sm', onclick: () => preview.replaceChildren() }, 'Cancel'))));
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  };
  const others = Object.entries(state.meta.themes).filter(([k]) => k !== t.id);
  const renameIn = h('input', { type: 'text', value: t.label, 'aria-label': 'New name' });
  const mergeSel = h('select', { 'aria-label': 'Merge into' }, others.map(([k, v]) => h('option', { value: k }, v.label)));
  const splitSel = h('select', { 'aria-label': 'Sub-theme to split out' }, Object.keys(t.subthemes || {}).map((s) => h('option', { value: s }, s)));
  const splitName = h('input', { type: 'text', placeholder: 'New theme name', 'aria-label': 'New theme name' });
  return h('details', { class: 'card' }, h('summary', h('strong', 'Refine this theme')),
    h('div', { class: 'stack', style: { marginTop: '.75rem' } },
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Changes apply to how evidence is grouped for everyone. Nothing employees said is changed, and you can reset all theme changes in Settings.'),
      h('div', { class: 'row' }, h('label', { class: 'small' }, 'Rename ', renameIn), h('button', { class: 'btn sm', onclick: () => run({ op: 'rename', theme: t.id, label: renameIn.value }) }, 'Preview')),
      h('div', { class: 'row' }, h('label', { class: 'small' }, 'Merge into ', mergeSel), h('button', { class: 'btn sm', onclick: () => run({ op: 'merge', from: [t.id], into: mergeSel.value }) }, 'Preview')),
      Object.keys(t.subthemes || {}).length ? h('div', { class: 'row' }, h('label', { class: 'small' }, 'Split out ', splitSel), splitName, h('button', { class: 'btn sm', onclick: () => run({ op: 'split', theme: t.id, sub: splitSel.value, label: splitName.value }) }, 'Preview')) : null,
      preview));
}

export function createActionDialog(prefill = {}) {
  const v = { title: '', owner: '', dueDate: '', outcome: '', successMeasure: '', ...prefill };
  const field = (k, label, type = 'text', hint) => h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `a-${k}` }, label), hint ? h('span', { class: 'hint' }, hint) : null,
    type === 'textarea' ? h('textarea', { id: `a-${k}`, rows: 2, oninput: (e) => { v[k] = e.target.value; } }, v[k] || '') : h('input', { type, id: `a-${k}`, value: v[k] || '', oninput: (e) => { v[k] = e.target.value; } }));
  dialog({
    title: 'Create an improvement action', wide: true,
    body: h('div', { class: 'stack' },
      prefill.evidence ? h('div', { class: 'notice' }, h('div', h('strong', 'Linked evidence'), h('div', { class: 'small' }, prefill.evidence.text))) : null,
      field('title', 'Action'), h('div', { class: 'grid g2' }, field('owner', 'Owner'), field('dueDate', 'Due date', 'date')),
      field('outcome', 'Intended outcome', 'textarea'), field('successMeasure', 'How you will know it worked (optional)', 'textarea', 'Later exit feedback on the same themes is shown alongside the action. It shows change, not proof of effect.')),
    actions: [{ label: 'Cancel' }, { label: 'Create action', kind: 'primary', onClick: async () => {
      const r = await hr('/api/hr/actions', { method: 'POST', body: v });
      toast('Action created.');
      go(`#/actions/${r.action.id}`);
    } }],
  });
}

export async function newReportDialog(query, themeId) {
  const { templates } = await hr('/api/hr/reports');
  let template = themeId ? 'theme_investigation' : 'programme_summary';
  let theme = themeId || '';
  const themeSel = h('select', { id: 'rt', onchange: (e) => { theme = e.target.value; } }, Object.entries(state.meta.themes).map(([k, t]) => h('option', { value: k, selected: k === theme }, t.label)));
  const themeField = h('div', { class: 'field', hidden: template !== 'theme_investigation' }, h('label', { for: 'rt' }, 'Theme'), themeSel);
  dialog({
    title: 'Create a report', wide: true,
    body: h('div', { class: 'stack' },
      h('p', { class: 'small ink2', style: { margin: 0 } }, 'The report uses the current insights selection and keeps a snapshot of its numbers until you refresh it.'),
      h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Template' }, Object.entries(templates).map(([k, t]) => h('label', { class: 'check card flat', style: { padding: '.6rem .8rem' } },
        h('input', { type: 'radio', name: 'tpl', checked: k === template, onchange: () => { template = k; themeField.hidden = k !== 'theme_investigation'; if (!theme) theme = themeSel.value; } }), h('span', h('strong', t.label), h('br'), h('span', { class: 'small muted' }, t.description))))),
      themeField),
    actions: [{ label: 'Cancel' }, { label: 'Create report', kind: 'primary', onClick: async () => {
      const r = await hr('/api/hr/reports', { method: 'POST', body: { template, query, themeId: template === 'theme_investigation' ? (theme || themeSel.value) : undefined } });
      go(`#/reports/${r.report.id}`);
    } }],
  });
}
