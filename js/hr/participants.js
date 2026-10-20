// Participation administration: invitations over WhatsApp (simulated), imports, follow-ups.
// This view is operational only: it never shows what anyone said in an interview.
import { h, mount, fmt, toast, dialog, confirmDialog, debounce } from '../lib.js';
import { state, hr, can, pageHead, STATUS_LABEL, MODE_LABEL, LANG_LABEL, loading, errorBox, refreshProgrammes } from './core.js';
import { setCrumbs, updateCredits } from './app.js';

const STATUS_KIND = { submitted: 'good', declined: '', expired: 'warn', cancelled: '', withdrawn: '', awaiting_review: 'accent', in_progress: 'info', abandoned: 'warn', invited: '', not_started: '' };
const INV_LABEL = { prepared: 'Prepared, not sent', sent: 'Sent', opened: 'Opened', responded: 'Responded', cancelled: 'Cancelled', expired: 'Expired' };
const FU_LABEL = { requested: 'Requested', acknowledged: 'Acknowledged', scheduled: 'Scheduled', completed: 'Completed' };

export async function renderProgrammeParticipants(el, programme) {
  let q = '', status = '', population = '';
  const tableBox = h('div');
  const load = async () => {
    tableBox.replaceChildren(loading());
    try {
      const qs = new URLSearchParams({ programmeId: programme.id, ...(q ? { q } : {}), ...(status ? { status } : {}), ...(population ? { population } : {}) });
      const { participants } = await hr(`/api/hr/participants?${qs}`);
      tableBox.replaceChildren(participantTable(participants, programme, load));
    } catch (err) { tableBox.replaceChildren(errorBox(err, load)); }
  };
  const search = debounce((v) => { q = v; load(); }, 300);
  mount(el, h('div', { class: 'stack' },
    programme.status !== 'active' ? h('div', { class: 'notice warn' }, programme.status === 'draft' ? 'Activate the programme before sending invitations. You can add people now.' : `This programme is ${programme.status}. Invitations and reminders cannot be sent.`) : null,
    h('div', { class: 'filters', role: 'search' },
      h('label', 'Search', h('input', { type: 'search', placeholder: 'Interview Id, last digits or unit', style: { minHeight: '34px', width: '240px' }, oninput: (e) => search(e.target.value) })),
      h('label', 'Status', h('select', { onchange: (e) => { status = e.target.value; load(); } }, h('option', { value: '' }, 'All'), h('option', { value: 'follow_up' }, 'Open follow-up requests'), Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k }, v)))),
      state.org.demo && h('label', 'Data', h('select', { onchange: (e) => { population = e.target.value; load(); } }, h('option', { value: '' }, 'All'), h('option', { value: 'demo' }, 'Demonstration data'), h('option', { value: 'evaluation' }, 'Added during evaluation'))) || null,
      h('span', { class: 'spacer' }),
      can('participants') ? h('button', { class: 'btn sm', onclick: () => addDialog(programme, load) }, 'Add a person') : null,
      can('participants') ? h('button', { class: 'btn sm', onclick: () => importDialog(programme, load) }, 'Import a list') : null),
    tableBox));
  load();
}

function participantTable(list, programme, reload) {
  if (!list.length) return h('div', { class: 'empty' }, h('h3', 'No one matches'), h('p', 'Add departing employees one at a time or import a list.'));
  return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `${list.length} ${list.length === 1 ? 'person' : 'people'}, listed by PartWays Interview Id. Names are not collected and interview content is never shown here.`),
    h('div', { class: 'table-wrap card flat', style: { padding: 0 } }, h('table',
      h('thead', h('tr', ['Interview Id', 'Mobile', 'Segment', 'Leaving', 'Status', 'WhatsApp invitation', 'Deadline'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', list.map((p) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => detail(p.id, programme, reload), onkeydown: (e) => { if (e.key === 'Enter') detail(p.id, programme, reload); } },
        h('td', { style: { whiteSpace: 'nowrap' } }, h('strong', { class: 'mono' }, p.interviewId), p.population === 'evaluation' ? h('span', { class: 'badge info', style: { marginLeft: '.35rem' } }, 'evaluation') : null),
        h('td', { class: 'num small', style: { whiteSpace: 'nowrap' } }, p.mobile),
        h('td', { class: 'small' }, [p.businessUnit, p.location, p.tenureBand].filter(Boolean).join(' · ')),
        h('td', { class: 'small' }, fmt.date(p.departureDate)),
        h('td', h('span', { class: `badge ${STATUS_KIND[p.status] || ''}` }, STATUS_LABEL[p.status] || p.status), p.followUp && p.followUp.status !== 'completed' ? h('span', { class: 'badge accent', style: { marginLeft: '.3rem' } }, 'Follow-up') : null),
        h('td', { class: 'small' }, INV_LABEL[p.invitation.status] || p.invitation.status, p.invitation.reminders?.length ? ` · ${p.invitation.reminders.length} reminder${p.invitation.reminders.length > 1 ? 's' : ''}` : ''),
        h('td', { class: 'small' }, fmt.date(p.invitation.deadline))))))));
}

async function detail(id, programme, reload) {
  const { participant: p } = await hr(`/api/hr/participants/${id}`);
  const timeline = [
    ['Invitation prepared', p.invitation.preparedAt], ['Invitation sent (simulated)', p.invitation.sentAt],
    ...(p.invitation.reminders || []).map((r, i) => [`Reminder ${i + 1} sent (simulated)`, r.at]),
    ['Link opened', p.invitation.openedAt], ['Responded', p.invitation.respondedAt],
    ...p.sessions.flatMap((s) => [[`${MODE_LABEL[s.initialMode] || MODE_LABEL[s.mode]} started`, s.startedAt], ['Feedback submitted', s.submittedAt], ...s.revisions.map((r) => [`Employee ${r.type === 'withdrawal' ? 'withdrew feedback' : 'corrected their summary'}`, r.at])]),
    ...p.linkRequests.map((r) => ['Asked for a new link', r.at]),
  ].filter(([, at]) => at).sort((a, b) => a[1].localeCompare(b[1]));
  const act = (label, fn, kind = '') => h('button', { class: `btn sm ${kind}`, type: 'button', onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await fn(); } catch (err) { toast(err.message, { kind: 'bad' }); } finally { btn.disabled = false; } } }, label);
  const closeAnd = async (fn) => { await fn(); d.close(); reload(); refreshProgrammes(); };
  const canSend = can('participants') && programme.status === 'active';
  const done = ['submitted', 'declined', 'withdrawn', 'cancelled'].includes(p.status);
  const d = dialog({
    title: `Interview ${p.interviewId}`, wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('span', { class: `badge ${STATUS_KIND[p.status] || ''}` }, STATUS_LABEL[p.status] || p.status), p.population === 'evaluation' ? h('span', { class: 'badge info' }, 'Added during evaluation') : p.population === 'demo' ? h('span', { class: 'badge demo' }, 'Demonstration record') : null),
      h('dl', { class: 'kv' },
        h('dt', 'Mobile (WhatsApp)'), h('dd', p.contactMobile || p.mobile, p.contactMobile ? h('span', { class: 'small muted' }, ' · shown because they asked to be contacted') : h('span', { class: 'small muted' }, ' · masked to keep feedback de-identified')), h('dt', 'Segment'), h('dd', [p.businessUnit, p.function, p.location, p.tenureBand, p.roleLevel].filter(Boolean).join(' · ') || '–'),
        h('dt', 'Leaving'), h('dd', fmt.date(p.departureDate)), h('dt', 'Preferred language'), h('dd', LANG_LABEL[p.preferredLanguage] || p.preferredLanguage),
        h('dt', 'Response deadline'), h('dd', fmt.date(p.invitation.deadline)),
        p.declineReason ? [h('dt', 'Reason for declining'), h('dd', p.declineReason)] : null),
      h('div', h('h4', 'Timeline'), timeline.length ? h('ul', { class: 'small', style: { margin: 0, paddingLeft: '1.1rem' } }, timeline.map(([t, at]) => h('li', `${fmt.dateTime(at)}: ${t}`))) : h('p', { class: 'small muted' }, 'Nothing yet.')),
      p.sessions.length ? h('div', h('h4', 'Interviews'), h('ul', { class: 'small', style: { margin: 0, paddingLeft: '1.1rem' } }, p.sessions.map((s) => h('li', `${(s.modesUsed || [s.mode]).map((m) => MODE_LABEL[m]).join(' then ')} · ${fmt.title(s.status)} · guide v${s.guideVersion ?? '–'} · ${LANG_LABEL[s.language] || s.language}`)))) : null,
      p.followUp ? followUpBox(p, () => { d.close(); reload(); }) : null,
      h('p', { class: 'small muted', style: { margin: 0 } }, 'What this person said is only available through insights, after they review and submit it, and within the reporting rules.'),
      can('participants') && !done ? h('div', { class: 'row' },
        p.invitation.status === 'prepared' && canSend ? act('Preview and send invitation', () => sendDialog(p, 'invitation', () => { d.close(); reload(); })) : null,
        p.invitation.status !== 'prepared' && canSend ? act('Send a reminder', () => sendDialog(p, 'reminder', () => { d.close(); reload(); })) : null,
        act('Extend deadline by 7 days', () => closeAnd(() => hr(`/api/hr/participants/${p.id}/extend`, { method: 'POST', body: { days: 7 } }).then(() => toast('Deadline extended.')))),
        state.org.demo ? act('Open their invitation (demo)', async () => { const m = await hr(`/api/hr/participants/${p.id}/message`); window.open(m.link, '_blank', 'noopener'); }) : null,
        act('Cancel invitation', async () => { if (await confirmDialog('Cancel this invitation?', 'The link will stop working. This cannot be undone, but you can add the person again.', { confirmLabel: 'Cancel invitation', kind: 'danger' })) await closeAnd(() => hr(`/api/hr/participants/${p.id}/cancel`, { method: 'POST' })); }, 'danger')) : null),
    actions: [{ label: 'Close' }],
  });
}

function followUpBox(p, after) {
  const note = h('input', { type: 'text', placeholder: 'Optional note, for example who will call', 'aria-label': 'Follow-up note' });
  return h('div', { class: 'card soft stack' },
    h('div', { class: 'row between' }, h('h4', { style: { margin: 0 } }, 'Follow-up request'), h('span', { class: 'badge accent' }, FU_LABEL[p.followUp.status])),
    h('p', { class: 'small', style: { margin: 0 } }, `Requested ${fmt.dateTime(p.followUp.requestedAt)}. ${p.followUp.note || ''}`),
    h('p', { class: 'small muted', style: { margin: 0 } }, `The employee asked for someone at ${state.org.shortName} to contact them. PartWays does not handle this contact.`),
    (p.followUp.history || []).length ? h('ul', { class: 'small', style: { margin: 0, paddingLeft: '1.1rem' } }, p.followUp.history.map((x) => h('li', `${fmt.dateTime(x.at)}: ${FU_LABEL[x.status]}${x.note ? `. ${x.note}` : ''}`))) : null,
    can('participants') && p.followUp.status !== 'completed' ? h('div', { class: 'row' }, note, ['acknowledged', 'scheduled', 'completed'].map((s) => h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      try { await hr(`/api/hr/participants/${p.id}/follow-up`, { method: 'POST', body: { status: s, note: note.value } }); toast(`Marked as ${FU_LABEL[s].toLowerCase()}.`); after(); } catch (err) { toast(err.message, { kind: 'bad' }); }
    } }, `Mark ${FU_LABEL[s].toLowerCase()}`))) : null);
}

async function sendDialog(p, kind, after) {
  const m = await hr(`/api/hr/participants/${p.id}/message?kind=${kind}&origin=${encodeURIComponent(location.origin)}`);
  const credits = state.me?.credits;
  const metered = kind === 'invitation' && credits && !credits.unlimited;
  const empty = metered && credits.balance < 1;
  dialog({
    title: kind === 'invitation' ? 'Send WhatsApp invitation' : 'Send WhatsApp reminder',
    body: h('div', { class: 'stack' },
      h('div', { class: 'small muted' }, `To ${m.to} via WhatsApp · `, h('span', { class: 'mono' }, m.interviewId)),
      h('div', { class: 'whatsapp' }, m.text),
      metered ? h('div', { class: `notice ${empty ? 'warn' : ''}` }, empty
        ? h('div', 'You have no credits left. ', h('a', { href: '#/billing' }, 'Buy credits'), ' to send this invitation.')
        : `Sending uses 1 credit. You have ${credits.balance}.`) : null,
      kind === 'reminder' ? h('div', { class: 'small muted' }, 'Reminders are free.') : null,
      h('div', { class: 'notice demo' }, 'WhatsApp is not connected yet, so the message is recorded as sent but not delivered.')),
    actions: [{ label: 'Cancel' }, ...(empty ? [] : [{ label: kind === 'invitation' ? 'Send invitation' : 'Send reminder', kind: 'primary', onClick: async () => {
      const r = await hr(`/api/hr/participants/${p.id}/send`, { method: 'POST', body: { kind } });
      toast(r.message);
      if (r.creditUsed) updateCredits();
      after();
    } }])],
  });
}

const FIELDS = [['mobile', 'Mobile number (WhatsApp)', 'tel', true], ['departureDate', 'Leaving date', 'date'], ['businessUnit', 'Business unit', 'text'], ['function', 'Function', 'text'], ['location', 'Location', 'text']];

function addDialog(programme, reload) {
  const v = { preferredLanguage: 'en' };
  const inputs = FIELDS.map(([k, label, type, req]) => h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `f-${k}` }, label, req ? '' : h('span', { class: 'muted' }, ' (optional)')),
    k === 'mobile' ? h('span', { class: 'hint' }, 'International format, for example +44 7700 900123. This identifies the person and receives the invitation.') : null,
    h('input', { type, id: `f-${k}`, oninput: (e) => { v[k] = e.target.value; } })));
  const sel = (k, label, opts) => h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `f-${k}` }, label), h('select', { id: `f-${k}`, onchange: (e) => { v[k] = e.target.value; } }, h('option', { value: '' }, '–'), opts.map(([a, b]) => h('option', { value: a, selected: v[k] === a }, b))));
  dialog({
    title: 'Add a departing employee', wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'small ink2', style: { margin: 0 } }, 'No name is needed. Each person gets a PartWays Interview Id, and their feedback is only ever shown under that Id.'), h('div', { class: 'grid g2' }, inputs,
      sel('tenureBand', 'Tenure band', ['Under 6 months', '6–12 months', '1–3 years', '3–5 years', '5+ years'].map((x) => [x, x])),
      sel('roleLevel', 'Role level', ['Individual contributor', 'Team lead', 'Manager', 'Senior leader'].map((x) => [x, x])),
      sel('preferredLanguage', 'Preferred language', [['en', 'English'], ['de', 'German'], ['fr', 'French']]))),
    actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async () => {
      const r = await hr('/api/hr/participants', { method: 'POST', body: { ...v, language: v.preferredLanguage, programmeId: programme.id } });
      toast(`Added as ${r.participant.interviewId}. The invitation is prepared but not sent.`);
      reload(); refreshProgrammes();
    } }],
  });
}

function importDialog(programme, reload) {
  const sample = 'mobile,business unit,function,location,tenure band,role level,departure date,language\n+44 7700 900801,Operations,Transport planning,Leeds,1–3 years,Individual contributor,2026-11-14,en\n+49 151 00900801,Sales,Account management,Berlin,3–5 years,Manager,30/11/2026,de';
  const ta = h('textarea', { rows: 8, id: 'csv', placeholder: sample, style: { fontFamily: 'ui-monospace, monospace', fontSize: '.82rem' } });
  const file = h('input', { type: 'file', accept: '.csv,text/csv,.txt', onchange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); } });
  const result = h('div');
  let validated = null;
  const d = dialog({
    title: 'Import departing employees', wide: true,
    body: h('div', { class: 'stack' },
      h('p', { class: 'small ink2', style: { margin: 0 } }, 'Paste rows or choose a CSV file. The first row must be a header with at least “mobile”. Names are not needed; a name column is ignored. Rows are checked before anything is added, and duplicates by mobile number are skipped.'),
      h('div', { class: 'row' }, file, h('button', { class: 'linkbtn small', type: 'button', onclick: () => { ta.value = sample; } }, 'Use example rows')),
      h('label', { for: 'csv', class: 'sr-only' }, 'CSV rows'), ta, result),
    actions: [{ label: 'Cancel' },
      { label: 'Check rows', onClick: async () => {
        const r = await hr('/api/hr/participants/import/validate', { method: 'POST', body: { programmeId: programme.id, csv: ta.value } });
        validated = r;
        result.replaceChildren(h('div', { class: 'stack' },
          h('div', { class: 'row small' }, h('span', { class: 'badge good' }, `${r.counts.ok} ready`), h('span', { class: 'badge warn' }, `${r.counts.warning} with warnings`), h('span', { class: 'badge bad' }, `${r.counts.error} with errors`), h('span', { class: 'badge' }, `${r.counts.duplicate} duplicates`)),
          h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', h('th', 'Row'), h('th', 'Mobile'), h('th', 'Result'))),
            h('tbody', r.rows.map((x, i) => h('tr', h('td', i + 2), h('td', { class: 'small' }, x.clean.mobile || x.input.mobile || '–'),
              h('td', { class: 'small' }, x.status === 'ok' ? 'Ready' : [...x.errors, x.duplicate, ...x.warnings].filter(Boolean).join(' '))))))),
          h('p', { class: 'small muted', style: { margin: 0 } }, 'Rows with errors or duplicates will be skipped. Fix them in your file and import again if needed.')));
        return false;
      } },
      { label: 'Import ready rows', kind: 'primary', onClick: async () => {
        if (!validated) { toast('Check the rows first.', { kind: 'bad' }); return false; }
        const r = await hr('/api/hr/participants/import/commit', { method: 'POST', body: { programmeId: programme.id, rows: validated.rows.map((x) => x.input) } });
        toast(`${r.created} added, ${r.skipped} skipped. Invitations are prepared but not sent.`);
        reload(); refreshProgrammes();
      } }],
  });
  return d;
}

export async function renderFollowUps(el) {
  setCrumbs('Follow-up requests');
  mount(el, loading());
  let list;
  try { list = (await hr('/api/hr/participants?status=follow_up')).participants; } catch (err) { return mount(el, errorBox(err, () => renderFollowUps(el))); }
  const progName = (id) => state.programmes.find((p) => p.id === id)?.name || id;
  mount(el, pageHead('Follow-up requests', `Departing employees who asked for someone at ${state.org.shortName} to contact them. These are separate from interview feedback, and are handled by your team, not by PartWays.`),
    list.length ? h('div', { class: 'stack' }, list.map((p) => h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('div', h('strong', { class: 'mono' }, p.interviewId), h('span', { class: 'small muted' }, ` · ${p.contactMobile || p.mobile} · ${progName(p.programmeId)}`)), h('button', { class: 'btn sm', onclick: async () => detail(p.id, state.programmes.find((x) => x.id === p.programmeId) || {}, () => renderFollowUps(el)) }, 'Open record')),
      followUpBox(p, () => renderFollowUps(el)))))
      : h('div', { class: 'empty' }, h('h3', 'No open follow-up requests'), h('p', 'When an employee asks to be contacted, the request appears here.')));
}
