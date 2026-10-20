// Reports: editable, sourced documents built from a fixed snapshot of the findings.
import { h, mount, fmt, toast, confirmDialog, debounce } from '../lib.js';
import { state, hr, can, go, pageHead, loading, errorBox, download, themeLabel } from './core.js';
import { setCrumbs } from './app.js';
import { getQuery, newReportDialog, reasonsChart, comparisonChart, evidenceItem, scopeLine } from './insights.js';
import { chartCard, bars, table } from './charts.js';

export async function render(el) {
  setCrumbs('Reports');
  mount(el, loading());
  let data;
  try { data = await hr('/api/hr/reports'); } catch (err) { return mount(el, errorBox(err, () => render(el))); }
  mount(el,
    pageHead('Reports', 'Programme summaries, leadership briefings, period comparisons and theme investigations. Each keeps the numbers it was created with until you refresh it.',
      can('reports') ? h('button', { class: 'btn primary', onclick: () => newReportDialog(getQuery()) }, 'New report from current selection') : null),
    data.reports.length ? h('div', { class: 'table-wrap card flat', style: { padding: 0 } }, h('table',
      h('thead', h('tr', ['Report', 'Type', 'Responses', 'Data as of', ''].map((c) => h('th', c)))),
      h('tbody', data.reports.map((r) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => go(`#/reports/${r.id}`), onkeydown: (e) => { if (e.key === 'Enter') go(`#/reports/${r.id}`); } },
        h('td', h('a', { href: `#/reports/${r.id}`, onclick: (e) => e.stopPropagation() }, r.title), h('div', { class: 'small muted' }, r.scope.periodLabel)),
        h('td', { class: 'small' }, data.templates[r.template]?.label),
        h('td', { class: 'num' }, r.n),
        h('td', { class: 'small' }, fmt.dateTime(r.asOf)),
        h('td', r.stale ? h('span', { class: 'badge warn' }, 'Newer data available') : null))))))
      : h('div', { class: 'empty' }, h('h3', 'No reports yet'), h('p', 'Create one from the findings, or start from the home page with a leadership briefing.')));
}

function sectionChart(key, snap, section) {
  if (!snap.current.available) return null;
  if (key === 'reasons') return reasonsChart(snap);
  if (key === 'comparison') return comparisonChart(snap);
  if (key === 'participation') {
    const p = snap.current.participation;
    const rows = [['Invited', p.eligible], ['Started', p.started], ['Submitted', p.submitted]];
    return chartCard({ title: 'Participation', chart: bars(rows.map(([l, v]) => ({ label: l, share: p.eligible ? v / p.eligible : 0, value: `${v}`, tip: `${l}: ${v} of ${p.eligible}` })), { max: 1 }), table: table(['Stage', 'People'], rows, { numeric: [1] }) });
  }
  if (key === 'positives') {
    const rows = Object.values(snap.current.themes).filter((t) => t.tone.positive).sort((a, b) => b.tone.positive - a.tone.positive).slice(0, 6);
    return chartCard({ title: 'Spoken about positively', sub: `Respondents out of ${snap.current.n}`, chart: bars(rows.map((t) => ({ label: t.label, share: t.tone.positive / snap.current.n, value: `${t.tone.positive}` })), { max: 1 }), table: table(['Theme', 'Respondents'], rows.map((t) => [t.label, t.tone.positive]), { numeric: [1] }) });
  }
  if (key === 'segments' && section.themeId) {
    const g = snap.segments.businessUnit.groups;
    return chartCard({ title: `${themeLabel(section.themeId)} by business unit`, chart: bars(g.map((x) => ({ label: x.value, share: x.available ? x.themes[section.themeId]?.share || 0 : 0, value: x.available ? `${x.themes[section.themeId]?.respondents || 0} of ${x.n}` : 'Too few' })), { max: 1 }), table: table(['Business unit', 'Respondents', 'Responses'], g.map((x) => [x.value, x.available ? x.themes[section.themeId]?.respondents || 0 : 'Not shown', x.n]), { numeric: [1, 2] }) });
  }
  return null;
}

export async function renderReport(el, [id], query = {}) {
  mount(el, loading());
  let r;
  try { r = (await hr(`/api/hr/reports/${id}`)).report; } catch (err) { return mount(el, errorBox(err, () => renderReport(el, [id]))); }
  setCrumbs(['Reports', '#/reports'], r.title);
  const editable = can('reports');
  const snap = r.snapshot;
  const saveEl = h('span', { class: 'small muted', 'aria-live': 'polite' });
  const save = debounce(async () => {
    saveEl.textContent = 'Saving…';
    try { const x = await hr(`/api/hr/reports/${id}`, { method: 'PUT', body: { title: r.title, sections: r.sections.map((s) => ({ id: s.id, text: s.text, included: s.included })) } }); r.sections = x.report.sections; saveEl.textContent = `Saved ${fmt.dateTime(x.savedAt)}`; } catch (err) { saveEl.textContent = `Not saved: ${err.message}`; }
  }, 900);
  const list = h('div', { class: 'stack' });
  const draw = () => list.replaceChildren(...r.sections.map((s, i) => {
    const move = (d) => { const j = i + d; if (j < 0 || j >= r.sections.length) return; [r.sections[i], r.sections[j]] = [r.sections[j], r.sections[i]]; draw(); save(); };
    const chart = s.chart ? sectionChart(s.chart, snap, s) : null;
    return h('section', { class: `section-edit${s.included ? '' : ' excluded'}`, 'aria-label': s.title },
      h('div', { class: 'row between' }, h('div', { class: 'row', style: { gap: '.4rem' } }, h('h3', { style: { margin: 0 } }, s.title),
        s.edited ? h('span', { class: 'badge info' }, 'Edited') : null, s.needsReview ? h('span', { class: 'badge warn' }, 'Check against refreshed data') : null,
        s.added ? h('span', { class: 'badge accent' }, 'Added') : null, s.interpretation ? h('span', { class: 'badge' }, 'Includes interpretation') : null, s.unavailable ? h('span', { class: 'badge' }, 'Below reporting minimum') : null),
      editable ? h('div', { class: 'row no-print', style: { gap: '.2rem' } },
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: s.included, onchange: (e) => { s.included = e.target.checked; draw(); save(); } }), 'Include'),
        h('button', { class: 'btn ghost sm', 'aria-label': `Move ${s.title} up`, onclick: () => move(-1) }, '↑'),
        h('button', { class: 'btn ghost sm', 'aria-label': `Move ${s.title} down`, onclick: () => move(1) }, '↓')) : null),
      editable ? h('textarea', { 'aria-label': `${s.title} text`, rows: Math.min(12, Math.max(3, Math.ceil(s.text.length / 110))), oninput: (e) => { s.text = e.target.value; s.edited = true; save(); } }, s.text) : h('p', { style: { whiteSpace: 'pre-wrap' } }, s.text),
      s.evidence?.length ? h('details', h('summary', `Evidence (${s.evidence.length})`), s.evidence.map((e) => evidenceItem(e))) : null,
      s.actions?.length ? h('ul', { class: 'small' }, s.actions.map((a) => h('li', h('a', { href: `#/actions/${a.id}` }, a.title), ` · ${a.owner} · ${a.status.replace('_', ' ')}${a.dueDate ? ` · due ${fmt.date(a.dueDate)}` : ''}`))) : null,
      s.sourceScope ? h('div', { class: 'small muted' }, `Source: ${s.sourceScope}`) : null,
      chart);
  }));
  draw();
  const summaryText = () => `${r.title}\n${snap.scope.programmes.map((p) => p.name).join(', ')} · ${snap.scope.periodLabel} · ${snap.current.n} responses · data as of ${fmt.dateTime(r.asOf)}\n\n${r.sections.filter((s) => s.included).map((s) => `${s.title}\n${s.text}`).join('\n\n')}`;
  const titleIn = h('input', { type: 'text', value: r.title, 'aria-label': 'Report title', style: { fontSize: '1.3rem', fontWeight: 650 }, disabled: !editable, oninput: (e) => { r.title = e.target.value; save(); } });
  mount(el,
    h('div', { class: 'stack', style: { gap: '1rem' } },
      h('div', { class: 'row between' }, h('div', { style: { flex: '1 1 420px' } }, titleIn),
        h('div', { class: 'row no-print' },
          h('button', { class: 'btn sm', onclick: () => present(r) }, 'Present'),
          h('button', { class: 'btn sm', onclick: () => download(`/api/hr/reports/${id}/pdf`, `${r.title}.pdf`).catch((e) => toast(e.message, { kind: 'bad' })) }, 'PDF'),
          h('button', { class: 'btn sm', onclick: () => download(`/api/hr/reports/${id}/csv`, `${r.title}.csv`).catch((e) => toast(e.message, { kind: 'bad' })) }, 'CSV'),
          h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(summaryText()); toast('Summary copied.'); } catch { toast('Copy is not available here.', { kind: 'bad' }); } } }, 'Copy text'),
          editable ? h('button', { class: 'btn sm ghost danger', onclick: async () => { if (await confirmDialog('Delete this report?', 'This cannot be undone. The underlying findings are not affected.', { confirmLabel: 'Delete', kind: 'danger' })) { await hr(`/api/hr/reports/${id}`, { method: 'DELETE' }); go('#/reports'); } } }, 'Delete') : null)),
      h('div', { class: 'row small muted' }, scopeLine(snap), '·', `Data as of ${fmt.dateTime(r.asOf)}`, editable ? ['·', saveEl] : null),
      r.stale ? h('div', { class: 'notice warn', role: 'status' }, h('div', h('strong', 'Newer data is available. '), 'Interviews were submitted, corrected or withdrawn after this report was generated. The numbers below are unchanged until you refresh. Sections you edited are kept and flagged for checking.',
        editable ? h('div', { style: { marginTop: '.5rem' } }, h('button', { class: 'btn sm', onclick: async () => { try { await hr(`/api/hr/reports/${id}/refresh`, { method: 'POST' }); toast('Report refreshed.'); renderReport(el, [id]); } catch (err) { toast(err.message, { kind: 'bad' }); } } }, 'Refresh with current data')) : null)) : null,
      list));
  if (query.present) present(r);
}

function present(r) {
  const slides = r.sections.filter((s) => s.included);
  let i = 0;
  const snap = r.snapshot;
  const stage = h('div', { class: 'slide', 'aria-live': 'polite' });
  const counter = h('span', { class: 'small muted' });
  const draw = () => {
    if (i === -1) {
      stage.replaceChildren(h('div', { class: 'small muted' }, `${state.org.name} · PartWays`), h('h2', r.title), h('p', { class: 'ink2' }, `${snap.scope.programmes.map((p) => p.name).join(', ')} · ${snap.scope.periodLabel} · ${snap.current.n} responses`), snap.scope.population === 'demo' ? h('span', { class: 'badge demo' }, 'Fictional demonstration data') : null);
    } else {
      const s = slides[i];
      stage.replaceChildren(h('h2', s.title), h('p', { style: { whiteSpace: 'pre-wrap' } }, s.text), s.chart ? sectionChart(s.chart, snap, s) : null);
    }
    counter.textContent = `${i + 2} of ${slides.length + 1}`;
  };
  i = -1;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight' || e.key === ' ') next(); if (e.key === 'ArrowLeft') prev(); };
  const next = () => { if (i < slides.length - 1) { i++; draw(); } };
  const prev = () => { if (i > -1) { i--; draw(); } };
  const wrap = h('div', { class: 'present', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Presenting ${r.title}` },
    h('div', { class: 'top' }, h('span', `Data as of ${fmt.dateTime(r.asOf)}`), h('button', { class: 'btn sm', onclick: close }, 'Exit (Esc)')),
    stage,
    h('div', { class: 'ctrl' }, h('button', { class: 'btn', onclick: prev }, '← Previous'), counter, h('button', { class: 'btn primary', onclick: next }, 'Next →')));
  document.body.append(wrap);
  document.addEventListener('keydown', key);
  draw();
  wrap.querySelector('.btn.primary').focus();
}
