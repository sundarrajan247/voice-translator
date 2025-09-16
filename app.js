const connectBtn = document.getElementById('connect');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const remoteAudioEl = document.getElementById('remoteAudio');
const langSel = document.getElementById('lang');

let pc, localStream, dataChannel;

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
    connectBtn.disabled = true;
    statusEl.textContent = 'requesting mic…';
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    statusEl.textContent = 'minting token…';
    const token = await getEphemeralToken(langSel.value);

    statusEl.textContent = 'creating peer connection…';
    pc = new RTCPeerConnection();

    // play agent audio
    pc.ontrack = (e) => { remoteAudioEl.srcObject = e.streams[0]; };

    // optional data channel for transcript/events
    dataChannel = pc.createDataChannel('oai-events');
    dataChannel.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'transcript.partial' || msg.type === 'transcript.final') {
          transcriptEl.textContent = msg.text;
        }
      } catch { /* ignore non-JSON messages */ }
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
  }
}

function stop() {
  stopBtn.disabled = true;
  connectBtn.disabled = false;
  statusEl.textContent = 'stopped';
  transcriptEl.textContent = '';
  if (dataChannel && dataChannel.readyState === 'open') dataChannel.close();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
}

connectBtn.onclick = connect;
stopBtn.onclick = stop;
