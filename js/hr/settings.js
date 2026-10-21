// Organisation appearance, service configuration, and demonstration controls.
import { h, mount, api, toast, confirmDialog } from '../lib.js';
import { state, hr, can, pageHead, refreshProgrammes, refreshThemes } from './core.js';
import { setCrumbs, rerender } from './app.js';
import { tryInterviewDialog } from './home.js';

export async function render(el) {
  setCrumbs('Settings');
  const cfg = await api('/api/public/config');
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
      h('section', { class: 'card stack' }, h('h3', 'Service configuration'),
        h('dl', { class: 'kv' },
          h('dt', 'Interviewer and analysis model'), h('dd', cfg.llm.live ? `${cfg.llm.model} via the OpenAI API` : 'Offline developer mode (rule-based). Add an OpenAI API key to use the AI interviewer.'),
          h('dt', 'Speech to text'), h('dd', cfg.voice.retention.stt),
          h('dt', 'Text to speech'), h('dd', cfg.voice.retention.tts),
          h('dt', 'Audio'), h('dd', 'Processed live and not stored by PartWays. Transcripts are kept as text.'),
          h('dt', 'Invitations'), h('dd', 'Sent to every channel each person has. Email is delivered. WhatsApp is not connected yet, so WhatsApp messages are recorded as sent but not delivered.'),
          h('dt', 'Identity'), h('dd', 'Departing employees are known by a PartWays Interview Id and a masked email address and/or mobile number. Names are not collected, and email addresses and phone numbers are removed from what people say.'),
          h('dt', 'Sign-in'), h('dd', `6-digit email code. Signed in as ${state.email}.`))),
      demo ? h('section', { class: 'card stack' }, h('h3', 'Demonstration'),
        h('p', { class: 'small ink2', style: { margin: 0 } }, `${state.org.name} is a fictional organisation. Its data covers three programmes and three quarters of 2026, including declines, expiries, corrections and a withdrawal. This copy is private to your organisation.`),
        h('div', { class: 'row' },
          can('programmes') ? h('button', { class: 'btn', onclick: () => tryInterviewDialog() }, 'Try an interview') : null,
          h('button', { class: 'btn', onclick: () => reset('evaluation') }, 'Remove my evaluation data'),
          can('taxonomy') ? h('button', { class: 'btn', onclick: async () => { if (await confirmDialog('Undo all theme changes?', 'Renames, merges and splits are removed. Employee summaries were never changed.', { confirmLabel: 'Undo theme changes' })) { await hr('/api/hr/taxonomy/reset', { method: 'POST' }); await refreshThemes(); toast('Theme changes removed.'); } } }, 'Undo theme changes') : null,
          h('button', { class: 'btn danger', onclick: () => reset('all') }, 'Reset the whole demonstration')),
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Use “View as” in the sidebar to see the workspace as a programme owner, people analyst or leader.')) : null));
}
