// Employee interview app: invitation → format → (preparation) → conversation → review → submitted.
import { h, mount, api, streamApi, toast, dialog, confirmDialog, fmt, store, icon, watchForUpdates } from '../lib.js';
import { t, setLang, getLang } from '../i18n.js';
import { Speaker, Listener, SentenceSplitter, micCheck, voiceSupport, silenceLeftoverSpeech } from '../voice.js';
import { RealtimeConversation, realtimeSupported } from '../realtime.js';

silenceLeftoverSpeech();
watchForUpdates({ message: () => t('updateAvailable'), note: () => t('updateNote'), reload: () => t('reload'), later: () => t('later') });
const app = document.getElementById('app');
let config = null;
let ctx = { invite: null, token: null, session: null, sessionToken: null, programme: null };
const vars = () => ({ org: ctx.programme?.org?.shortName || 'the organisation', team: `${ctx.programme?.org?.shortName || 'the'} People Team` });
const tv = (k, extra = {}) => t(k, { ...vars(), ...extra });

function shell(...content) {
  const prog = ctx.programme;
  if (prog?.org?.brandColor) document.documentElement.style.setProperty('--brand', prog.org.brandColor);
  const langs = prog?.languages || [];
  return [
    prog?.org?.demo ? h('div', { class: 'demo-strip' }, t('demo')) : null,
    h('header', { class: 'topbar' },
      h('div', { class: 'who' },
        h('span', { class: 'pw-mark' }, h('span', { class: 'dot', 'aria-hidden': 'true' }, 'P'), 'PartWays', h('span', { class: 'muted small', style: { fontWeight: 500 } }, ' · independent exit interviews')),
        prog ? h('span', { class: 'org-chip' }, h('span', { class: 'sw', 'aria-hidden': 'true' }), `${t('for')} ${prog.org.name}`) : null),
      h('div', { class: 'row', style: { gap: '.4rem' } },
        langs.length > 1 ? h('label', { class: 'sr-only', for: 'langsel' }, t('language')) : null,
        langs.length > 1 ? h('select', { id: 'langsel', style: { width: 'auto', minHeight: '34px', padding: '.2rem .5rem' }, onchange: (e) => { setLang(e.target.value); store.set('pw.lang', e.target.value); route(); } },
          langs.map((l) => h('option', { value: l.code, selected: l.code === getLang() }, l.native))) : null)),
    h('main', { id: 'main', class: 'wrap', tabindex: '-1' }, ...content),
  ];
}

function render(...content) {
  mount(app, ...shell(...content));
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function errorView(message) {
  render(h('div', { class: 'hero' }, h('h1', 'We could not open this page'), h('p', message), h('button', { class: 'btn', onclick: () => location.reload() }, t('retry'))));
}

async function route() {
  const hash = location.hash.slice(1);
  try {
    config ||= await api('/api/public/config');
    let m;
    if ((m = hash.match(/^\/i\/([a-z0-9]+)/))) {
      ctx.token = m[1];
      ctx.invite = await api(`/api/invite/${ctx.token}`);
      ctx.programme = ctx.invite.programme;
      const saved = store.get('pw.lang');
      setLang(ctx.programme.languages.some((l) => l.code === saved) ? saved : ctx.invite.participant.preferredLanguage);
      api(`/api/invite/${ctx.token}/open`, { method: 'POST' }).catch(() => {});
      return inviteScreen();
    }
    if ((m = hash.match(/^\/s\/([a-z0-9_]+)\?t=([a-z0-9]+)/))) {
      ctx.sessionToken = m[2];
      await loadSession(m[1]);
      return sessionScreen();
    }
    render(h('div', { class: 'hero' }, h('h1', 'PartWays'), h('p', 'Open the personal link from your invitation message to begin.')));
  } catch (err) {
    errorView(err.message);
  }
}

async function loadSession(id) {
  const r = await api(`/api/session/${id}`, { headers: { 'x-session-token': ctx.sessionToken } });
  ctx.session = r.session;
  ctx.programme ||= r.programme;
  if (!ctx.invite) setLang(r.session.language);
  return r.session;
}

function sessionScreen() {
  const s = ctx.session;
  if (['in_progress', 'paused'].includes(s.status)) return s.mode === 'ai_voice' ? prepScreen({ resume: true }) : conversationScreen({ voice: false, resume: s.transcript.length > 0 });
  if (['awaiting_review', 'draft'].includes(s.status)) return reviewScreen();
  if (s.status === 'submitted') return s.pendingCorrection ? reviewScreen() : submittedScreen();
  if (s.status === 'withdrawn') return render(h('div', { class: 'hero' }, h('h1', t('withdrawn'))));
  return render(h('div', { class: 'hero' }, h('h1', t('stFinished'))));
}

// --- Invitation ------------------------------------------------------------

// The only identifier the employee's feedback carries. Shown so they can quote it if they contact the People Team.
function interviewIdBadge(id) {
  return id ? h('span', { class: 'badge info', title: t('interviewIdHint') }, `${t('interviewId')}: `, h('strong', { class: 'mono' }, id)) : null;
}

function inviteScreen() {
  const inv = ctx.invite;
  const p = ctx.programme;
  const st = inv.state;
  const title = (k, body, ...extra) => render(h('div', { class: 'hero' }, h('h1', tv(k)), h('p', { class: 'ink2' }, tv(body)), ...extra));
  if (st === 'cancelled' || st === 'inactive') return title('cancelled', 'cancelledBody');
  if (st === 'withdrawn') return title('withdrawn', 'whatNext');
  if (st === 'expired') {
    return title('expired', 'expiredBody', h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; await api(`/api/invite/${ctx.token}/new-link`, { method: 'POST' }); toast(t('linkRequested')); } }, t('requestLink')));
  }
  if (st === 'completed') {
    ctx.sessionToken = inv.submitted.accessToken;
    return loadSession(inv.submitted.id).then(() => submittedScreen());
  }
  if (st === 'declined') {
    return title('declined', 'declinedBody', h('button', { class: 'btn', onclick: () => formatScreen() }, t('changeMind')));
  }
  if (st === 'resume' && inv.session) {
    ctx.sessionToken = inv.session.accessToken;
    return render(
      h('div', { class: 'hero' }, h('h1', t('resumeTitle')), h('p', { class: 'ink2' }, t('resumeBody'))),
      h('button', { class: 'btn primary lg', onclick: async () => { await loadSession(inv.session.id); sessionScreen(); } }, ['awaiting_review', 'draft'].includes(inv.session.status) ? t('reviewDraft') : t('resumeBtn')),
    );
  }
  const minutes = p.durations.find((d) => d.id === 'standard')?.minutes || p.durations[0].minutes;
  render(
    h('section', { class: 'hero' },
      h('p', { class: 'muted', style: { marginBottom: '.25rem' } }, p.name),
      h('h1', t('thanks')),
      h('p', { class: 'ink2' }, tv('independent')),
      h('p', { class: 'ink2' }, p.intro),
      h('p', { class: 'row', style: { gap: '.4rem' } }, h('span', { class: 'badge' }, t('about', { min: minutes })), interviewIdBadge(inv.participant.interviewId))),
    h('ol', { class: 'steps' }, t('steps').map((s) => h('li', s))),
    h('details', { class: 'card flat', style: { margin: '1rem 0' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('howUsed')),
      h('p', { style: { marginTop: '.6rem' } }, p.feedbackNotice),
      h('p', { class: 'muted small' }, `${t('language')}: ${p.languages.map((l) => l.native).join(', ')}`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary lg', onclick: () => formatScreen() }, t('begin')),
      h('button', { class: 'btn ghost', onclick: declineDialog }, t('decline'))),
    !config.llm.live ? h('p', { class: 'notice warn', style: { marginTop: '1.5rem' } }, t('offline')) : null,
  );
}

function declineDialog() {
  const reason = h('textarea', { id: 'dr', rows: 3 });
  dialog({
    title: t('declineTitle'),
    body: h('div', { class: 'field' }, h('label', { for: 'dr' }, t('declineReason')), reason),
    actions: [{ label: t('cancel') }, { label: t('declineConfirm'), kind: 'primary', onClick: async () => { await api(`/api/invite/${ctx.token}/decline`, { method: 'POST', body: { reason: reason.value } }); ctx.invite.state = 'declined'; inviteScreen(); } }],
  });
}

// --- Format choice ---------------------------------------------------------

function formatScreen() {
  const p = ctx.programme;
  const choice = { mode: null, duration: p.durations.some((d) => d.id === 'standard') ? 'standard' : p.durations[0].id, focusTopics: [] };
  const opts = [
    p.modes.includes('ai_voice') && { id: 'ai_voice', title: t('fmtVoice'), desc: t('fmtVoiceDesc') },
    p.modes.includes('ai_text') && { id: 'ai_text', title: t('fmtText'), desc: t('fmtTextDesc') },
  ].filter(Boolean);
  const cards = opts.map((o) => h('button', { class: 'choice', type: 'button', 'aria-pressed': 'false', onclick: (e) => {
    choice.mode = o.id;
    cards.forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
    go.disabled = false;
  } }, h('strong', o.title), h('span', { class: 'ink2 small' }, o.desc)));
  const durBtns = p.durations.map((d) => h('button', { type: 'button', 'aria-pressed': String(d.id === choice.duration), onclick: (e) => {
    choice.duration = d.id;
    durBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
  } }, `${t(`lengths.${d.id}`)} · ${t('minutes', { m: d.minutes })}`));
  const chips = p.topics.map((tp) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    if (on && choice.focusTopics.length >= 3) return toast('Choose up to three.');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    choice.focusTopics = on ? [...choice.focusTopics, tp.id] : choice.focusTopics.filter((x) => x !== tp.id);
  } }, tp.label));
  const extras = h('div', { class: 'stack', style: { marginTop: '1.25rem' } },
    h('div', h('p', { style: { fontWeight: 600, marginBottom: '.4rem' } }, t('length')), h('div', { class: 'seg', role: 'group' }, durBtns)),
    h('div', h('p', { style: { fontWeight: 600, marginBottom: '.4rem' } }, t('topics')), h('div', { class: 'chips' }, chips)));
  const go = h('button', { class: 'btn primary lg', disabled: true, onclick: async () => {
    go.disabled = true;
    try {
      const r = await api(`/api/invite/${ctx.token}/session`, { method: 'POST', body: { ...choice, language: getLang(), initialMode: choice.mode } });
      ctx.sessionToken = r.accessToken;
      await loadSession(r.id);
      if (choice.mode === 'ai_voice') prepScreen({}); else conversationScreen({ voice: false });
    } catch (err) { toast(err.message, { kind: 'bad' }); go.disabled = false; }
  } }, t('continue'));
  render(
    h('div', { class: 'hero' }, h('h1', t('chooseFormat')), h('p', { class: 'ink2' }, t('chooseFormatHint'))),
    h('div', { class: 'choice-grid', role: 'group', 'aria-label': t('chooseFormat') }, cards),
    extras,
    h('div', { class: 'row', style: { marginTop: '1.5rem' } }, h('button', { class: 'btn', onclick: inviteScreen }, t('back')), go),
  );
}

// --- Audio preparation -----------------------------------------------------

function prepScreen({ resume = false }) {
  const support = voiceSupport(config);
  const s = ctx.session;
  let stopMeter = null;
  let heard = false;
  const meterBar = h('span');
  const micMsg = h('p', { class: 'small ink2', role: 'status' }, '');
  const voiceSel = { voice: s.voice || config.voice.voices[0].id, style: s.voiceStyle || 'balanced' };
  // Live voice needs only WebRTC and a microphone; the standard voice needs browser speech support.
  const voiceReady = (config.voice.realtime && realtimeSupported()) || support.ok;
  const cleanup = () => { stopMeter?.(); stopMeter = null; };
  const toText = async () => {
    cleanup();
    await api(`/api/session/${s.id}/event`, { method: 'POST', body: { type: 'mode_text' }, headers: { 'x-session-token': ctx.sessionToken } }).catch(() => {});
    ctx.session.mode = 'ai_text';
    conversationScreen({ voice: false, resume });
  };
  const testMic = async () => {
    cleanup();
    micMsg.textContent = t('prepMicSpeak');
    try {
      stopMeter = await micCheck((lvl) => {
        meterBar.style.width = `${Math.round(lvl * 100)}%`;
        if (lvl > 0.18 && !heard) { heard = true; micMsg.textContent = t('prepMicOk'); }
      });
    } catch (err) {
      micMsg.replaceChildren(h('span', { class: 'notice bad' }, err.name === 'NotFoundError' ? t('prepMicNone') : t('prepMicDenied')));
    }
  };
  const voiceBtns = config.voice.voices.map((v) => h('button', { type: 'button', 'aria-pressed': String(v.id === voiceSel.voice), onclick: (e) => { voiceSel.voice = v.id; voiceBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, v.label));
  const styleBtns = ['balanced', 'warm', 'brief'].map((st) => h('button', { type: 'button', 'aria-pressed': String(st === voiceSel.style), onclick: (e) => { voiceSel.style = st; styleBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t(`styles.${st}`)));
  const sample = () => {
    const sp = new Speaker({ config, lang: getLang(), voice: voiceSel.voice, sessionId: 'sample', token: '' });
    sp.say(getLang() === 'de' ? 'Hallo, ich bin der KI-Interviewer von PartWays.' : getLang() === 'fr' ? "Bonjour, je suis l'intervieweur IA de PartWays." : "Hello, I'm the PartWays AI interviewer.");
  };
  render(
    h('div', { class: 'hero' }, h('h1', t('prepTitle'))),
    !voiceReady ? h('div', { class: 'notice warn' }, icon('warn'), t('needVoice')) : null,
    h('div', { class: 'card stack' },
      h('h3', t('prepMic')),
      h('div', { class: 'meter', role: 'meter', 'aria-label': t('prepMic') }, meterBar), micMsg,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: testMic }, t('prepMicTest')))),
    h('div', { class: 'card stack', style: { marginTop: '1rem' } },
      h('h3', t('prepSound')),
      h('div', { class: 'seg', role: 'group', 'aria-label': t('prepSound') }, voiceBtns),
      // The live interviewer's voice cannot be previewed with the browser's speech engine.
      config.voice.realtime && realtimeSupported() ? null : h('div', h('button', { class: 'btn sm', onclick: sample }, t('prepPlay'))),
      h('h3', { style: { marginTop: '.5rem' } }, t('prepStyle')),
      h('div', { class: 'seg', role: 'group', 'aria-label': t('prepStyle') }, styleBtns),
      h('p', { class: 'muted small' }, config.voice.retention.stt)),
    h('div', { class: 'row', style: { marginTop: '1.5rem' } },
      h('button', { class: 'btn primary lg', disabled: !voiceReady, onclick: () => { cleanup(); conversationScreen({ voice: true, resume, voiceSel }); } }, resume ? t('resumeBtn') : t('start')),
      h('button', { class: 'btn ghost', onclick: toText }, t('useText'))),
  );
}

// --- Conversation ----------------------------------------------------------

function conversationScreen({ voice, resume = false, voiceSel = null }) {
  const s = ctx.session;
  const headers = { 'x-session-token': ctx.sessionToken };
  const durMax = { quick: 7, standard: 15, in_depth: 25 }[s.duration] * 60000;
  const st = { state: 'thinking', voice, muted: false, paused: false, transcriptOpen: !voice, busy: false, activeMs: s.activeMs || 0, lastTick: Date.now(),
    silenceTimer: null, pausePrompted: false, extendAsked: false, ended: s.phase === 'ended', lastQuestion: '' };
  let speaker = null;
  let listener = null;
  // Live voice (OpenAI Realtime) when available; otherwise the standard voice pipeline.
  let rt = null;
  let rtSpeaking = false;

  const statusEl = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const qEl = h('div', { class: 'current-q', 'aria-live': 'polite' });
  const liveEl = h('div', { class: 'live-you' });
  const topicsEl = h('div', { class: 'topics', 'aria-label': t('topicsHeading') });
  // Topics fold into one line so the question stays at the top of the screen.
  const topicsSummary = h('summary');
  const topicsBox = h('details', { class: 'topics-box' }, topicsSummary, topicsEl);
  const chatEl = h('div', { class: 'chat', role: 'log', 'aria-live': 'polite' });
  const noticeEl = h('div', { class: 'stack' });
  const input = h('textarea', { rows: 2, placeholder: t('typeHere'), 'aria-label': t('typeHere'), onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } } });
  const composer = h('div', { class: 'composer' }, input, h('button', { class: 'btn primary', onclick: () => sendText() }, t('send')));
  const transcriptPanel = h('div', { class: 'transcript-panel', hidden: true });

  const labels = { listening: 'stListening', speaking: 'stSpeaking', thinking: 'stThinking', paused: 'stPaused', muted: 'stMuted', reconnecting: 'stReconnecting', finished: 'stFinished', your_turn: 'stYourTurn' };
  function setState(x) {
    st.state = x;
    statusEl.dataset.state = x;
    statusEl.replaceChildren(h('span', { class: 'light', 'aria-hidden': 'true' }), t(labels[x]));
    renderControls();
  }
  // Active interview time excludes pauses.
  const ticker = setInterval(() => {
    const now = Date.now();
    if (!st.paused && !st.ended) st.activeMs += now - st.lastTick;
    st.lastTick = now;
    if (!st.extendAsked && st.activeMs > durMax && !st.ended) { st.extendAsked = true; askExtend(); }
  }, 1000);
  window.addEventListener('hashchange', () => cleanupAll(), { once: true });
  window.addEventListener('pagehide', () => cleanupAll(), { once: true });

  function renderTopics(topics) {
    const done = topics.filter((tp) => tp.status !== 'pending').length;
    topicsSummary.textContent = `${t('topicsHeading')} · ${t('topicsProgress', { done, total: topics.length })}`;
    topicsEl.replaceChildren(...topics.map((tp) => {
      const label = { explored: t('topicDone'), insufficient: t('topicDone'), skipped: t('topicSkipped'), declined: t('topicDeclined'), pending: t('topicNext') }[tp.status];
      return h('span', { class: `t ${tp.status}`, title: label }, tp.label, h('span', { class: 'sr-only' }, ` (${label})`));
    }));
  }
  function renderChat() {
    chatEl.replaceChildren(...ctx.session.transcript.map((turn) => h('div', { class: `msg ${turn.role}` },
      h('div', { class: 'meta' }, turn.role === 'employee' ? t('you') : t('interviewer'), turn.corrected ? ` · ${t('corrected')}` : ''),
      turn.text,
      turn.role === 'employee' ? h('div', h('button', { class: 'linkbtn small', onclick: () => correctTurn(turn) }, t('correct'))) : null)));
    transcriptPanel.replaceChildren(chatEl);
    transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
    keepInView();
  }
  // Keeps the interviewer's latest words on screen: the question in voice mode,
  // the end of the conversation (just above the typing box) in text mode.
  // A short timer rather than an animation frame, which some browsers pause in the background.
  let viewTimer = 0;
  function keepInView() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      if (st.voice && !st.transcriptOpen) qEl.scrollIntoView({ block: 'nearest' });
      else window.scrollTo({ top: document.documentElement.scrollHeight });
    }, 30);
  }
  function correctTurn(turn) {
    const ta = h('textarea', { rows: 4 }, turn.text);
    dialog({ title: t('correctTitle'), body: ta, actions: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => {
      const r = await api(`/api/session/${s.id}/correct-turn`, { method: 'POST', body: { turnId: turn.id, text: ta.value }, headers });
      ctx.session = r.session; renderChat();
    } }] });
  }

  const ctlBtn = (label, onclick, opts = {}) => h('button', { class: `btn ${opts.kind || ''}`, type: 'button', onclick, disabled: !!opts.disabled, 'aria-pressed': opts.pressed == null ? null : String(opts.pressed) }, opts.icon ? icon(opts.icon) : null, label);
  const controls = h('div', { class: 'controls' });
  // While the conversation runs: the typing box (text) or Mute/Type (voice), plus small
  // helpers. Once the interviewer has closed the conversation, only Finish remains.
  function renderControls() {
    if (st.ended) {
      controls.replaceChildren(h('div', { class: 'main' }, h('span', { class: 'spacer' }), ctlBtn(t('finish'), finish, { kind: 'primary lg' })));
      transcriptPanel.hidden = false;
      return;
    }
    // replaceChildren would print a missing (null) part as the text "null".
    controls.replaceChildren(...[
      st.voice ? null : composer,
      st.voice ? h('div', { class: 'main' },
        ctlBtn(st.muted ? t('unmute') : t('mute'), toggleMute, { icon: st.muted ? 'micOff' : 'mic', pressed: st.muted }),
        ctlBtn(t('type'), switchToText)) : null,
      h('div', { class: 'secondary' },
        ctlBtn(t('repeat'), () => (rt ? rt.prompt('(The employee pressed "Repeat question". Repeat your last question briefly, in other words if helpful.)') : send({ event: 'repeat' })), { kind: 'ghost sm', disabled: st.busy }),
        ctlBtn(t('skip'), () => (rt ? rt.prompt('(The employee pressed "Skip topic". Acknowledge without comment and move to a different topic.)') : send({ event: 'skip_topic' })), { kind: 'ghost sm', disabled: st.busy }),
        ctlBtn(st.transcriptOpen ? t('hideTranscript') : t('transcript'), () => { st.transcriptOpen = !st.transcriptOpen; transcriptPanel.hidden = !st.transcriptOpen; renderControls(); }, { kind: 'ghost sm' })),
    ].filter(Boolean));
    if (!st.voice) transcriptPanel.hidden = false;
  }

  function startListening() {
    if (!st.voice || st.muted || st.paused || st.ended) return;
    if (!listener) {
      listener = new Listener({
        config, lang: s.language, sessionId: s.id, token: ctx.sessionToken,
        onSpeechStart: (txt) => {
          // Barge-in: stop the interviewer when the employee clearly starts speaking.
          if (speaker?.speaking && txt.split(/\s+/).length >= 2 && !speaker.spokenText.toLowerCase().includes(txt.toLowerCase().slice(0, 20))) {
            speaker.stop();
            setState('listening');
          }
          clearTimeout(st.silenceTimer);
        },
        onInterim: (txt) => { if (!speaker?.speaking) liveEl.textContent = txt || ''; },
        onTurn: (txt) => { if (speaker?.speaking) return; liveEl.textContent = ''; send({ text: txt, via: 'voice' }); },
        onError: (kind) => audioFailure(kind),
        onState: () => {},
      });
      listener.start();
    }
    setState('listening');
    armSilence();
  }
  function stopListening() { listener?.stop(); listener = null; }
  function armSilence() {
    clearTimeout(st.silenceTimer);
    if (st.pausePrompted) return;
    st.silenceTimer = setTimeout(() => {
      if (st.state === 'listening' && !st.busy) { st.pausePrompted = true; send({ event: 'long_pause' }); }
    }, 30000);
  }

  function audioFailure(kind) {
    stopListening();
    speaker?.stop();
    setState('reconnecting');
    api(`/api/session/${s.id}/event`, { method: 'POST', body: { type: 'audio_failure', detail: kind, activeMs: st.activeMs }, headers }).catch(() => {});
    noticeEl.replaceChildren(h('div', { class: 'notice bad' }, icon('warn'), h('div',
      h('p', kind === 'denied' ? t('prepMicDenied') : t('audioLost')),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => { noticeEl.replaceChildren(); startListening(); } }, t('retry')),
        h('button', { class: 'btn sm', onclick: switchToText }, t('useText'))))));
  }

  async function switchToText() {
    stopLive();
    stopListening();
    speaker?.stop();
    st.voice = false;
    st.transcriptOpen = true;
    noticeEl.replaceChildren();
    await api(`/api/session/${s.id}/event`, { method: 'POST', body: { type: 'mode_text', activeMs: st.activeMs }, headers }).catch(() => {});
    ctx.session.mode = 'ai_text';
    setState('your_turn');
    renderChat();
    input.focus();
  }

  function toggleMute() {
    st.muted = !st.muted;
    api(`/api/session/${s.id}/event`, { method: 'POST', body: { type: st.muted ? 'mute' : 'unmute' }, headers }).catch(() => {});
    if (rt) { rt.mute(st.muted); setState(st.muted ? 'muted' : rtSpeaking ? 'speaking' : 'listening'); return; }
    if (st.muted) { stopListening(); setState('muted'); } else startListening();
  }

  // --- Live voice -------------------------------------------------------------
  async function startLive() {
    setState('thinking');
    let reply = '';
    rt = new RealtimeConversation({
      keyUrl: `/api/session/${s.id}/realtime`, headers, body: { voice: voiceSel?.voice, style: voiceSel?.style },
      onAssistantDelta: (d) => { reply += d; qEl.textContent = reply; keepInView(); },
      onAssistantTurn: (text, at) => { reply = ''; qEl.textContent = text; saveLiveTurn('interviewer', text, at); },
      onUserTurn: (text, at) => { liveEl.textContent = ''; saveLiveTurn('employee', text, at); },
      onSpeaking: (on) => {
        rtSpeaking = on;
        if (st.ended) { if (!on) setState('finished'); return; }
        setState(on ? 'speaking' : st.muted ? 'muted' : 'listening');
      },
      onUserSpeaking: (on) => { if (on && !st.ended && !st.muted) setState('listening'); },
      onError: () => liveFailed(),
    });
    try { await rt.start(); } catch (err) { liveFailed(err); }
  }
  function stopLive() { rt?.stop(); rt = null; rtSpeaking = false; }
  async function saveLiveTurn(role, text, at) {
    ctx.session.transcript.push({ id: `tmp${Date.now()}`, role, text });
    renderChat();
    try {
      const r = await api(`/api/session/${s.id}/realtime/turn`, { method: 'POST', body: { role, text, at, activeMs: st.activeMs }, headers });
      if (r.topics) renderTopics(r.topics);
      if (r.seriousConcern) showConcern();
      if (r.phase === 'ended' && !st.ended) endConversation();
    } catch { /* keep the conversation going; this turn may be missing from the saved transcript */ }
  }
  // Live voice could not start or dropped: carry on with the standard voice.
  function liveFailed() {
    if (!rt) return;
    stopLive();
    if (st.ended) return;
    noticeEl.replaceChildren(h('div', { class: 'notice' }, icon('info'), h('p', { style: { margin: 0 } }, t('liveFallback'))));
    setTimeout(() => noticeEl.replaceChildren(), 6000);
    send({ event: ctx.session.transcript.length ? 'resume' : 'start' });
  }

  function sendText() {
    const text = input.value.trim();
    if (!text || st.busy) return;
    input.value = '';
    send({ text, via: 'text' });
  }

  async function send({ text, event, via }) {
    if (st.busy || st.ended) return;
    if (st.paused) { st.paused = false; noticeEl.replaceChildren(); }
    st.busy = true;
    stopListening();
    clearTimeout(st.silenceTimer);
    if (text) { st.pausePrompted = false; ctx.session.transcript.push({ id: `tmp${Date.now()}`, role: 'employee', text }); renderChat(); }
    setState('thinking');
    let reply = '';
    const splitter = st.voice ? new SentenceSplitter((sentence) => speaker.say(sentence)) : null;
    if (st.voice) {
      speaker ||= new Speaker({ config, lang: s.language, voice: voiceSel?.voice || s.voice, sessionId: s.id, token: ctx.sessionToken });
      speaker.onstart = () => setState('speaking');
      speaker.onend = () => { if (!st.busy && !st.paused && !st.ended) startListening(); };
    }
    const live = h('div', { class: 'msg interviewer' }, h('div', { class: 'meta' }, t('interviewer')), '');
    if (!st.voice) chatEl.append(live);
    let failed = null;
    let done = null;
    try {
      await streamApi(`/api/session/${s.id}/turn`, { text, event, via, activeMs: st.activeMs }, headers, (m) => {
        if (m.t === 'delta') {
          reply += m.text;
          qEl.textContent = reply || '';
          live.lastChild.textContent = reply;
          keepInView();
          splitter?.push(m.text);
        } else if (m.t === 'done') done = m;
        else if (m.t === 'error') failed = m.message;
      });
    } catch (err) {
      failed = err.message;
    }
    splitter?.flush();
    st.busy = false;
    if (failed) {
      setState(st.voice ? 'reconnecting' : 'your_turn');
      noticeEl.replaceChildren(h('div', { class: 'notice bad' }, icon('warn'), h('div', h('p', failed), h('button', { class: 'btn sm', onclick: () => { noticeEl.replaceChildren(); send({ event: 'resume' }); } }, t('retry')))));
      await refresh();
      return;
    }
    await refresh();
    if (done?.seriousConcern) showConcern();
    if (done?.phase === 'ended') { endConversation(); return; }
    if (!st.voice) { setState('your_turn'); input.focus(); } else if (!speaker?.speaking) startListening();
  }

  // The interviewer has closed the conversation: once it stops speaking, only Finish remains.
  function endConversation() {
    st.ended = true;
    const finishWhenQuiet = () => { setState('finished'); stopListening(); stopLive(); };
    if (rt && rtSpeaking) rt.onSpeaking = (on) => { if (!on) finishWhenQuiet(); };
    else if (speaker?.speaking) speaker.onend = finishWhenQuiet;
    else finishWhenQuiet();
    noticeEl.replaceChildren(h('div', { class: 'notice good' }, icon('check'), h('p', { style: { margin: 0 } }, t('stFinished'))));
    renderControls();
  }

  async function refresh() {
    try { await loadSession(s.id); } catch { /* keep current view */ }
    renderTopics(ctx.session.topics);
    renderChat();
    const last = [...ctx.session.transcript].reverse().find((x) => x.role === 'interviewer');
    if (last) qEl.textContent = last.text || '';
  }

  function showConcern() {
    noticeEl.replaceChildren(h('div', { class: 'notice' }, icon('info'), h('div', h('p', tv('concern')))));
  }

  function askExtend() {
    noticeEl.replaceChildren(h('div', { class: 'notice' }, icon('info'), h('div', h('p', t('extendAsk')), h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { noticeEl.replaceChildren(); api(`/api/session/${s.id}/event`, { method: 'POST', body: { type: 'extend' }, headers }); } }, t('continue')),
      h('button', { class: 'btn sm primary', onclick: () => { noticeEl.replaceChildren(); send({ event: 'finish' }); } }, t('finish'))))));
  }

  async function finish() {
    if (!st.ended) {
      const ok = await confirmDialog(t('finish'), t('finishConfirm'), { confirmLabel: t('finish') });
      if (!ok) return;
    }
    cleanupAll();
    render(h('div', { class: 'hero', role: 'status' }, h('p', h('span', { class: 'spinner' }), ' ', t('preparing'))));
    try {
      await api(`/api/session/${s.id}/finish`, { method: 'POST', body: { activeMs: st.activeMs }, headers });
      await loadSession(s.id);
      reviewScreen();
    } catch (err) {
      render(h('div', { class: 'hero' }, h('p', { class: 'notice bad' }, err.message), h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: finish }, t('retry')),
        h('button', { class: 'btn', onclick: () => conversationScreen({ voice: false, resume: true }) }, t('back')))));
    }
  }
  function cleanupAll() { stopLive(); stopListening(); speaker?.stop(); clearInterval(ticker); clearTimeout(st.silenceTimer); }

  render(
    ctx.session.preview ? h('div', { class: 'notice demo', style: { marginTop: '.5rem' } }, t('previewBanner')) : null,
    !config.llm.live ? h('div', { class: 'notice warn', style: { marginTop: '.5rem' } }, t('offline')) : null,
    h('div', { class: `convo ${st.voice ? 'voice' : 'text'}` },
      h('div', { class: 'convo-head' }, statusEl, topicsBox),
      h('div', { class: 'stage' }, st.voice ? qEl : null, st.voice ? liveEl : null, noticeEl, transcriptPanel),
      controls),
  );
  renderTopics(ctx.session.topics);
  renderChat();
  transcriptPanel.hidden = st.voice && !st.transcriptOpen;
  setState(st.voice ? 'thinking' : 'your_turn');
  const hasTurns = ctx.session.transcript.length > 0;
  if (st.ended) setState('finished');
  else if (st.voice && config.voice.realtime && realtimeSupported()) startLive();
  else if (!hasTurns) send({ event: 'start' });
  else if (resume || s.status === 'paused') send({ event: 'resume' });
  else if (st.voice) startListening();
}

// --- Review ------------------------------------------------------------------

function reviewScreen() {
  const s = ctx.session;
  const headers = { 'x-session-token': ctx.sessionToken };
  const correcting = s.status === 'submitted' && s.pendingCorrection;
  const sum = structuredClone(s.summary || { points: [], factors: [] });
  let dirty = false;
  const markDirty = () => { dirty = true; saveState.textContent = ''; autosave(); };
  const saveState = h('span', { class: 'muted small', role: 'status' });
  let saveTimer;
  const autosave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); };
  async function save() {
    if (!dirty) return;
    try { await api(`/api/session/${s.id}/summary`, { method: 'PUT', body: { summary: sum }, headers }); dirty = false; saveState.textContent = `${t('save')} ✓`; }
    catch (err) { saveState.textContent = err.message; }
  }

  const sectionsEl = h('div', { class: 'stack' });
  function renderPoints() {
    sectionsEl.replaceChildren(...Object.keys(s.sections).map((sec) => {
      const pts = sum.points.filter((p) => p.section === sec);
      return h('section', { class: 'card' },
        h('div', { class: 'row between' }, h('h3', t(`sections.${sec}`)),
          h('button', { class: 'btn ghost sm', onclick: () => { sum.points.push({ id: null, section: sec, text: '', themes: [], tone: 'neutral', status: 'kept', _new: true }); markDirty(); renderPoints(); } }, `+ ${t('addPoint')}`)),
        pts.length ? pts.map((p) => pointRow(p)) : h('p', { class: 'muted small' }, '—'));
    }));
  }
  function pointRow(p) {
    const editing = p._new || p._editing;
    if (p.status === 'removed') {
      return h('div', { class: 'pt removed' }, h('div', h('div', { class: 'txt' }, p.text), h('div', { class: 'small muted' }, t('removed'))),
        h('div', { class: 'tools' }, h('button', { class: 'btn sm', onclick: () => { p.status = 'kept'; markDirty(); renderPoints(); } }, t('undo'))));
    }
    if (editing) {
      const ta = h('textarea', { rows: 3, 'aria-label': t('edit') }, p.text);
      const secSel = h('select', { 'aria-label': t('moveTo') }, Object.keys(s.sections).map((k) => h('option', { value: k, selected: k === p.section }, t(`sections.${k}`))));
      setTimeout(() => ta.focus(), 0);
      return h('div', { class: 'pt' }, h('div', { class: 'stack' }, ta, h('label', { class: 'small' }, t('moveTo'), secSel)),
        h('div', { class: 'tools' },
          h('button', { class: 'btn sm primary', onclick: () => {
            if (!ta.value.trim()) { sum.points = sum.points.filter((x) => x !== p); } else { p.text = ta.value.trim(); p.section = secSel.value; }
            delete p._new; delete p._editing; markDirty(); renderPoints();
          } }, t('save')),
          h('button', { class: 'btn sm', onclick: () => { if (p._new) sum.points = sum.points.filter((x) => x !== p); delete p._editing; renderPoints(); } }, t('cancel'))));
    }
    return h('div', { class: 'pt' }, h('div', { class: 'txt' }, p.text),
      h('div', { class: 'tools' },
        h('button', { class: 'btn sm ghost', onclick: () => { p._editing = true; renderPoints(); } }, t('edit')),
        h('button', { class: 'btn sm ghost', onclick: () => { p.status = 'removed'; markDirty(); renderPoints(); } }, t('remove'))));
  }

  const factorsEl = h('div');
  function renderFactors() {
    const themes = s.themes;
    factorsEl.replaceChildren(
      ...sum.factors.filter((f) => f.status !== 'rejected').map((f) => h('div', { class: 'factor' },
        h('div', { class: 'stack', style: { gap: '.3rem' } },
          h('div', h('strong', themes[f.theme] || f.theme), ' ', h('span', { class: `badge ${f.status === 'confirmed' ? 'good' : ''}` }, f.status === 'confirmed' ? t('confirmed') : t('suggested'))),
          h('div', { class: 'row', style: { gap: '.4rem' } },
            h('select', { 'aria-label': t('factorsTitle'), style: { width: 'auto' }, onchange: (e) => { f.role = e.target.value; f.status = 'confirmed'; if (f.role === 'pull') f.rank = null; markDirty(); renderFactors(); } },
              ['trigger', 'contributing', 'pull'].map((r) => h('option', { value: r, selected: r === f.role }, t(`factorRole.${r}`)))),
            f.role !== 'pull' && !sum.noSingleMainReason ? h('select', { 'aria-label': t('rank'), style: { width: 'auto' }, onchange: (e) => { f.rank = e.target.value ? Number(e.target.value) : null; f.status = 'confirmed'; markDirty(); renderFactors(); } },
              h('option', { value: '' }, `${t('rank')}: –`), [1, 2, 3, 4].map((n) => h('option', { value: n, selected: f.rank === n }, `${t('rank')}: ${n}`))) : null)),
        h('div', { class: 'tools row', style: { gap: '.3rem' } },
          f.status !== 'confirmed' ? h('button', { class: 'btn sm primary', onclick: () => { f.status = 'confirmed'; markDirty(); renderFactors(); } }, t('confirm')) : null,
          h('button', { class: 'btn sm ghost', onclick: () => { f.status = 'rejected'; markDirty(); renderFactors(); } }, t('reject'))))),
      h('div', { class: 'row', style: { marginTop: '.75rem' } },
        h('select', { 'aria-label': t('addFactor'), style: { width: 'auto' }, onchange: (e) => { if (!e.target.value) return; const ex = sum.factors.find((x) => x.theme === e.target.value); if (ex) { ex.status = 'confirmed'; } else sum.factors.push({ theme: e.target.value, role: 'contributing', status: 'confirmed', rank: null }); markDirty(); renderFactors(); } },
          h('option', { value: '' }, `+ ${t('addFactor')}`), Object.entries(themes).filter(([k]) => !sum.factors.some((f) => f.theme === k && f.status !== 'rejected')).map(([k, v]) => h('option', { value: k }, v)))),
      h('label', { class: 'check', style: { marginTop: '.75rem' } }, h('input', { type: 'checkbox', checked: !!sum.noSingleMainReason, onchange: (e) => { sum.noSingleMainReason = e.target.checked; markDirty(); renderFactors(); } }), t('noSingle')),
    );
  }

  const prevSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('prevent') }, Object.keys(t('preventOpts')).map((k) => h('button', { type: 'button', 'aria-pressed': String(sum.preventability === k), onclick: (e) => { sum.preventability = k; [...prevSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); markDirty(); } }, t(`preventOpts.${k}`))));
  const comment = h('textarea', { rows: 3, id: 'fc', oninput: (e) => { sum.finalComment = e.target.value; markDirty(); } }, sum.finalComment || '');
  const speakBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => speakComment() }, icon('mic'), t('speakComment'));
  let commentListener = null;
  function speakComment() {
    if (commentListener) { commentListener.stop(); commentListener = null; speakBtn.lastChild.textContent = t('speakComment'); return; }
    commentListener = new Listener({ config, lang: s.language, sessionId: s.id, token: ctx.sessionToken, endOfTurnMs: 2500,
      onInterim: (txt) => { comment.value = `${sum.finalComment ? `${sum.finalComment} ` : ''}${txt}`; },
      onTurn: (txt) => { sum.finalComment = `${sum.finalComment ? `${sum.finalComment} ` : ''}${txt}`; comment.value = sum.finalComment; markDirty(); },
      onError: () => { toast(t('needVoice'), { kind: 'bad' }); commentListener?.stop(); commentListener = null; } });
    commentListener.start();
    speakBtn.lastChild.textContent = t('stListening');
  }

  const convo = h('details', { class: 'card flat' }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('conversation')),
    h('p', { class: 'muted small', style: { marginTop: '.5rem' } }, t('conversationHint')),
    h('div', { class: 'chat' }, s.transcript.map((turn) => h('div', { class: `msg ${turn.role}` }, h('div', { class: 'meta' }, turn.role === 'employee' ? t('you') : t('interviewer'), turn.corrected ? ` · ${t('corrected')}` : ''), turn.text,
      turn.role === 'employee' && !correcting ? h('div', h('button', { class: 'linkbtn small', onclick: () => {
        const ta = h('textarea', { rows: 4 }, turn.text);
        dialog({ title: t('correctTitle'), body: ta, actions: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: async () => { await api(`/api/session/${s.id}/correct-turn`, { method: 'POST', body: { turnId: turn.id, text: ta.value }, headers }); turn.text = ta.value; turn.corrected = true; toast(t('corrected')); } }] });
      } }, t('correct'))) : null))));

  async function act(kind) {
    clearTimeout(saveTimer);
    const body = { summary: sum };
    try {
      if (kind === 'later') { await api(`/api/session/${s.id}/save-draft`, body ? { method: 'POST', body, headers } : {}); dirty = false; toast(t('savedLater'), { timeout: 6000 }); return; }
      if (kind === 'discard') {
        if (!(await confirmDialog(t('discard'), t('discardConfirm'), { confirmLabel: t('discard'), kind: 'danger' }))) return;
        await api(`/api/session/${s.id}/discard`, { method: 'POST', headers });
        return render(h('div', { class: 'hero' }, h('h1', t('withdrawn'))));
      }
      if (kind === 'cancelCorrection') { await api(`/api/session/${s.id}/cancel-correction`, { method: 'POST', headers }); await loadSession(s.id); return submittedScreen(); }
      await api(`/api/session/${s.id}/submit`, { method: 'POST', body, headers });
      dirty = false;
      await loadSession(s.id);
      submittedScreen();
    } catch (err) { toast(err.message, { kind: 'bad' }); }
  }

  render(
    s.preview ? h('div', { class: 'notice demo', style: { marginTop: '.5rem' } }, t('previewBanner')) : null,
    h('div', { class: 'hero' }, h('h1', t('reviewTitle')), h('p', { class: 'ink2' }, t('reviewIntro'))),
    correcting ? h('p', { class: 'notice warn' }, t('correctionMode')) : null,
    sectionsEl,
    h('section', { class: 'card', style: { marginTop: '1rem' } }, h('h3', t('factorsTitle')), h('p', { class: 'muted small' }, t('factorsIntro')), factorsEl),
    h('section', { class: 'card stack', style: { marginTop: '1rem' } }, h('h3', t('prevent')), prevSeg),
    h('section', { class: 'card stack', style: { marginTop: '1rem' } }, h('label', { for: 'fc' }, t('finalComment')), comment, h('div', speakBtn)),
    h('div', { style: { marginTop: '1rem' } }, convo),
    h('div', { class: 'sticky-actions' }, saveState, h('span', { class: 'spacer' }),
      correcting ? h('button', { class: 'btn', onclick: () => act('cancelCorrection') }, t('cancelCorrection')) : h('button', { class: 'btn ghost', onclick: () => act('discard') }, t('discard')),
      !correcting && !s.preview ? h('button', { class: 'btn', onclick: () => act('later') }, t('saveLater')) : null,
      !s.preview ? h('button', { class: 'btn primary', onclick: () => act('submit') }, correcting ? t('resubmit') : t('submit')) : null),
  );
  renderPoints();
  renderFactors();
}

// --- Submitted -----------------------------------------------------------------

function submittedScreen() {
  const s = ctx.session;
  const headers = { 'x-session-token': ctx.sessionToken };
  const kept = (s.summary?.points || []).filter((p) => p.status !== 'removed');
  const copyText = () => [`PartWays – ${ctx.programme.org.name}`, `${t('submittedTitle')} ${fmt.date(s.submittedAt)}`, '',
    ...Object.keys(s.sections).flatMap((sec) => { const ps = kept.filter((p) => p.section === sec); return ps.length ? [t(`sections.${sec}`), ...ps.map((p) => `• ${p.text}`), ''] : []; }),
    s.summary?.finalComment ? `${t('finalComment')}\n${s.summary.finalComment}` : ''].join('\n');
  const ratings = { ...(s.ratings || {}) };
  const rateRow = (k) => {
    const btns = [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', 'aria-label': `${t(`rate.${k}`)}: ${n} / 5`, 'aria-pressed': String(ratings[k] === n), onclick: async (e) => {
      ratings[k] = n; btns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      await api(`/api/session/${s.id}/ratings`, { method: 'POST', body: { [k]: n }, headers }).catch(() => {});
    } }, n));
    return h('div', { class: 'row between' }, h('span', t(`rate.${k}`)), h('div', { class: 'stars' }, btns));
  };
  render(
    h('div', { class: 'hero' }, h('h1', t('submittedTitle')), h('p', { class: 'ink2' }, ctx.programme.completionMessage)),
    h('section', { class: 'card stack' }, h('h3', t('submittedWhat')),
      h('p', { class: 'row', style: { gap: '.5rem', alignItems: 'flex-start', flexWrap: 'nowrap' } }, icon('check'), h('span', tv('didSubmit'))),
      s.interviewId ? h('p', { class: 'small muted', style: { margin: 0 } }, `${t('interviewId')}: `, h('strong', { class: 'mono' }, s.interviewId), ` · ${t('interviewIdHint')}`) : null,
      (s.revisions || []).length ? h('p', { class: 'muted small' }, s.revisions.map((r) => `${fmt.date(r.at)}: ${r.type}`).join(' · ')) : null),
    h('section', { class: 'card stack', style: { marginTop: '1rem' } }, h('h3', t('copy')),
      Object.keys(s.sections).map((sec) => { const ps = kept.filter((p) => p.section === sec); return ps.length ? h('div', h('h4', t(`sections.${sec}`)), h('ul', ps.map((p) => h('li', p.text)))) : null; }),
      h('div', { class: 'row no-print' },
        h('button', { class: 'btn sm', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([copyText()], { type: 'text/plain' })), download: 'partways-summary.txt' }); a.click(); } }, t('download')),
        h('button', { class: 'btn sm', onclick: () => window.print() }, t('print')))),
    h('section', { class: 'card stack no-print', style: { marginTop: '1rem' } }, h('h3', t('rateTitle')), h('p', { class: 'muted small' }, tv('rateHint')), ['ease', 'heard', 'accuracy'].map(rateRow)),
    h('div', { class: 'row no-print', style: { marginTop: '1.5rem' } },
      h('button', { class: 'btn', onclick: async () => { const r = await api(`/api/session/${s.id}/start-correction`, { method: 'POST', headers }); ctx.session = r.session; reviewScreen(); } }, t('correctSubmitted')),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog(t('withdraw'), t('withdrawConfirm'), { confirmLabel: t('withdraw'), kind: 'danger' }))) return;
        await api(`/api/session/${s.id}/withdraw`, { method: 'POST', headers });
        render(h('div', { class: 'hero' }, h('h1', t('withdrawn'))));
      } }, t('withdraw'))),
  );
}

window.addEventListener('hashchange', route);
route();
