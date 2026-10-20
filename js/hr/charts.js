// Accessible HTML charts: thin single-hue bars, paired comparison bars, tone stacks.
// Every chart has a table view, tooltips on hover/focus, and a legend for two or more series.
import { h, tooltip, fmt } from '../lib.js';

export function chartCard({ title, sub, chart, table, actions, note }) {
  let showTable = false;
  const body = h('div');
  const btn = h('button', { class: 'btn ghost sm toggle-view', type: 'button', 'aria-pressed': 'false' }, 'Table view');
  const render = () => {
    body.replaceChildren(showTable ? table : chart);
    btn.textContent = showTable ? 'Chart view' : 'Table view';
    btn.setAttribute('aria-pressed', String(showTable));
  };
  btn.onclick = () => { showTable = !showTable; render(); };
  render();
  return h('section', { class: 'card', 'aria-label': title },
    h('div', { class: 'chart-head' }, h('div', h('h3', title), sub ? h('div', { class: 'small muted' }, sub) : null),
      h('div', { class: 'row', style: { gap: '.25rem' } }, actions || null, table ? btn : null)),
    body, note ? h('p', { class: 'small muted', style: { margin: '.6rem 0 0' } }, note) : null);
}

export function table(columns, rows, { numeric = [] } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', h('tr', columns.map((c, i) => h('th', { scope: 'col', class: numeric.includes(i) ? 'num' : '' }, c)))),
    h('tbody', rows.map((r) => h('tr', r.map((v, i) => h('td', { class: numeric.includes(i) ? 'num' : '' }, v)))))));
}

// rows: [{ label, share (0..1), value text, tip, onClick }]
export function bars(rows, { max } = {}) {
  const top = max ?? Math.max(0.0001, ...rows.map((r) => r.share || 0));
  if (!rows.length) return h('p', { class: 'muted small' }, 'Nothing to show for this selection.');
  return h('div', { class: 'chart', role: 'list' }, rows.map((r) => {
    const track = h('div', { class: 'bar-track' }, h('div', { class: 'bar', style: { width: `${Math.max(0.5, (r.share || 0) / top * 100)}%` } }));
    const lbl = r.onClick ? h('button', { class: 'linkbtn', type: 'button', onclick: r.onClick, style: { textAlign: 'left', color: 'var(--ink)' } }, r.label) : r.label;
    const row = h('div', { class: 'bar-row', role: 'listitem', tabindex: r.onClick ? null : '0' }, h('span', { class: 'lbl' }, lbl), track, h('span', { class: 'val' }, r.value));
    tooltip(row, r.tip || `${r.label}: ${r.value}`);
    return row;
  }));
}

// Two series per row: current (series 1) and comparison (series 2).
export function pairBars(rows, { labels }) {
  const top = Math.max(0.0001, ...rows.flatMap((r) => [r.a ?? 0, r.b ?? 0]));
  return h('div', { class: 'stack', style: { gap: '.6rem' } },
    h('div', { class: 'legend' }, h('span', h('span', { class: 'key', style: { background: 'var(--series-1)' } }), labels[0]), h('span', h('span', { class: 'key', style: { background: 'var(--series-2)' } }), labels[1])),
    h('div', { class: 'chart', role: 'list' }, rows.map((r) => {
      const row = h('div', { class: 'bar-row', role: 'listitem', tabindex: '0' },
        h('span', { class: 'lbl' }, r.onClick ? h('button', { class: 'linkbtn', type: 'button', onclick: r.onClick, style: { textAlign: 'left', color: 'var(--ink)' } }, r.label) : r.label),
        h('div', { class: 'bar-pair' },
          h('div', { class: 'bar-track' }, h('div', { class: 'bar', style: { width: `${Math.max(0.5, (r.a ?? 0) / top * 100)}%` } })),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar s2', style: { width: `${r.b == null ? 0 : Math.max(0.5, r.b / top * 100)}%` } }))),
        h('span', { class: 'val' }, r.value));
      tooltip(row, r.tip);
      return row;
    })));
}

export const TONE = [
  ['negative', 'Negative', 'var(--series-neg)'],
  ['mixed', 'Mixed', 'var(--series-mixed)'],
  ['positive', 'Positive', 'var(--series-pos)'],
  ['neutral', 'Neutral', 'var(--series-neutral)'],
];

export function toneLegend() {
  return h('div', { class: 'legend' }, TONE.map(([, l, c]) => h('span', h('span', { class: 'key', style: { background: c } }), l)));
}

export function toneBar(tone, label) {
  const total = TONE.reduce((s, [k]) => s + (tone?.[k] || 0), 0) || 1;
  const bar = h('div', { class: 'stackbar', role: 'img', 'aria-label': `${label}: ${TONE.map(([k, l]) => `${l} ${tone?.[k] || 0}`).join(', ')}` },
    TONE.filter(([k]) => tone?.[k]).map(([k, l, c]) => tooltip(h('span', { style: { width: `${(tone[k] / total) * 100}%`, background: c } }), `${label}. ${l}: ${tone[k]} of ${total}`)));
  return bar;
}

export const pct = (x) => fmt.pct(x);
export const ofN = (k, n) => `${k} of ${n} (${fmt.pct(n ? k / n : null)})`;
