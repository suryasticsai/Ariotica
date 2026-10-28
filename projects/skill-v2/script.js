document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const statusEl = $('status');
  const localVideo = $('local');
  const remoteVideo = $('remote');
  const startBtn = $('startBtn');
  const muteBtn = $('muteBtn');
  const cameraBtn = $('cameraBtn');
  const hangupBtn = $('hangupBtn');
  const copyBtn = $('copyBtn');
  const sendBtn = $('sendBtn');
  const msgInput = $('msg');
  const log = $('log');
  const shareLink = $('shareLink');

  let peer = null;
  let conn = null;
  let call = null;
  let localStream = null;
  let micOn = true;
  let videoOn = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateShareLink() {
    shareLink.value = location.href;
  }

  function updateTitle() {
    const room = location.hash.slice(1);
    document.title = room ? `P2P Voice & Chat - ${room}` : 'P2P Voice & Chat';
  }

  async function getMedia(withVideo) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !!withVideo,
      });
      localVideo.srcObject = localStream;
      videoOn = !!withVideo;
      cameraBtn.textContent = videoOn ? 'Camera Off' : 'Camera On';
      cameraBtn.setAttribute('aria-pressed', String(videoOn));
    } catch (e) {
      localStream = null;
      setStatus(`Microphone unavailable (${e.name}). Chat only.`);
    }
  }

  function toggleMic() {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    muteBtn.textContent = micOn ? 'Mute' : 'Unmute';
    muteBtn.setAttribute('aria-pressed', String(!micOn));
  }

  function toggleCamera() {
    if (!localStream) return;
    videoOn = !videoOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = videoOn));
    cameraBtn.textContent = videoOn ? 'Camera Off' : 'Camera On';
    cameraBtn.setAttribute('aria-pressed', String(videoOn));
  }

  function addMessage(who, text) {
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.textContent = `${who}: ${text}`;
    log.appendChild(li);
    li.scrollIntoView({ block: 'end' });
  }

  function sendMessage() {
    const txt = msgInput.value.trim();
    if (!txt || !conn || !conn.open) return;
    conn.send(txt);
    addMessage('You', txt);
    msgInput.value = '';
  }

  function copyLink() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareLink.value).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    shareLink.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      // ignore
    }
  }

  function hangUp() {
    if (call) call.close();
    if (conn) conn.close();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peer) peer.destroy();
    call = null;
    conn = null;
    peer = null;
    setStatus('Call ended');
    startBtn.disabled = false;
    muteBtn.disabled = true;
    cameraBtn.disabled = true;
    hangupBtn.disabled = true;
    sendBtn.disabled = true;
  }

  function wireChat(c) {
    conn = c;
    c.on('open', () => {
      setStatus('Connected');
      sendBtn.disabled = false;
    });
    c.on('data', (d) => {
      addMessage('Friend', String(d));
    });
    c.on('close', () => {
      setStatus('Friend left');
      sendBtn.disabled = true;
    });
  }

  function wireCall(c) {
    call = c;
    c.on('stream', (s) => {
      remoteVideo.srcObject = s;
      setStatus('Connected');
    });
    c.on('close', () => {
      setStatus('Call ended');
    });
  }

  async function startOrJoin() {
    startBtn.disabled = true;
    muteBtn.disabled = true;
    cameraBtn.disabled = true;
    hangupBtn.disabled = true;
    sendBtn.disabled = true;

    let room = location.hash.slice(1);
    if (!room) {
      room = Math.random().toString(36).substring(2, 8);
      location.hash = room;
    }
    updateShareLink();
    updateTitle();

    const hostId = `p2p-${room}`;
    await getMedia(false);

    peer = new Peer(hostId);
    peer.on('open', () => {
      setStatus('Waiting for a friend…');
      muteBtn.disabled = false;
      cameraBtn.disabled = false;
      hangupBtn.disabled = false;
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        joinAsGuest(hostId);
      } else {
        setStatus(`Error: ${err.type}`);
      }
    });
    peer.on('connection', (c) => wireChat(c));
    peer.on('call', (c) => {
      call = c;
      c.answer(localStream || undefined);
      wireCall(c);
    });
  }

  function joinAsGuest(hostId) {
    peer = new Peer();
    peer.on('open', async () => {
      const dc = peer.connect(hostId, { reliable: true });
      wireChat(dc);
      if (localStream) {
        const c = peer.call(hostId, localStream);
        wireCall(c);
      }
      setStatus('Connecting…');
      muteBtn.disabled = false;
      cameraBtn.disabled = false;
      hangupBtn.disabled = false;
    });
    peer.on('error', (err) => setStatus(`Error: ${err.type}`));
  }

  // Event bindings
  startBtn.addEventListener('click', startOrJoin);
  muteBtn.addEventListener('click', toggleMic);
  cameraBtn.addEventListener('click', async () => {
    if (!localStream || !videoOn) {
      await getMedia(!videoOn);
    } else {
      toggleCamera();
    }
  });
  hangupBtn.addEventListener('click', hangUp);
  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  copyBtn.addEventListener('click', copyLink);

  // Update title on hash change (supports manual navigation)
  window.addEventListener('hashchange', () => {
    updateTitle();
    updateShareLink();
  });

  // Initial title & share link setup
  updateTitle();
  updateShareLink();
});