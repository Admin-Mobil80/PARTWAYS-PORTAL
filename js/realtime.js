// Live voice interview over OpenAI Realtime (WebRTC). The browser talks to the
// speech-to-speech model directly, with a short-lived key from the PartWays API;
// the model hears the employee and speaks back in one continuous audio stream,
// and can be interrupted naturally. Finished turns are reported through callbacks
// so the page can store them and update progress.

export const realtimeSupported = () => typeof RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia;

export class RealtimeConversation {
  constructor({ keyUrl, headers, body = {}, onUserTurn, onAssistantDelta, onAssistantTurn, onSpeaking, onUserSpeaking, onLevel, onError }) {
    Object.assign(this, { keyUrl, headers, body, onUserTurn, onAssistantDelta, onAssistantTurn, onSpeaking, onUserSpeaking, onLevel, onError });
    this.pc = null; this.dc = null; this.stream = null; this.audio = null; this.closed = false;
    // When each turn started, so turns can be stored in the order they were spoken.
    this.startedAt = new Map();
  }

  async start() {
    const res = await fetch(this.keyUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...this.headers }, body: JSON.stringify(this.body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.key) throw new Error(data.error || 'Live voice could not start.');

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.audio = new Audio();
    this.audio.autoplay = true;
    pc.ontrack = (e) => { this.audio.srcObject = e.streams[0]; };
    pc.addTrack(this.stream.getAudioTracks()[0], this.stream);
    this.watchLevel();
    pc.onconnectionstatechange = () => {
      if (!this.closed && ['failed', 'disconnected'].includes(pc.connectionState)) this.onError?.('connection');
    };

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.addEventListener('message', (e) => { try { this.handle(JSON.parse(e.data)); } catch { /* ignore malformed */ } });
    const opened = new Promise((resolve) => dc.addEventListener('open', resolve, { once: true }));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', body: offer.sdp, headers: { authorization: `Bearer ${data.key}`, 'content-type': 'application/sdp' },
    });
    if (!sdp.ok) throw new Error('Live voice could not connect.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdp.text() });
    await opened;
    // The interviewer speaks first: its instructions say how to open (or resume).
    this.send({ type: 'response.create' });
  }

  handle(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        this.startedAt.set(ev.item_id, Date.now());
        this.onUserSpeaking?.(true);
        break;
      case 'input_audio_buffer.speech_stopped':
        this.onUserSpeaking?.(false);
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(ev.transcript || '').trim();
        if (text) this.onUserTurn?.(text, this.startedAt.get(ev.item_id) || Date.now());
        this.startedAt.delete(ev.item_id);
        break;
      }
      case 'response.output_audio_transcript.delta':
        if (!this.startedAt.has(ev.item_id)) this.startedAt.set(ev.item_id, Date.now());
        this.onAssistantDelta?.(ev.delta || '');
        break;
      case 'response.output_audio_transcript.done': {
        const text = String(ev.transcript || '').trim();
        if (text) this.onAssistantTurn?.(text, this.startedAt.get(ev.item_id) || Date.now());
        this.startedAt.delete(ev.item_id);
        break;
      }
      case 'output_audio_buffer.started':
        this.onSpeaking?.(true);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.onSpeaking?.(false);
        break;
      case 'error':
        console.warn('Realtime error', ev.error);
        break;
      default:
    }
  }

  // How loud the employee's microphone is (0 to 1), a few times a second, so the
  // page can show that it is being heard. A timer, not an animation frame, so it
  // keeps running when the browser deprioritises the tab.
  watchLevel() {
    if (!this.onLevel) return;
    try {
      this.levelCtx = new AudioContext();
      const analyser = this.levelCtx.createAnalyser();
      analyser.fftSize = 512;
      this.levelCtx.createMediaStreamSource(this.stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      this.levelTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const muted = !this.stream?.getAudioTracks()[0]?.enabled;
        this.onLevel(muted ? 0 : Math.min(1, Math.sqrt(sum / buf.length) * 6));
      }, 80);
    } catch { /* no level meter; the conversation still works */ }
  }

  send(event) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  // A note from the page (for example "repeat the question"), answered aloud.
  prompt(text) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.send({ type: 'response.create' });
  }

  mute(muted) {
    for (const t of this.stream?.getAudioTracks() || []) t.enabled = !muted;
  }

  stop() {
    this.closed = true;
    clearInterval(this.levelTimer);
    try { this.levelCtx?.close(); } catch { /* already closed */ }
    try { this.dc?.close(); } catch { /* already closed */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    for (const t of this.stream?.getTracks() || []) t.stop();
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.pc = null; this.dc = null; this.stream = null;
  }
}
