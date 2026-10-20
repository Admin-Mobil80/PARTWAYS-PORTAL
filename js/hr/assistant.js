// Insight assistant: questions answered from the same governed numbers as the dashboard,
// with evidence links, clearly separated interpretation, and stated gaps.
import { h, mount, toast, dialog } from '../lib.js';
import { hr, can, go, pageHead, loading } from './core.js';
import { setCrumbs } from './app.js';
import { getQuery, setQuery, scopeLine, createActionDialog } from './insights.js';
import { table } from './charts.js';

let history = [];

function refLinks(refs = []) {
  const seen = new Set();
  const links = [];
  for (const r of refs) {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.id && ['theme', 'comparison', 'segment'].includes(r.type)) links.push(h('a', { href: `#/insights/theme/${r.id}`, class: 'small' }, `Evidence: ${r.label || r.id.replace(/_/g, ' ')}`));
    else if (r.type === 'objective') links.push(h('a', { href: '#/insights?tab=objectives', class: 'small' }, 'Objective findings'));
  }
  return links.length ? h('div', { class: 'row', style: { gap: '.75rem' } }, links) : null;
}

function answerText(a) {
  return [a.said, a.interpretation && `Interpretation: ${a.interpretation}`, a.suggestion && `Suggestion for discussion: ${a.suggestion}`, a.gap && `Not known from this data: ${a.gap}`].filter(Boolean).join('\n\n');
}

async function addToReport(a) {
  const { reports } = await hr('/api/hr/reports');
  let target = reports[0]?.id || '';
  dialog({
    title: 'Add this answer to a report',
    body: h('div', { class: 'stack' },
      h('p', { class: 'small ink2', style: { margin: 0 } }, 'The answer is added with its data selection and evidence links. Interpretation stays labelled as interpretation.'),
      reports.length ? h('select', { 'aria-label': 'Report', onchange: (e) => { target = e.target.value; } }, reports.map((r) => h('option', { value: r.id }, r.title))) : h('p', { class: 'muted' }, 'You have no reports yet. Create one from Insights first.')),
    actions: [{ label: 'Cancel' }, reports.length ? { label: 'Add to report', kind: 'primary', onClick: async () => {
      await hr(`/api/hr/reports/${target}/items`, { method: 'POST', body: { title: a.question, text: answerText(a), refs: a.refs, scope: a.scope, interpretation: !!a.interpretation } });
      toast('Added to the report.');
    } } : null].filter(Boolean),
  });
}

function answerCard(a) {
  return h('article', { class: 'card answer', 'aria-label': `Answer to: ${a.question}` },
    h('div', { class: 'small muted' }, `Based on: ${a.scope}`, a.generatedBy === 'offline' ? ' · rule-based offline answer' : ''),
    !a.answerable ? h('div', { class: 'notice warn' }, a.gap || 'This question cannot be answered from the available data.') : null,
    a.said ? h('div', h('h4', 'What the data shows'), h('p', { style: { margin: '.2rem 0 0', whiteSpace: 'pre-wrap' } }, a.said)) : null,
    a.table?.rows?.length ? table(a.table.columns, a.table.rows) : null,
    a.interpretation ? h('div', h('h4', 'Interpretation'), h('p', { class: 'ink2', style: { margin: '.2rem 0 0' } }, a.interpretation)) : null,
    a.suggestion ? h('div', h('h4', 'Suggestion for discussion'), h('p', { class: 'ink2', style: { margin: '.2rem 0 0' } }, a.suggestion)) : null,
    a.gap && a.answerable ? h('div', h('h4', 'What this data cannot tell you'), h('p', { class: 'ink2', style: { margin: '.2rem 0 0' } }, a.gap)) : null,
    refLinks(a.refs),
    h('div', { class: 'row' },
      can('reports') ? h('button', { class: 'btn sm', onclick: () => addToReport(a).catch((e) => toast(e.message, { kind: 'bad' })) }, 'Add to report') : null,
      can('actions') ? h('button', { class: 'btn sm', onclick: () => createActionDialog({ themes: (a.refs || []).filter((r) => r.id && r.type !== 'objective').map((r) => r.id).slice(0, 3), programmeId: a.query.programmeId === 'all' ? null : a.query.programmeId, evidence: { kind: 'answer', text: a.said, scope: a.scope } }) }, 'Create action') : null,
      h('button', { class: 'btn ghost sm', onclick: async () => { try { await navigator.clipboard.writeText(`${a.question}\n\n${answerText(a)}\n\n(${a.scope})`); toast('Copied.'); } catch { toast('Copy is not available in this browser.', { kind: 'bad' }); } } }, 'Copy')));
}

export async function render(el) {
  setCrumbs('Insight assistant');
  const q = getQuery();
  mount(el, loading());
  const ins = await hr('/api/hr/insights', { method: 'POST', body: { query: q } });
  const thread = h('div', { class: 'stack', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 2, id: 'ask', placeholder: 'For example: Why are people in Customer Service leaving?', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
  const sendBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => send() }, 'Ask');
  const drawThread = () => {
    thread.replaceChildren(...history.flatMap((x) => [h('div', { class: 'msg-q' }, x.question), x.pending ? h('div', { class: 'card', 'aria-busy': 'true' }, h('span', { class: 'spinner' }), ' Looking at the findings…') : x.error ? h('div', { class: 'notice bad' }, x.error) : answerCard(x.answer)]));
  };
  const send = async (text) => {
    const question = (text || input.value).trim();
    if (!question) return;
    input.value = '';
    const item = { question, pending: true };
    history.push(item);
    drawThread();
    sendBtn.disabled = true;
    try {
      const prior = history.filter((x) => x.answer).slice(-4).map((x) => ({ question: x.question, said: x.answer.said, interpretation: x.answer.interpretation, gap: x.answer.gap }));
      const r = await hr('/api/hr/assistant', { method: 'POST', body: { question, query: q, history: prior } });
      item.answer = r.answer;
    } catch (err) { item.error = err.message; }
    item.pending = false;
    sendBtn.disabled = false;
    drawThread();
    thread.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  let bookmarks = [];
  try { bookmarks = (await hr('/api/hr/bookmarks')).bookmarks; } catch { /* optional */ }
  mount(el,
    pageHead('Insight assistant', 'Ask about the findings in your own words. Answers use the same numbers as the dashboard, show their evidence, and say what the data cannot tell you.',
      h('button', { class: 'btn sm ghost', onclick: () => { history = []; drawThread(); toast('Conversation cleared.'); } }, 'Clear conversation')),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('div', { class: 'card soft stack', style: { gap: '.4rem' } }, h('div', { class: 'small muted' }, 'Answering from this selection'), scopeLine(ins), h('a', { href: '#/insights', class: 'small' }, 'Change the selection in Insights')),
        thread,
        h('div', { class: 'card stack' }, h('label', { for: 'ask' }, 'Your question'), input, h('div', { class: 'row between' }, h('span', { class: 'small muted' }, 'Enter to send, Shift+Enter for a new line'), sendBtn))),
      h('div', { class: 'stack sticky-side' },
        h('section', { class: 'card stack' }, h('h3', 'Suggested questions'),
          (ins.suggestions || []).map((s) => h('button', { class: 'btn sm', style: { justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }, onclick: () => send(s) }, s))),
        h('section', { class: 'card stack' }, h('h3', 'What it will not do'),
          h('ul', { class: 'small ink2', style: { margin: 0, paddingLeft: '1.1rem' } },
            h('li', 'Identify or speculate about individuals, or show groups below the reporting minimum.'),
            h('li', 'Claim causes. Patterns are described as what respondents said.'),
            h('li', 'Use anything employees did not submit, or answers outside the selected data.'))),
        bookmarks.length ? h('section', { class: 'card stack' }, h('h3', 'Bookmarks'),
          h('ul', { class: 'list-plain small' }, bookmarks.map((b) => h('li', { class: 'row between' }, h('a', { href: `#/insights/theme/${b.ref}`, onclick: () => { if (b.query) setQuery(b.query); } }, b.title),
            h('button', { class: 'btn ghost sm', 'aria-label': `Remove bookmark ${b.title}`, onclick: async (e) => { await hr(`/api/hr/bookmarks/${b.id}`, { method: 'DELETE' }); e.target.closest('li').remove(); } }, '✕'))))) : null)));
  drawThread();
}
