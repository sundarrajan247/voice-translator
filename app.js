const connectBtn = document.getElementById('connect');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const transcriptInputEl = document.getElementById('transcript-input');
const transcriptOutputEl = document.getElementById('transcript-output');
const transcriptInputLabelEl = document.getElementById('transcript-input-label');
const transcriptOutputLabelEl = document.getElementById('transcript-output-label');
const remoteAudioEl = document.getElementById('remoteAudio');
const langSel = document.getElementById('lang');

let pc, localStream, dataChannel;
let activeResponseId = null;
let latestUserTranscript = '';
let latestAssistantTranscript = '';
let detectedInputLanguage = '';

function updateOutputTranscriptLabel() {
  if (!transcriptOutputLabelEl || !langSel) return;
  transcriptOutputLabelEl.textContent = `Output (${langSel.value})`;
}

function updateInputTranscriptLabel(language) {
  if (!transcriptInputLabelEl) return;
  if (!language) {
    transcriptInputLabelEl.textContent = 'Input (what you said)';
    return;
  }
  const normalized = language.trim();
  try {
    const displayNames = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
    const prettyName = displayNames.of(normalized) || normalized;
    transcriptInputLabelEl.textContent = `Input (${prettyName})`;
  } catch {
    transcriptInputLabelEl.textContent = `Input (${normalized})`;
  }
}

function resetTranscripts() {
  activeResponseId = null;
  latestUserTranscript = '';
  latestAssistantTranscript = '';
  detectedInputLanguage = '';
  if (transcriptInputEl) transcriptInputEl.textContent = '';
  if (transcriptOutputEl) transcriptOutputEl.textContent = '';
  updateInputTranscriptLabel('');
}

function handleTranscriptEvent(msg) {
  if (!msg || typeof msg !== 'object') return;
  const type = msg.type;

  if (type === 'input_audio_buffer.speech_started') {
    latestUserTranscript = '';
    if (transcriptInputEl) transcriptInputEl.textContent = '';
    return;
  }

  if (type === 'transcript.partial' || type === 'transcript.final') {
    const text = extractMessageText(msg);
    if (typeof text === 'string' && text.trim()) {
      latestUserTranscript = text;
      if (transcriptInputEl) transcriptInputEl.textContent = latestUserTranscript;
    }
    const language = msg.language || msg.lang || msg.transcript?.language;
    if (typeof language === 'string' && language && language !== detectedInputLanguage) {
      detectedInputLanguage = language;
      updateInputTranscriptLabel(language);
    }
    return;
  }

  if (type === 'response.created') {
    activeResponseId = msg.response?.id || null;
    latestAssistantTranscript = '';
    if (transcriptOutputEl) transcriptOutputEl.textContent = '';
    return;
  }

  if (type === 'response.output_text.delta') {
    if (!activeResponseId || msg.response_id === activeResponseId) {
      const delta = typeof msg.delta === 'string' ? msg.delta : extractMessageText(msg);
      if (typeof delta === 'string' && delta) {
        latestAssistantTranscript += delta;
        if (transcriptOutputEl) transcriptOutputEl.textContent = latestAssistantTranscript;
      }
    }
    return;
  }

  if (type === 'response.output_text.done') {
    if (!activeResponseId || msg.response_id === activeResponseId) {
      const finalText = typeof msg.output_text === 'string'
        ? msg.output_text
        : Array.isArray(msg.output_text)
          ? msg.output_text.join('')
          : extractMessageText(msg) || latestAssistantTranscript;
      if (typeof finalText === 'string' && finalText) {
        latestAssistantTranscript = finalText;
        if (transcriptOutputEl) transcriptOutputEl.textContent = latestAssistantTranscript;
      }
    }
    return;
  }

  if (type === 'response.completed') {
    if (!activeResponseId || msg.response?.id === activeResponseId) {
      activeResponseId = null;
    }
    return;
  }

  if (typeof type === 'string' && type.includes('transcript')) {
    const text = extractMessageText(msg);
    if (typeof text === 'string' && text.trim()) {
      const treatAsInput = type.includes('input') || type.includes('user');
      if (treatAsInput) {
        latestUserTranscript = text;
        if (transcriptInputEl) transcriptInputEl.textContent = latestUserTranscript;
        const language = msg.language || msg.lang || msg.transcript?.language;
        if (typeof language === 'string' && language && language !== detectedInputLanguage) {
          detectedInputLanguage = language;
          updateInputTranscriptLabel(language);
        }
      } else {
        latestAssistantTranscript = text;
        if (transcriptOutputEl) transcriptOutputEl.textContent = latestAssistantTranscript;
      }
    }
    return;
  }

  const text = extractMessageText(msg);
  if (!text) return;

  const role = (getMessageRole(msg) || '').toLowerCase();
  if (role.includes('user') || role.includes('input')) {
    latestUserTranscript = text;
    if (transcriptInputEl) transcriptInputEl.textContent = latestUserTranscript;
  } else if (role.includes('assistant') || role.includes('output') || role.includes('agent')) {
    latestAssistantTranscript = text;
    if (transcriptOutputEl) transcriptOutputEl.textContent = latestAssistantTranscript;
  } else if (!latestUserTranscript) {
    latestUserTranscript = text;
    if (transcriptInputEl) transcriptInputEl.textContent = latestUserTranscript;
  } else {
    latestAssistantTranscript = text;
    if (transcriptOutputEl) transcriptOutputEl.textContent = latestAssistantTranscript;
  }
}

function extractMessageText(msg) {
  if (!msg || typeof msg !== 'object') return '';
  if (typeof msg.text === 'string') return msg.text;
  if (Array.isArray(msg.text)) return msg.text.join('');
  if (typeof msg.delta === 'string') return msg.delta;
  if (Array.isArray(msg.delta)) return msg.delta.join('');
  if (msg.delta && typeof msg.delta === 'object') {
    if (typeof msg.delta.text === 'string') return msg.delta.text;
    if (Array.isArray(msg.delta.text)) return msg.delta.text.join('');
    if (typeof msg.delta.transcript === 'string') return msg.delta.transcript;
  }
  if (typeof msg.transcript === 'string') return msg.transcript;
  if (typeof msg.message === 'string') return msg.message;
  if (typeof msg.output_text === 'string') return msg.output_text;
  if (Array.isArray(msg.output_text)) return msg.output_text.join('');
  if (msg.transcript && typeof msg.transcript.text === 'string') return msg.transcript.text;
  if (msg.transcript && typeof msg.transcript.delta === 'string') return msg.transcript.delta;
  if (msg.response && Array.isArray(msg.response.output)) {
    const pieces = [];
    for (const item of msg.response.output) {
      if (!item || typeof item !== 'object' || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (!content || typeof content !== 'object') continue;
        if (typeof content.text === 'string') pieces.push(content.text);
        if (typeof content.transcript === 'string') pieces.push(content.transcript);
        if (typeof content.delta === 'string') pieces.push(content.delta);
        if (Array.isArray(content.delta)) pieces.push(content.delta.join(''));
      }
    }
    if (pieces.length) return pieces.join('');
  }
  return '';
}

function getMessageRole(msg) {
  const candidates = [
    msg.participant,
    msg.role,
    msg.speaker,
    msg.source,
    msg.from,
    msg.direction,
    msg.channel,
    msg.track,
    msg.audio_track,
    msg.audio_track_id,
    msg.transcript?.participant,
    msg.transcript?.role,
    msg.response?.role,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate === 'object') {
      for (const key of ['role', 'name', 'id', 'type']) {
        if (typeof candidate[key] === 'string') return candidate[key];
      }
    }
  }
  return '';
}

if (langSel) {
  updateOutputTranscriptLabel();
  langSel.addEventListener('change', updateOutputTranscriptLabel);
}

const TOKEN_ENDPOINT = (() => {
  if (typeof window !== 'undefined' && window.RT_TOKEN_ENDPOINT) {
    return window.RT_TOKEN_ENDPOINT;
  }
  if (typeof process !== 'undefined' && process.env && process.env.RT_TOKEN_ENDPOINT) {
    return process.env.RT_TOKEN_ENDPOINT;
  }
  return '/api/rt-token';
})();

async function getEphemeralToken(selectedLanguage) {
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ language: selectedLanguage })
  });
  if (!resp.ok) {
    const errorBody = await resp.text();
    console.error(`Token request failed: ${resp.status} ${resp.statusText}`, errorBody);
    throw new Error(`Token request failed with status ${resp.status}`);
  }
  const js = await resp.json();
  return js.client_secret?.value; // short-lived token returned by your Vercel function
}

async function connect() {
  try {
    resetTranscripts();
    if (langSel) updateOutputTranscriptLabel();
    connectBtn.disabled = true;
    statusEl.textContent = 'requesting mic…';
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    statusEl.textContent = 'minting token…';
    const selectedLanguage = langSel ? langSel.value : 'Spanish';
    const token = await getEphemeralToken(selectedLanguage);

    statusEl.textContent = 'creating peer connection…';
    pc = new RTCPeerConnection();

    // play agent audio
    pc.ontrack = (e) => { remoteAudioEl.srcObject = e.streams[0]; };

    // optional data channel for transcript/events
    dataChannel = pc.createDataChannel('oai-events');
    dataChannel.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleTranscriptEvent(msg);
      } catch (err) {
        console.warn('Non-JSON event from data channel', err, ev.data);
      }
    };

    // send mic to the model
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

    // SDP offer -> OpenAI
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    statusEl.textContent = 'negotiating with OpenAI…';
    const sdpResponse = await fetch('https://api.openai.com/v1/realtime?model=gpt-realtime', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });

    if (!sdpResponse.ok) {
      statusEl.textContent = 'failed to start session';
      throw new Error(await sdpResponse.text());
    }

    const answer = await sdpResponse.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    statusEl.textContent = 'live: speak now';
    stopBtn.disabled = false;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'error (see console)';
    connectBtn.disabled = false;
    stopBtn.disabled = true;
    resetTranscripts();
  }
}

function stop() {
  stopBtn.disabled = true;
  connectBtn.disabled = false;
  statusEl.textContent = 'stopped';
  resetTranscripts();
  if (dataChannel && dataChannel.readyState === 'open') dataChannel.close();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
}

connectBtn.onclick = connect;
stopBtn.onclick = stop;
