// Participation administration: invitations by email and/or WhatsApp (to every channel a
// person has; WhatsApp is simulated until connected) and imports.
// This view is operational only: it never shows what anyone said in an interview.
import { h, mount, fmt, toast, dialog, confirmDialog, debounce } from '../lib.js';
import { state, hr, can, pageHead, STATUS_LABEL, MODE_LABEL, loading, errorBox, refreshProgrammes } from './core.js';
import { setCrumbs, updateCredits } from './app.js';
import { countryOptions } from '../countries.js';

const STATUS_KIND = { submitted: 'good', declined: '', expired: 'warn', cancelled: '', withdrawn: '', awaiting_review: 'accent', in_progress: 'info', abandoned: 'warn', invited: '', not_started: '' };
const INV_LABEL = { prepared: 'Prepared, not sent', sent: 'Sent', opened: 'Opened', responded: 'Responded', cancelled: 'Cancelled', expired: 'Expired' };

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
      h('label', 'Status', h('select', { onchange: (e) => { status = e.target.value; load(); } }, h('option', { value: '' }, 'All'), Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k }, v)))),
      state.org.demo && h('label', 'Data', h('select', { onchange: (e) => { population = e.target.value; load(); } }, h('option', { value: '' }, 'All'), h('option', { value: 'demo' }, 'Demonstration data'), h('option', { value: 'evaluation' }, 'Added during evaluation'))) || null,
      h('span', { class: 'spacer' }),
      can('participants') ? h('button', { class: 'btn sm', onclick: () => addDialog(programme, load) }, 'Add a person') : null,
      can('participants') ? h('button', { class: 'btn sm', onclick: () => importDialog(programme, load) }, 'Import a list') : null),
    tableBox));
  load();
}

const CHANNEL = { email: 'Email', whatsapp: 'WhatsApp' };
// Contact details are always masked: they are used only to send the invitation.
const contactLines = (p) => [p.email, p.mobile].filter(Boolean);
const sentWord = (simulated, channels) => `${channels?.length ? ` by ${channels.map((c) => CHANNEL[c] || c).join(' and ')}` : ''}${simulated ? ' (recorded, not delivered)' : ''}`;

function participantTable(list, programme, reload) {
  if (!list.length) return h('div', { class: 'empty' }, h('h3', 'No one matches'), h('p', 'Add departing employees one at a time or import a list.'));
  return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `${list.length} ${list.length === 1 ? 'person' : 'people'}, listed by PartWays Interview Id. Names are not collected and interview content is never shown here.`),
    h('div', { class: 'table-wrap card flat', style: { padding: 0 } }, h('table',
      h('thead', h('tr', ['Interview Id', 'Contact', 'Segment', 'Leaving', 'Status', 'Invitation', 'Deadline'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', list.map((p) => h('tr', { class: 'clickable', tabindex: '0', onclick: () => detail(p.id, programme, reload), onkeydown: (e) => { if (e.key === 'Enter') detail(p.id, programme, reload); } },
        h('td', { style: { whiteSpace: 'nowrap' } }, h('strong', { class: 'mono' }, p.interviewId), p.population === 'evaluation' ? h('span', { class: 'badge info', style: { marginLeft: '.35rem' } }, 'evaluation') : null),
        h('td', { class: 'small', style: { whiteSpace: 'nowrap' } }, contactLines(p).map((c) => h('div', c))),
        h('td', { class: 'small' }, [p.businessUnit, p.location, p.tenureBand].filter(Boolean).join(' · ')),
        h('td', { class: 'small' }, fmt.date(p.departureDate)),
        h('td', h('span', { class: `badge ${STATUS_KIND[p.status] || ''}` }, STATUS_LABEL[p.status] || p.status)),
        h('td', { class: 'small' }, INV_LABEL[p.invitation.status] || p.invitation.status, p.invitation.reminders?.length ? ` · ${p.invitation.reminders.length} reminder${p.invitation.reminders.length > 1 ? 's' : ''}` : ''),
        h('td', { class: 'small' }, fmt.date(p.invitation.deadline))))))));
}

async function detail(id, programme, reload) {
  const { participant: p } = await hr(`/api/hr/participants/${id}`);
  const timeline = [
    ['Invitation prepared', p.invitation.preparedAt],
    [`Invitation sent${sentWord(p.invitation.simulated, (p.invitation.deliveries || []).filter((x) => x.kind === 'invitation' && !x.failed).map((x) => x.channel))}`, p.invitation.sentAt],
    ...(p.invitation.reminders || []).map((r, i) => [`Reminder ${i + 1} sent${sentWord(r.simulated, r.channels)}`, r.at]),
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
        ...[['Email', p.email], ['Mobile (WhatsApp)', p.mobile]].filter(([, masked]) => masked).flatMap(([label, masked]) => [h('dt', label),
          h('dd', masked, h('span', { class: 'small muted' }, ' · masked to keep feedback de-identified'))]),
        h('dt', 'Invitations go by'), h('dd', p.invitation.channel || '–'), h('dt', 'Segment'), h('dd', [p.businessUnit, p.function, p.location, p.tenureBand, p.roleLevel].filter(Boolean).join(' · ') || '–'),
        h('dt', 'Leaving'), h('dd', fmt.date(p.departureDate)),
        h('dt', 'Response deadline'), h('dd', fmt.date(p.invitation.deadline)),
        p.declineReason ? [h('dt', 'Reason for declining'), h('dd', p.declineReason)] : null),
      h('div', h('h4', 'Timeline'), timeline.length ? h('ul', { class: 'small', style: { margin: 0, paddingLeft: '1.1rem' } }, timeline.map(([t, at]) => h('li', `${fmt.dateTime(at)}: ${t}`))) : h('p', { class: 'small muted' }, 'Nothing yet.')),
      p.sessions.length ? h('div', h('h4', 'Interviews'), h('ul', { class: 'small', style: { margin: 0, paddingLeft: '1.1rem' } }, p.sessions.map((s) => h('li', `${(s.modesUsed || [s.mode]).map((m) => MODE_LABEL[m]).join(' then ')} · ${fmt.title(s.status)} · guide v${s.guideVersion ?? '–'}`)))) : null,
      h('p', { class: 'small muted', style: { margin: 0 } }, 'What this person said is only available through insights, after they review and submit it, and only in aggregate with at least 3 people.'),
      can('participants') && !done ? h('div', { class: 'row' },
        p.invitation.status === 'prepared' && canSend ? act('Preview and send invitation', () => sendDialog(p, 'invitation', () => { d.close(); reload(); })) : null,
        p.invitation.status !== 'prepared' && canSend ? act('Send a reminder', () => sendDialog(p, 'reminder', () => { d.close(); reload(); })) : null,
        act('Extend deadline by 7 days', () => closeAnd(() => hr(`/api/hr/participants/${p.id}/extend`, { method: 'POST', body: { days: 7 } }).then(() => toast('Deadline extended.')))),
        state.org.demo ? act('Open their invitation (demo)', async () => { const m = await hr(`/api/hr/participants/${p.id}/message`); window.open(m.link, '_blank', 'noopener'); }) : null,
        act('Cancel invitation', async () => { if (await confirmDialog('Cancel this invitation?', 'The link will stop working. This cannot be undone, but you can add the person again.', { confirmLabel: 'Cancel invitation', kind: 'danger' })) await closeAnd(() => hr(`/api/hr/participants/${p.id}/cancel`, { method: 'POST' })); }, 'danger')) : null),
    actions: [{ label: 'Close' }],
  });
}

async function sendDialog(p, kind, after) {
  const m = await hr(`/api/hr/participants/${p.id}/message?kind=${kind}&origin=${encodeURIComponent(location.origin)}`);
  const credits = state.me?.credits;
  const metered = kind === 'invitation' && credits && !credits.unlimited;
  const empty = metered && credits.balance < 1;
  const preview = (x) => (x.channel === 'email'
    ? h('div', { class: 'card flat stack', style: { gap: '.4rem' } },
      h('div', { class: 'small muted' }, `Email to ${x.to}`), h('div', { class: 'small' }, h('strong', 'Subject: '), x.subject), h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, x.text))
    : h('div', { class: 'stack', style: { gap: '.4rem' } }, h('div', { class: 'small muted' }, `WhatsApp to ${x.to}`), h('div', { class: 'whatsapp', style: { overflowWrap: 'anywhere' } }, x.text)));
  const hasWhatsApp = m.messages.some((x) => x.channel === 'whatsapp');
  dialog({
    title: kind === 'invitation' ? 'Send invitation' : 'Send reminder', wide: m.messages.length > 1,
    body: h('div', { class: 'stack' },
      h('div', { class: 'small muted' }, `Goes by ${m.channel} · `, h('span', { class: 'mono' }, m.interviewId)),
      h('div', { class: m.messages.length > 1 ? 'grid g2' : 'stack' }, m.messages.map(preview)),
      metered ? h('div', { class: `notice ${empty ? 'warn' : ''}` }, empty
        ? h('div', 'You have no credits left. ', h('a', { href: '#/billing' }, 'Get more credits'), ' to send this invitation.')
        : `Sending uses 1 credit, however many channels it goes to. You have ${credits.balance}.`) : null,
      kind === 'reminder' ? h('div', { class: 'small muted' }, 'Reminders are free.') : null,
      state.org.demo
        ? h('div', { class: 'notice demo' }, 'This is the demonstration workspace, so messages are recorded as sent but not delivered.')
        : hasWhatsApp ? h('div', { class: 'notice demo' }, 'WhatsApp is not connected yet, so the WhatsApp message is recorded as sent but not delivered. Email is delivered.') : null),
    actions: [{ label: 'Cancel' }, ...(empty ? [] : [{ label: kind === 'invitation' ? 'Send invitation' : 'Send reminder', kind: 'primary', onClick: async () => {
      const r = await hr(`/api/hr/participants/${p.id}/send`, { method: 'POST', body: { kind } });
      toast(r.message || 'Sent.', { timeout: 7000 });
      if (r.creditUsed) updateCredits();
      after();
    } }])],
  });
}

const FIELDS = [['email', 'Email address', 'email'], ['mobile', 'Mobile number (WhatsApp)', 'tel'], ['departureDate', 'Leaving date', 'date'], ['businessUnit', 'Business unit', 'text'], ['function', 'Function', 'text'], ['location', 'Location', 'text']];

// A country code picker (defaulting to the organisation's country) and the number.
// A number typed with its own + or 00 prefix is kept as it is.
function mobileInput(v) {
  const codes = state.meta?.dialCodes || {};
  if (!codes.GB) return h('input', { type: 'tel', id: 'f-mobile', placeholder: '+44 7700 900123', oninput: (e) => { v.mobile = e.target.value; } });
  let country = codes[state.org?.country] ? state.org.country : 'GB';
  const number = h('input', { type: 'tel', id: 'f-mobile', autocomplete: 'tel-national', placeholder: 'Mobile number', style: { flex: '1 1 10rem', minWidth: 0 } });
  const update = () => {
    const raw = number.value.trim();
    const digits = raw.replace(/[^\d+]/g, '');
    v.mobile = !digits ? undefined
      : /^(\+|00)/.test(digits) ? raw
      : `+${codes[country]} ${digits.replace(/^0+/, '')}`;
  };
  number.addEventListener('input', update);
  const code = h('select', { 'aria-label': 'Country code', style: { flex: '0 1 9rem', minWidth: 0 }, onchange: (e) => { country = e.target.value; update(); } },
    countryOptions().filter(([c]) => codes[c]).map(([c, n]) => h('option', { value: c, selected: c === country }, `+${codes[c]} ${n}`)));
  return h('div', { class: 'row', style: { gap: '.5rem', flexWrap: 'nowrap' } }, code, number);
}

// Adding someone to an active programme sends their invitation in the same step.
function addDialog(programme, reload) {
  const v = { preferredLanguage: 'en' };
  const active = programme.status === 'active';
  const add = async (send) => {
    const r = await hr('/api/hr/participants', { method: 'POST', body: { ...v, language: v.preferredLanguage, programmeId: programme.id, send } });
    const id = r.participant.interviewId;
    if (!send) toast(`Added as ${id}. The invitation is prepared, not sent.`);
    else if (r.sendError) toast(`Added as ${id}, but the invitation was not sent: ${r.sendError}`, { kind: 'bad', timeout: 9000 });
    else { toast(`Added as ${id} and invited. ${r.message || ''}`, { timeout: 8000 }); if (r.creditUsed) updateCredits(); }
    reload(); refreshProgrammes();
  };
  const credits = state.me?.credits;
  const note = active
    ? h('div', { class: 'notice' }, `The invitation goes to every channel you add, as soon as you choose “Add and send invitation”.${credits && !credits.unlimited ? ` It uses 1 credit; you have ${credits.balance}.` : ''}`)
    : h('div', { class: 'notice warn' }, 'This programme is not active yet, so the person is added and their invitation prepared. Activate the programme to send it.');
  const inputs = FIELDS.map(([k, label, type, req]) => h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `f-${k}` }, label, req ? '' : h('span', { class: 'muted' }, ' (optional)')),
    k === 'mobile' ? mobileInput(v) : h('input', { type, id: `f-${k}`, oninput: (e) => { v[k] = e.target.value; } })));
  const sel = (k, label, opts) => h('div', { class: 'field', style: { margin: 0 } }, h('label', { for: `f-${k}` }, label), h('select', { id: `f-${k}`, onchange: (e) => { v[k] = e.target.value; } }, h('option', { value: '' }, '–'), opts.map(([a, b]) => h('option', { value: a, selected: v[k] === a }, b))));
  dialog({
    title: 'Add a departing employee', wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'small ink2', style: { margin: 0 } }, 'Add an email address, a mobile number, or both. No name is needed. Each person gets a PartWays Interview Id, and their feedback is only ever shown under that Id.'), h('div', { class: 'grid g2' }, inputs,
      sel('tenureBand', 'Tenure band', ['Under 6 months', '6–12 months', '1–3 years', '3–5 years', '5+ years'].map((x) => [x, x])),
      sel('roleLevel', 'Role level', ['Individual contributor', 'Team lead', 'Manager', 'Senior leader'].map((x) => [x, x]))), note),
    actions: [{ label: 'Cancel' },
      ...(active ? [{ label: 'Add without sending', onClick: () => add(false) }] : []),
      { label: active ? 'Add and send invitation' : 'Add', kind: 'primary', onClick: () => add(active) }],
  });
}

// Importing into an active programme sends everyone's invitation in the same step.
function importDialog(programme, reload) {
  const active = programme.status === 'active';
  const commit = async (send) => {
    if (!validated) { toast('Check the rows first.', { kind: 'bad' }); return false; }
    const r = await hr('/api/hr/participants/import/commit', { method: 'POST', body: { programmeId: programme.id, rows: validated.rows.map((x) => x.input), send } });
    toast(send
      ? `${r.created} added and ${r.sent} invited${r.notSent ? `; ${r.notSent} could not be sent and stay prepared` : ''}${r.skipped ? `. ${r.skipped} skipped` : ''}.`
      : `${r.created} added, ${r.skipped} skipped. Invitations are prepared, not sent.`, { kind: r.notSent ? 'bad' : '', timeout: 8000 });
    if (send && r.sent) updateCredits();
    reload(); refreshProgrammes();
  };
  const sample = 'email,mobile,business unit,function,location,tenure band,role level,departure date\nalex.leaver@example.com,+44 7700 900801,Operations,Transport planning,Leeds,1–3 years,Individual contributor,2026-11-14\n,+49 151 00900801,Sales,Account management,Berlin,3–5 years,Manager,30/11/2026\nsam.leaver@example.com,,Finance,Reporting,London,5+ years,Manager,2026-12-01';
  const ta = h('textarea', { rows: 8, id: 'csv', placeholder: sample, style: { fontFamily: 'ui-monospace, monospace', fontSize: '.82rem' } });
  const file = h('input', { type: 'file', accept: '.csv,text/csv,.txt', onchange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); } });
  const result = h('div');
  let validated = null;
  const d = dialog({
    title: 'Import departing employees', wide: true,
    body: h('div', { class: 'stack' },
      h('p', { class: 'small ink2', style: { margin: 0 } }, 'Paste rows or choose a CSV file. The first row must be a header with “email”, “mobile”, or both, and each row needs at least one of them. Invitations go to every one given. Names are not needed; a name column is ignored. Rows are checked before anything is added, and duplicates by email or mobile are skipped.' + (active ? ' Choosing “Import and send invitations” invites everyone straight away, using 1 credit each.' : ' This programme is not active yet, so invitations are prepared; activate it to send them.')),
      h('div', { class: 'row' }, file, h('button', { class: 'linkbtn small', type: 'button', onclick: () => { ta.value = sample; } }, 'Use example rows')),
      h('label', { for: 'csv', class: 'sr-only' }, 'CSV rows'), ta, result),
    actions: [{ label: 'Cancel' },
      { label: 'Check rows', onClick: async () => {
        const r = await hr('/api/hr/participants/import/validate', { method: 'POST', body: { programmeId: programme.id, csv: ta.value } });
        validated = r;
        result.replaceChildren(h('div', { class: 'stack' },
          h('div', { class: 'row small' }, h('span', { class: 'badge good' }, `${r.counts.ok} ready`), h('span', { class: 'badge warn' }, `${r.counts.warning} with warnings`), h('span', { class: 'badge bad' }, `${r.counts.error} with errors`), h('span', { class: 'badge' }, `${r.counts.duplicate} duplicates`)),
          h('div', { class: 'table-wrap' }, h('table', h('thead', h('tr', h('th', 'Row'), h('th', 'Contact'), h('th', 'Result'))),
            h('tbody', r.rows.map((x, i) => h('tr', h('td', i + 2), h('td', { class: 'small' }, [x.clean.email || x.input.email, x.clean.mobile || x.input.mobile].filter(Boolean).join(' · ') || '–'),
              h('td', { class: 'small' }, x.status === 'ok' ? 'Ready' : [...x.errors, x.duplicate, ...x.warnings].filter(Boolean).join(' '))))))),
          h('p', { class: 'small muted', style: { margin: 0 } }, 'Rows with errors or duplicates will be skipped. Fix them in your file and import again if needed.')));
        return false;
      } },
      ...(active ? [{ label: 'Import without sending', onClick: () => commit(false) }] : []),
      { label: active ? 'Import and send invitations' : 'Import ready rows', kind: 'primary', onClick: () => commit(active) }],
  });
  return d;
}
