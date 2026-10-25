(function () {
  // Element shortcuts
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const createRoomBtn = $('create-room');
  const copyBtn = $('copy-btn');
  const shareLinkEl = $('share-link');
  const muteBtn = $('mute');
  const cameraBtn = $('camera');
  const hangupBtn = $('hangup');
  const localVideo = $('local');
  const remoteVideo = $('remote');
  const logEl = $('log');
  const msgForm = $('msg-form');
  const msgInput = $('msg-input');
  const emptyState = $('empty-state');
  const mediaSection = $('media-section');
  const chatSection = $('chat-section');

  // State variables
  let roomId = null;
  let peer = null;
  let dataConn = null;
  let call = null;
  let localStream = null;
  let isHost = false;
  let micOn = true;
  let videoOn = false; // start with camera off

  // Utility functions
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateShareLink() {
    const url = `${location.origin}${location.pathname}#${roomId}`;
    shareLinkEl.textContent = url;
  }

  function showSection(section) {
    section.classList.remove('d-none');
  }

  function hideSection(section) {
    section.classList.add('d-none');
  }

  function resetUI() {
    hideSection(mediaSection);
    hideSection(chatSection);
    createRoomBtn.style.display = 'inline-block';
    shareLinkEl.textContent = '';
    setStatus('');
    logEl.innerHTML = '';
    emptyState.style.display = 'block';
    muteBtn.textContent = 'Mute';
    muteBtn.setAttribute('aria-pressed', 'false');
    cameraBtn.textContent = 'Camera Off';
    cameraBtn.setAttribute('aria-pressed', 'true');
    videoOn = false;
    micOn = true;
  }

  function addMessage(text, fromSelf) {
    const li = document.createElement('li');
    li.textContent = (fromSelf ? 'You: ' : 'Friend: ') + text;
    li.style.textAlign = fromSelf ? 'right' : 'left';
    logEl.appendChild(li);
    li.scrollIntoView({ block: 'nearest' });
    emptyState.style.display = 'none';
  }

  // Media handling
  async function getMedia() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      // Disable video initially (camera off)
      stream.getVideoTracks().forEach((t) => (t.enabled = false));
      localStream = stream;
      localVideo.srcObject = stream;
      setStatus('Media ready');
    } catch (e) {
      console.error('getUserMedia error:', e);
      setStatus('Microphone unavailable (' + e.name + ')');
    }
  }

  function toggleMic() {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    muteBtn.textContent = micOn ? 'Mute' : 'Unmute';
    muteBtn.setAttribute('aria-pressed', micOn ? 'false' : 'true');
  }

  function toggleCamera() {
    if (!localStream) return;
    videoOn = !videoOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = videoOn));
    cameraBtn.textContent = videoOn ? 'Camera On' : 'Camera Off';
    cameraBtn.setAttribute('aria-pressed', videoOn ? 'false' : 'true');
  }

  function hangUp() {
    if (call) call.close();
    if (dataConn) dataConn.close();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    if (peer) peer.destroy();
    setStatus('Call ended');
    resetUI();
  }

  // PeerJS logic based on Ariotica spec
  function start(hostId, withVideo) {
    // hostId is deterministic: 'ariotica-' + roomId
    peer = new Peer(hostId);
    peer.on('open', () => {
      setStatus('Waiting for a friend…');
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Someone already hosts – become guest
        peer.destroy();
        joinAsGuest(hostId);
      } else {
        console.error('Peer error:', err);
        setStatus('Error: ' + err.type);
      }
    });
    peer.on('connection', (conn) => {
      // Host receives incoming data connection
      dataConn = conn;
      setupDataConnection(conn);
    });
    peer.on('call', (incomingCall) => {
      // Answer incoming call
      incomingCall.answer(localStream);
      call = incomingCall;
      setupCallHandlers(incomingCall);
    });
  }

  function joinAsGuest(hostId) {
    peer = new Peer(); // random id
    peer.on('open', () => {
      // Data connection
      dataConn = peer.connect(hostId, { reliable: true });
      setupDataConnection(dataConn);
      // Media call if we have a stream
      if (localStream) {
        call = peer.call(hostId, localStream);
        setupCallHandlers(call);
      }
      setStatus('Connecting…');
    });
    peer.on('error', (err) => {
      console.error('Guest peer error:', err);
      setStatus('Error: ' + err.type);
    });
  }

  function setupDataConnection(conn) {
    conn.on('open', () => {
      setStatus('Connected');
      showSection(chatSection);
    });
    conn.on('data', (data) => {
      addMessage(String(data), false);
    });
    conn.on('close', () => {
      setStatus('Friend left');
    });
    conn.on('error', (err) => {
      console.error('Data connection error:', err);
    });
  }

  function setupCallHandlers(c) {
    c.on('stream', (remoteStream) => {
      remoteVideo.srcObject = remoteStream;
      setStatus('Connected');
      showSection(mediaSection);
    });
    c.on('close', () => {
      setStatus('Call ended');
    });
    c.on('error', (err) => {
      console.error('Call error:', err);
      setStatus('Call error');
    });
  }

  // UI event listeners
  createRoomBtn.addEventListener('click', () => {
    roomId = Math.random().toString(36).substring(2, 8);
    isHost = true;
    location.hash = roomId;
    updateShareLink();
    createRoomBtn.style.display = 'none';
    document.title = `Room – ${roomId}`;
    // Start everything
    getMedia().then(() => {
      const deterministicId = 'ariotica-' + roomId;
      start(deterministicId, true);
    });
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  });

  muteBtn.addEventListener('click', toggleMic);
  cameraBtn.addEventListener('click', toggleCamera);
  hangupBtn.addEventListener('click', hangUp);

  msgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = msgInput.value.trim();
    if (!msg) return;
    addMessage(msg, true);
    if (dataConn && dataConn.open) dataConn.send(msg);
    msgInput.value = '';
  });

  // Load existing hash (join existing room)
  async function init() {
    if (location.hash) {
      roomId = location.hash.substring(1);
      isHost = false;
      document.title = `Room – ${roomId}`;
      updateShareLink();
      await getMedia();
      const deterministicId = 'ariotica-' + roomId;
      // Attempt to become host; will fallback to guest if id taken
      start(deterministicId, true);
    } else {
      // No hash – show create button
      createRoomBtn.style.display = 'inline-block';
    }
  }

  window.addEventListener('hashchange', () => {
    // Simple reload to re‑initialise with new room id
    location.reload();
  });

  init();
})();