// Live voice: speech recognition in, speech synthesis out, with barge-in.
// Audio is processed live only. Nothing here records or stores audio.
import { api } from './lib.js';
import { SPEECH_LOCALE } from './i18n.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function voiceSupport(config) {
  const stt = config.voice.stt === 'deepgram' ? !!window.MediaRecorder : !!SR;
  const tts = config.voice.tts === 'elevenlabs' ? true : 'speechSynthesis' in window;
  return { stt, tts, ok: stt && tts };
}

// Microphone level meter for the preparation step.
export async function micCheck(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const data = new Uint8Array(an.fftSize);
  let raf;
  const tick = () => {
    an.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); };
}

// Splits streamed text into speakable sentences.
export class SentenceSplitter {
  constructor(onSentence) { this.buf = ''; this.onSentence = onSentence; }
  push(text) {
    this.buf += text;
    for (;;) {
      const m = this.buf.match(/[.!?…]\s/);
      if (!m) break;
      const s = this.buf.slice(0, m.index + 1).trim();
      this.buf = this.buf.slice(m.index + 1);
      if (s) this.onSentence(s);
    }
  }
  flush() { const s = this.buf.trim(); this.buf = ''; if (s) this.onSentence(s); }
}

// Browsers (Chrome especially) can keep speaking queued sentences after the page is
// left, so they carry on over the next page. Speech stops whenever the page is hidden
// or left, and other pages silence anything left over when they load.
export function silenceLeftoverSpeech() {
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* unsupported */ }
}

const speakers = new Set();
window.addEventListener('pagehide', () => { for (const s of speakers) s.stop(); silenceLeftoverSpeech(); });

export class Speaker {
  constructor({ config, lang, voice, sessionId, token }) {
    this.cfg = config; this.lang = lang; this.voice = voice; this.sessionId = sessionId; this.token = token;
    this.queue = []; this.playing = false; this.audio = null; this.onstart = null; this.onend = null; this.spokenText = '';
    this.generation = 0;
    speakers.add(this);
  }
  get useServer() { return this.cfg.voice.tts === 'elevenlabs'; }
  say(text) {
    this.queue.push({ text, gen: this.generation, prepared: this.useServer ? this.prepare(text) : null });
    if (!this.playing) this.next();
  }
  prepare(text) {
    return api('/api/voice/tts', { method: 'POST', body: { sessionId: this.sessionId, text, voice: this.voice }, headers: { 'x-session-token': this.token }, raw: true })
      .then((r) => r.blob()).catch(() => null);
  }
  async next() {
    const item = this.queue.shift();
    if (!item) { this.playing = false; this.onend?.(); return; }
    if (item.gen !== this.generation) return this.next();
    if (!this.playing) { this.playing = true; this.onstart?.(); }
    this.spokenText = item.text;
    if (this.useServer) {
      const blob = await item.prepared;
      if (item.gen !== this.generation) return;
      if (!blob) { this.fallbackSpeak(item.text); return; }
      this.audio = new Audio(URL.createObjectURL(blob));
      this.audio.onended = () => { URL.revokeObjectURL(this.audio.src); this.next(); };
      this.audio.onerror = () => this.next();
      this.audio.play().catch(() => this.next());
    } else {
      this.fallbackSpeak(item.text);
    }
  }
  fallbackSpeak(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LOCALE[this.lang] || 'en-GB';
    const voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith(this.lang));
    const pick = { calm: 0, clear: 1, low: 2 }[this.voice] || 0;
    if (voices.length) u.voice = voices[Math.min(pick, voices.length - 1)];
    u.rate = this.voice === 'clear' ? 1.03 : 0.98;
    u.pitch = this.voice === 'low' ? 0.85 : 1;
    u.onend = () => this.next();
    u.onerror = () => this.next();
    speechSynthesis.speak(u);
  }
  stop() {
    this.generation++;
    this.queue = [];
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const was = this.playing;
    this.playing = false;
    if (was) this.onend?.();
  }
  get speaking() { return this.playing; }
}

// Speech recognition with end-of-turn detection. Emits interim and final text.
export class Listener {
  constructor({ config, lang, sessionId, token, onInterim, onTurn, onSpeechStart, onError, onState, endOfTurnMs = 1300 }) {
    Object.assign(this, { config, lang, sessionId, token, onInterim, onTurn, onSpeechStart, onError, onState, endOfTurnMs });
    this.active = false; this.text = ''; this.timer = null; this.rec = null; this.ws = null; this.media = null;
  }
  get useServer() { return this.config.voice.stt === 'deepgram'; }
  async start() {
    this.active = true;
    if (this.useServer) return this.startDeepgram();
    if (!SR) { this.onError?.('unsupported'); return; }
    this.rec = new SR();
    this.rec.lang = SPEECH_LOCALE[this.lang] || 'en-GB';
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.text += `${r[0].transcript.trim()} `;
        else interim += r[0].transcript;
      }
      const live = `${this.text}${interim}`.trim();
      if (live) this.onSpeechStart?.(live);
      this.onInterim?.(live);
      this.armTimer(interim);
    };
    this.rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.onError?.(e.error === 'not-allowed' ? 'denied' : 'network');
    };
    this.rec.onend = () => { if (this.active) { try { this.rec.start(); } catch { /* already started */ } } };
    try { this.rec.start(); } catch { /* already started */ }
    this.onState?.('listening');
  }
  armTimer(interim) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const final = `${this.text}${interim || ''}`.trim();
      if (final) { this.text = ''; this.onTurn?.(final); }
    }, interim ? this.endOfTurnMs + 600 : this.endOfTurnMs);
  }
  async startDeepgram() {
    try {
      const { token, model } = await api('/api/voice/stt-token', { method: 'POST', body: { sessionId: this.sessionId }, headers: { 'x-session-token': this.token } });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.stream = stream;
      const qs = new URLSearchParams({ model, language: this.lang === 'en' ? 'en-GB' : this.lang, interim_results: 'true', smart_format: 'true', endpointing: '400', utterance_end_ms: '1200', vad_events: 'true', mip_opt_out: 'true' });
      this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${qs}`, ['bearer', token]);
      this.ws.onopen = () => {
        this.media = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' });
        this.media.ondataavailable = (e) => { if (e.data.size && this.ws?.readyState === 1) this.ws.send(e.data); };
        this.media.start(250);
        this.onState?.('listening');
      };
      this.ws.onmessage = (m) => {
        const j = JSON.parse(m.data);
        if (j.type === 'Results') {
          const alt = j.channel?.alternatives?.[0]?.transcript || '';
          if (j.is_final && alt) this.text += `${alt} `;
          const live = `${this.text}${j.is_final ? '' : alt}`.trim();
          if (live) { this.onSpeechStart?.(live); this.onInterim?.(live); }
          if (j.speech_final && this.text.trim()) this.commit();
        } else if (j.type === 'UtteranceEnd' && this.text.trim()) this.commit();
      };
      this.ws.onclose = () => { if (this.active) this.onError?.('network'); };
      this.ws.onerror = () => this.onError?.('network');
    } catch (err) {
      this.onError?.(err?.name === 'NotAllowedError' ? 'denied' : 'network');
    }
  }
  commit() { const t = this.text.trim(); this.text = ''; if (t) this.onTurn?.(t); }
  clear() { this.text = ''; clearTimeout(this.timer); }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    try { this.rec?.stop(); } catch { /* not running */ }
    this.rec = null;
    try { this.media?.stop(); } catch { /* not running */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ws?.readyState === 1) this.ws.close();
    this.ws = null;
  }
}
