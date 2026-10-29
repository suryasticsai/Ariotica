document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  // UI references
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
  const installBtn = $('installBtn');
  const iosInstallBtn = $('iosInstallBtn');
  const refreshBtn = $('refreshConnectionBtn');

  // State variables (declared before use)
  let peer = null;
  let conn = null;
  let call = null;
  let localStream = null;
  let micOn = true;
  let videoOn = false;
  let deferredPrompt = null;

  const setStatus = (text) => {
    statusEl.textContent = text;
  };

  const updateShareLink = () => {
    shareLink.value = location.href;
  };

  const updateTitle = () => {
    const room = location.hash.slice(1);
    document.title = room ? `P2P Voice & Chat - ${room}` : 'P2P Voice & Chat';
  };

  const getMedia = async (withVideo) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !!withVideo,
      });
      // Preserve existing audio track if we already have one
      if (localStream && localStream.getAudioTracks().length) {
        const audioTrack = localStream.getAudioTracks()[0];
        stream.removeTrack(stream.getAudioTracks()[0]);
        stream.addTrack(audioTrack);
      }
      localStream = stream;
      localVideo.srcObject = stream;
      localVideo.classList.remove('placeholder');
      videoOn = !!withVideo;
      cameraBtn.textContent = videoOn ? 'Camera Off' : 'Camera On';
      cameraBtn.setAttribute('aria-pressed', String(videoOn));
    } catch (e) {
      localStream = null;
      setStatus(`Microphone unavailable (${e.name}). Chat only.`);
    }
  };

  const toggleMic = () => {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    muteBtn.textContent = micOn ? 'Mute' : 'Unmute';
    muteBtn.setAttribute('aria-pressed', String(!micOn));
  };

  const toggleCamera = () => {
    if (!localStream) return;
    videoOn = !videoOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = videoOn));
    cameraBtn.textContent = videoOn ? 'Camera Off' : 'Camera On';
    cameraBtn.setAttribute('aria-pressed', String(videoOn));
  };

  const addMessage = (who, text) => {
    const emptyItem = log.querySelector('.empty');
    if (emptyItem) emptyItem.remove();
    const li = document.createElement('li');
    li.textContent = `${who}: ${text}`;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  };

  const sendMessage = () => {
    const text = msgInput.value.trim();
    if (!text) return;
    addMessage('Me', text);
    conn && conn.send(text);
    msgInput.value = '';
  };

  const startCall = async () => {
    await getMedia(false);
    const room = location.hash.slice(1) || `room-${Date.now()}`;
    if (!location.hash) location.hash = room;
    updateTitle();
    updateShareLink();

    peer = new Peer(undefined, { debug: 2 });
    peer.on('open', (id) => {
      setStatus('Connected as ' + id);
      conn = peer.connect(room);
      conn.on('open', () => {
        setStatus('Connected to peer');
        conn.on('data', (data) => addMessage('Peer', data));
      });
      conn.on('error', (err) => setStatus('Connection error'));
      // Call setup
      call = peer.call(room, localStream);
      call.on('stream', (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.classList.remove('placeholder');
      });
    });
    peer.on('error', (err) => setStatus('Peer error'));
    enableControls();
  };

  const hangup = () => {
    if (call) call.close();
    if (conn) conn.close();
    if (peer) peer.destroy();
    setStatus('Call ended');
    disableControls();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink.value);
      setStatus('Link copied');
    } catch {
      setStatus('Copy failed');
    }
  };

  const enableControls = () => {
    muteBtn.disabled = false;
    cameraBtn.disabled = false;
    hangupBtn.disabled = false;
    sendBtn.disabled = false;
    copyBtn.disabled = false;
  };

  const disableControls = () => {
    muteBtn.disabled = true;
    cameraBtn.disabled = true;
    hangupBtn.disabled = true;
    sendBtn.disabled = true;
    copyBtn.disabled = true;
  };

  // Refresh connection logic (from reference) ---------------------------------
  const setRefreshStatus = (online) => {
    const text = online ? 'Online' : 'Offline';
    setStatus(text);
  };

  const resetPeer = () => {
    if (peer && !peer.destroyed) {
      peer.disconnect();
      peer.destroy();
    }
    peer = new Peer(undefined, { debug: 2 });
    peer.on('open', () => setRefreshStatus(true));
    peer.on('error', () => setRefreshStatus(false));
    peer.on('close', () => setRefreshStatus(false));
  };

  const refreshConnection = async () => {
    try {
      setRefreshStatus(false);
      // Re‑initialize media (keep existing audio if possible)
      await getMedia(videoOn);
      resetPeer();
    } catch (e) {
      console.error('Refresh failed:', e);
    }
  };

  refreshBtn.addEventListener('click', refreshConnection);
  // ---------------------------------------------------------------------------

  // UI event listeners
  startBtn.addEventListener('click', startCall);
  muteBtn.addEventListener('click', toggleMic);
  cameraBtn.addEventListener('click', toggleCamera);
  hangupBtn.addEventListener('click', hangup);
  copyBtn.addEventListener('click', copyLink);
  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Install prompt handling (optional, kept for completeness)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.hidden = true;
    }
    deferredPrompt = null;
  });

  // iOS fallback – show manual add to home screen button
  const isIOS = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  if (isIOS) iosInstallBtn.hidden = false;

  // Initial UI state
  updateTitle();
  updateShareLink();
});