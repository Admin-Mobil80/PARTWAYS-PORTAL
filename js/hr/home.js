// Home: guided entry points, items needing attention, and the programme portfolio.
import { h, mount, fmt, toast, dialog } from '../lib.js';
import { state, hr, can, go, pageHead, PROG_STATUS, refreshProgrammes, loading, errorBox, plural } from './core.js';
import { setCrumbs, showDemo } from './app.js';

// In an organisation's own workspace, trying an interview is a free preview of a programme's guide.
function previewDialog(programmeId) {
  const progs = state.programmes.filter((p) => p.status !== 'archived');
  if (!progs.length) return toast('Create a programme first.', { kind: 'bad' });
  let prog = programmeId || progs[0].id;
  let mode = 'ai_text';
  const progSel = h('select', { id: 'pp', onchange: (e) => { prog = e.target.value; } }, progs.map((p) => h('option', { value: p.id, selected: p.id === prog }, p.name)));
  const modeSel = h('select', { id: 'pm', onchange: (e) => { mode = e.target.value; } }, h('option', { value: 'ai_text' }, 'Text'), h('option', { value: 'ai_voice' }, 'Voice'));
  dialog({
    title: 'Try an interview',
    body: h('div', { class: 'stack' },
      h('p', { class: 'ink2' }, 'Take the interview as a departing employee would, using the programme’s current guide. Previews are free, use no credits, and never appear in findings.'),
      h('div', { class: 'grid g2' }, h('div', { class: 'field' }, h('label', { for: 'pp' }, 'Programme'), progSel), h('div', { class: 'field' }, h('label', { for: 'pm' }, 'Format'), modeSel))),
    actions: [{ label: 'Cancel' }, { label: 'Open preview', kind: 'primary', onClick: async () => {
      const r = await hr(`/api/hr/programmes/${prog}/preview`, { method: 'POST', body: { mode } });
      window.open(`/interview/#/s/${r.id}?t=${r.accessToken}`, '_blank', 'noopener');
      toast('Opened a preview interview in a new tab.');
    } }],
  });
}

export async function tryInterviewDialog(programmeId) {
  if (!state.org.demo) return previewDialog(programmeId);
  const { personas } = await hr('/api/hr/demo/personas');
  const active = state.programmes.filter((p) => p.status === 'active');
  let persona = 'workload';
  let prog = programmeId || 'prog_general';
  let lang = 'en';
  const progSel = h('select', { id: 'tp', onchange: (e) => { prog = e.target.value; } }, active.map((p) => h('option', { value: p.id, selected: p.id === prog }, p.name)));
  const langSel = h('select', { id: 'tl', onchange: (e) => { lang = e.target.value; } }, ['en', 'de', 'fr'].map((l) => h('option', { value: l }, { en: 'English', de: 'Deutsch', fr: 'Français' }[l])));
  const brief = h('p', { class: 'small ink2' });
  const cards = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Persona' });
  const draw = () => {
    cards.replaceChildren(...[['', { label: 'Answer as yourself', brief: 'No script. Use your own experience or an imagined one.' }], ...Object.entries(personas)].map(([k, v]) => h('label', { class: 'check card flat', style: { padding: '.6rem .8rem' } },
      h('input', { type: 'radio', name: 'persona', value: k, checked: persona === k, onchange: () => { persona = k; if (personas[k]?.programmeId) { prog = personas[k].programmeId; progSel.value = prog; } } }),
      h('span', h('strong', v.label), h('br'), h('span', { class: 'small muted' }, v.brief)))));
  };
  draw();
  dialog({
    title: 'Try an interview', wide: true,
    body: h('div', { class: 'stack' },
      h('p', { class: 'ink2' }, 'This creates a fresh evaluation participant with a real invitation link and opens the employee experience in a new tab. Submitted evaluation interviews appear in insights when you include evaluation data, and you can reset them from Settings.'),
      h('div', { class: 'grid g2' }, h('div', { class: 'field' }, h('label', { for: 'tp' }, 'Programme'), progSel), h('div', { class: 'field' }, h('label', { for: 'tl' }, 'Preferred language'), langSel)),
      h('div', h('label', 'Optional persona to play'), cards), brief),
    actions: [{ label: 'Cancel' }, { label: 'Create and open interview', kind: 'primary', onClick: async () => {
      const r = await hr('/api/hr/demo/try', { method: 'POST', body: { persona: persona || null, programmeId: prog, language: lang } });
      window.open(r.link, '_blank', 'noopener');
      toast(`Opened interview ${r.participant.interviewId} in a new tab.`);
    } }],
  });
}

async function leadershipBriefing() {
  const r = await hr('/api/hr/reports', { method: 'POST', body: { template: 'leadership_briefing', query: { programmeId: 'prog_general', period: '2026-Q3' } } });
  go(`#/reports/${r.report.id}`);
}

function firstSteps() {
  const draft = state.programmes.find((p) => p.status === 'draft');
  const active = state.programmes.find((p) => p.status === 'active');
  const first = active || draft || state.programmes[0];
  const credits = state.me?.credits?.balance ?? 0;
  const step = (n, title, text, action) => h('li', { class: 'card stack', style: { alignContent: 'start' } },
    h('span', { class: 'badge' }, `Step ${n}`), h('h3', { style: { margin: 0 } }, title), h('p', { class: 'ink2 small', style: { margin: 0 } }, text), action ? h('div', action) : null);
  const btn = (label, onClick) => h('button', { class: 'btn sm', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await onClick(); } catch (err) { toast(err.message, { kind: 'bad' }); } finally { b.disabled = false; } } }, label);
  return h('section', { 'aria-labelledby': 'fs-h', class: 'stack' },
    h('h2', { id: 'fs-h' }, 'Get started'),
    h('ol', { class: 'grid g4 list-plain' },
      step(1, 'Shape the interview', 'Say what you want to learn. PartWays proposes the topics; you can edit every question.', first ? btn('Open the guide', () => go(`#/programmes/${first.id}/guide`)) : btn('New programme', () => go('#/programmes/new'))),
      step(2, 'Try it yourself', 'Take the interview by voice or text, as a departing employee would. Free, and never counted.', btn('Try an interview', () => previewDialog(first?.id))),
      step(3, 'Invite people who are leaving', `Add email addresses and/or mobile numbers and send invitations by email and WhatsApp. Each gets a PartWays Interview Id. You have ${plural(credits, 'credit')}.`, first ? btn('Add people', () => go(`#/programmes/${first.id}/participants`)) : null),
      step(4, 'Act on what you learn', 'See themes, ask the assistant, brief leaders and track actions. Findings stay de-identified.', btn('See an example', async () => showDemo()))));
}

function teamWelcome() {
  return h('section', { class: 'card stack' }, h('h2', { style: { margin: 0 } }, 'Welcome'),
    h('p', { class: 'ink2', style: { margin: 0 } }, `You have ${({ analyst: 'analyst', leader: 'leader' })[state.me?.role] || 'team'} access to ${state.org.name}. Findings appear here once departing employees have submitted their reviewed feedback.`),
    h('div', { class: 'row' }, can('insights') ? h('a', { class: 'btn sm', href: '#/insights' }, 'Insights') : null, can('reports') ? h('a', { class: 'btn sm', href: '#/reports' }, 'Reports') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => showDemo() }, 'See an example in the demo')));
}

function guided() {
  const entry = (title, text, label, onClick, show = true) => (show ? h('div', { class: 'card stack', style: { alignContent: 'start' } }, h('h3', title), h('p', { class: 'ink2 small', style: { margin: 0 } }, text),
    h('div', h('button', { class: 'btn sm', type: 'button', onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await onClick(); } catch (err) { toast(err.message, { kind: 'bad' }); } finally { btn.disabled = false; } } }, label))) : null);
  return h('section', { 'aria-labelledby': 'g-h', class: 'stack' },
    h('h2', { id: 'g-h' }, 'Where to start'),
    h('div', { class: 'grid g4' },
      entry('Try an interview', 'Take part as a departing employee, by voice or text, and see what HR receives after your review.', 'Try an interview', () => tryInterviewDialog(), can('programmes')),
      entry('Explore the findings', 'Q3 2026 for Voluntary exits: what people are saying, what changed, and where it is concentrated.', 'Explore the findings', () => go('#/insights'), can('insights')),
      entry('Prepare a leadership briefing', 'Generate an editable briefing from the current findings, with sources and limitations.', 'Prepare a briefing', leadershipBriefing, can('reports')),
      entry('From objective to finding', 'Follow the hybrid-working objective from the guide, through a live preview, to what respondents said.', 'Follow an objective', () => go('#/programmes/prog_general/guide?highlight=o_hybrid'), can('edit'))));
}

async function attention() {
  const box = h('section', { class: 'card', 'aria-labelledby': 'a-h' }, h('h2', { id: 'a-h' }, 'Needs attention'), h('p', { class: 'muted small' }, 'Loading…'));
  (async () => {
    const items = [];
    try {
      const [acts, fups] = await Promise.all([
        can('actions') ? hr('/api/hr/actions') : { actions: [] },
        can('participants') ? hr('/api/hr/participants?status=follow_up') : { participants: [] },
      ]);
      const credits = state.me?.credits;
      if (credits && !credits.unlimited && credits.balance === 0) items.push(['You have no interview credits left. Buy credits to send more invitations.', '#/billing']);
      const fu = fups.participants.filter((p) => p.followUp?.status === 'requested');
      if (fu.length) items.push([`${fu.length} follow-up request${fu.length > 1 ? 's' : ''} not yet acknowledged`, '#/follow-ups']);
      const overdue = acts.actions.filter((a) => a.overdue);
      if (overdue.length) items.push([`${overdue.length} overdue action${overdue.length > 1 ? 's' : ''}`, '#/actions?filter=overdue']);
      for (const p of state.programmes.filter((x) => x.hasDraft && can('edit'))) items.push([`${p.name} has guide changes that are not active yet`, `#/programmes/${p.id}/guide`]);
      for (const p of state.programmes.filter((x) => x.processing)) items.push([`${p.name}: ${p.processing} submitted interview(s) still processing`, `#/programmes/${p.id}`]);
    } catch (err) { items.push([err.message, null]); }
    box.replaceChildren(h('h2', { id: 'a-h' }, 'Needs attention'), items.length
      ? h('ul', { class: 'list-plain' }, items.map(([t, href]) => h('li', href ? h('a', { href }, t) : t)))
      : h('p', { class: 'muted', style: { margin: 0 } }, 'Nothing needs your attention right now.'));
  })();
  return box;
}

export function programmeCards(list) {
  if (!list.length) return h('div', { class: 'empty' }, h('h3', 'No programmes yet'), h('p', 'Create a programme to start inviting departing employees.'));
  return h('div', { class: 'grid g3' }, list.map((p) => h('button', { type: 'button', class: 'card prog-card', onclick: () => go(`#/programmes/${p.id}`) },
    h('div', { class: 'row between' }, h('strong', p.name), h('span', { class: `badge ${PROG_STATUS[p.status]}` }, fmt.title(p.status))),
    h('span', { class: 'small ink2' }, p.description || ''),
    h('span', { class: 'small muted' }, `${p.counts.participants} invited · ${p.counts.submitted || 0} submitted · ${p.objectives} objective${p.objectives === 1 ? '' : 's'} · ${p.reportingMode === 'aggregate' ? 'aggregate reporting' : 'individual reporting'}`),
    h('span', { class: 'row', style: { gap: '.35rem' } },
      p.activeVersion ? h('span', { class: 'badge' }, `Guide v${p.activeVersion}`) : null,
      p.hasDraft ? h('span', { class: 'badge warn' }, 'Unpublished changes') : null,
      p.followUps ? h('span', { class: 'badge accent' }, `${p.followUps} follow-up${p.followUps > 1 ? 's' : ''}`) : null))));
}

export async function render(el) {
  setCrumbs('Home');
  mount(el, loading());
  await refreshProgrammes();
  mount(el,
    pageHead(`${state.org.shortName || state.org.name} exit interviews`, 'PartWays runs independent exit interviews for you, and turns what departing employees confirm into findings you can act on.'),
    h('div', { class: 'stack', style: { gap: '1.5rem' } },
      state.org.demo ? guided() : can('edit') ? firstSteps() : teamWelcome(),
      await attention(),
      can('programmes') ? h('section', { class: 'stack', 'aria-labelledby': 'p-h' },
        h('div', { class: 'row between' }, h('h2', { id: 'p-h', style: { margin: 0 } }, 'Programmes'),
          can('edit') ? h('a', { class: 'btn sm', href: '#/programmes/new' }, 'New programme') : null),
        programmeCards(state.programmes.filter((p) => p.status !== 'archived'))) : null));
}

export async function renderPortfolio(el) {
  setCrumbs(['Home', '#/'], 'Programmes');
  mount(el, loading());
  try { await refreshProgrammes(); } catch (err) { return mount(el, errorBox(err, () => renderPortfolio(el))); }
  const groups = [['Active and paused', ['active', 'paused']], ['Drafts', ['draft']], ['Archived', ['archived']]];
  mount(el, pageHead('Programmes', 'Each programme has its own learning objectives, interview guide, participants and reporting rules.',
    can('edit') ? h('a', { class: 'btn primary', href: '#/programmes/new' }, 'New programme') : null),
  h('div', { class: 'stack', style: { gap: '1.5rem' } }, groups.map(([label, sts]) => {
    const list = state.programmes.filter((p) => sts.includes(p.status));
    return list.length ? h('section', { class: 'stack' }, h('h2', label), programmeCards(list)) : null;
  })));
}
