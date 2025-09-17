const connectBtn = document.getElementById('connect');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const remoteAudioEl = document.getElementById('remoteAudio');
const langSel = document.getElementById('lang');
const verboseEl = document.getElementById('verbose');
const breakdownSection = document.getElementById('breakdownSection');
const breakdownEl = document.getElementById('breakdown');

let pc, localStream, dataChannel, verboseEnabled = false;
const jsonBufferByResponse = new Map();

if (verboseEl && breakdownSection && breakdownEl) {
  verboseEl.addEventListener('change', () => {
    if (verboseEl.checked) {
      breakdownSection?.classList.remove('hidden');
    } else {
      breakdownEl.textContent = '';
      breakdownSection?.classList.add('hidden');
      jsonBufferByResponse.clear();
    }
  });
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

async function getEphemeralToken(selectedLanguage, verbose) {
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ language: selectedLanguage, verbose })
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
    connectBtn.disabled = true;
    statusEl.textContent = 'requesting mic…';
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    verboseEnabled = !!verboseEl?.checked;
    jsonBufferByResponse.clear();
    if (breakdownEl) breakdownEl.textContent = '';
    if (verboseEnabled) {
      breakdownSection?.classList.remove('hidden');
    } else {
      breakdownSection?.classList.add('hidden');
    }

    statusEl.textContent = 'minting token…';
    const token = await getEphemeralToken(langSel.value, verboseEnabled);

    statusEl.textContent = 'creating peer connection…';
    pc = new RTCPeerConnection();

    // play agent audio
    pc.ontrack = (e) => { remoteAudioEl.srcObject = e.streams[0]; };

    // optional data channel for transcript/events
    dataChannel = pc.createDataChannel('oai-events');
    dataChannel.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // ignore non-JSON messages
      }

      if (msg.type === 'transcript.partial' || msg.type === 'transcript.final') {
        transcriptEl.textContent = msg.text;
        return;
      }

      if (msg.type === 'translation.breakdown') {
        renderBreakdown(msg);
        return;
      }

      if (msg.type === 'response.output_json.delta') {
        const responseId = msg.response?.id || msg.item_id || 'default';
        const previous = jsonBufferByResponse.get(responseId) || '';
        jsonBufferByResponse.set(responseId, previous + (msg.delta || ''));
        return;
      }

      if (msg.type === 'response.output_json.done') {
        const responseId = msg.response?.id || msg.item_id || 'default';
        const payload = jsonBufferByResponse.get(responseId);
        jsonBufferByResponse.delete(responseId);
        if (!payload) return;
        try {
          const breakdownMsg = JSON.parse(payload);
          renderBreakdown(breakdownMsg);
        } catch (err) {
          console.warn('Failed to parse breakdown JSON', err);
        }
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
    if (breakdownEl) breakdownEl.textContent = '';
    breakdownSection?.classList.add('hidden');
    verboseEnabled = false;
    jsonBufferByResponse.clear();
  }
}

function stop() {
  stopBtn.disabled = true;
  connectBtn.disabled = false;
  statusEl.textContent = 'stopped';
  transcriptEl.textContent = '';
  if (breakdownEl) breakdownEl.textContent = '';
  breakdownSection?.classList.add('hidden');
  verboseEnabled = false;
  jsonBufferByResponse.clear();
  if (dataChannel && dataChannel.readyState === 'open') dataChannel.close();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
}

connectBtn.onclick = connect;
stopBtn.onclick = stop;

function renderBreakdown(msg) {
  if (!verboseEnabled || !breakdownEl) return;
  if (breakdownSection) breakdownSection.classList.remove('hidden');
  breakdownEl.innerHTML = '';

  const payload = msg?.data && typeof msg.data === 'object' ? msg.data : msg;

  const safeString = (value) => (typeof value === 'string' ? value.trim() : '');
  const sourceSentence = safeString(payload.source || payload.original || payload.input);
  const targetSentence = safeString(payload.target || payload.translation || payload.text);

  if (sourceSentence) {
    const originalRow = document.createElement('div');
    originalRow.className = 'breakdown-row';
    originalRow.textContent = `Original: ${sourceSentence}`;
    breakdownEl.appendChild(originalRow);
  }

  if (targetSentence) {
    const translatedRow = document.createElement('div');
    translatedRow.className = 'breakdown-row';
    translatedRow.textContent = `Translation: ${targetSentence}`;
    breakdownEl.appendChild(translatedRow);
  }

  let breakdownList = Array.isArray(payload.breakdown) ? payload.breakdown : null;
  if (!breakdownList && Array.isArray(payload.words)) breakdownList = payload.words;
  if (!breakdownList && Array.isArray(payload.entries)) breakdownList = payload.entries;

  if (breakdownList && breakdownList.length) {
    breakdownList.forEach((entry) => {
      const sourceWord = safeString(entry.source || entry.input || entry.word);
      const targetWord = safeString(entry.target || entry.translation || entry.output);
      const meaning = safeString(entry.meaning || entry.gloss || entry.note);

      if (!sourceWord && !targetWord && !meaning) return;

      const row = document.createElement('div');
      row.className = 'breakdown-row';

      if (sourceWord) {
        const sourceEl = document.createElement('strong');
        sourceEl.textContent = sourceWord;
        row.appendChild(sourceEl);
      }

      if (targetWord) {
        if (row.childNodes.length) {
          const arrowEl = document.createElement('span');
          arrowEl.textContent = ' → ';
          row.appendChild(arrowEl);
        }
        const targetEl = document.createElement('strong');
        targetEl.textContent = targetWord;
        row.appendChild(targetEl);
      }

      if (meaning) {
        const meaningEl = document.createElement('span');
        meaningEl.textContent = (row.childNodes.length ? ' — ' : '') + meaning;
        row.appendChild(meaningEl);
      }

      breakdownEl.appendChild(row);
    });
  } else if (msg.explanation || msg.details) {
    const fallbackRow = document.createElement('div');
    fallbackRow.className = 'breakdown-row';
    fallbackRow.textContent = safeString(msg.explanation || msg.details);
    breakdownEl.appendChild(fallbackRow);
  }
}
