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
  const spinner = $('spinner');

  // State variables
  let roomId = null;
  let peer = null;
  let dataConn = null;
  let call = null;
  let localStream = null;
  let isHost = false;
  let micOn = true;
  let videoOn = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  // Utility functions
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function showSpinner() {
    spinner.classList.remove('d-none');
  }

  function hideSpinner() {
    spinner.classList.add('d-none');
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
    hideSpinner();
    retryCount = 0;
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
      // Audio only – video will be requested on demand
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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

  async function toggleCamera() {
    if (!localStream) return;
    if (!videoOn) {
      // Request video track on demand
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = videoStream.getVideoTracks()[0];
        localStream.addTrack(videoTrack);
        videoOn = true;
        videoTrack.enabled = true;
        cameraBtn.textContent = 'Camera On';
        cameraBtn.setAttribute('aria-pressed', 'false');
      } catch (e) {
        console.error('Camera error:', e);
        setStatus('Camera unavailable (' + e.name + ')');
      }
    } else {
      // Turn off existing video tracks
      localStream.getVideoTracks().forEach((t) => (t.enabled = false));
      videoOn = false;
      cameraBtn.textContent = 'Camera Off';
      cameraBtn.setAttribute('aria-pressed', 'true');
    }
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

  // PeerJS logic with retry & spinner
  function startAsHost(hostId) {
    isHost = true;
    initPeer(hostId, true);
  }

  function startAsGuest(hostId) {
    isHost = false;
    initPeer(hostId, false);
  }

  function initPeer(hostId, tryAsHost) {
    hideSpinner();
    showSpinner();
    if (tryAsHost) {
      peer = new Peer(hostId);
    } else {
      // Guest: random Peer ID
      peer = new Peer();
    }

    peer.on('open', () => {
      hideSpinner();
      if (tryAsHost) {
        setStatus('Waiting for a friend…');
      } else {
        setStatus('Connecting…');
      }
    });

    peer.on('error', (err) => {
      hideSpinner();
      if (err.type === 'unavailable-id' && tryAsHost) {
        // Host ID already taken – become guest
        peer.destroy();
        startAsGuest(hostId);
      } else if (!tryAsHost && (err.type === 'server-error' || err.type === 'peer-unavailable')) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setStatus('Retrying connection (' + retryCount + '/' + MAX_RETRIES + ')…');
          setTimeout(() => initPeer(hostId, false), 3000);
        } else {
          setStatus('Host not found or server busy');
        }
      } else {
        console.error('Peer error:', err);
        setStatus('Error: ' + err.type);
      }
    });

    peer.on('connection', (conn) => {
      dataConn = conn;
      setupDataConnection(conn);
    });

    peer.on('call', (incomingCall) => {
      // Answer with our stream (may be null if no media)
      incomingCall.answer(localStream || undefined);
      call = incomingCall;
      setupCallHandlers(incomingCall);
    });

    // Guest specific actions after peer is open
    if (!tryAsHost) {
      peer.on('open', () => {
        // Data connection
        dataConn = peer.connect(hostId, { reliable: true });
        setupDataConnection(dataConn);
        // Media call if we have a stream (audio is always present)
        if (localStream) {
          call = peer.call(hostId, localStream);
          setupCallHandlers(call);
        }
      });
    }
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
  createRoomBtn.addEventListener('click', async () => {
    roomId = Math.random().toString(36).substring(2, 8);
    const deterministicId = 'ariotica-' + roomId;
    location.hash = roomId;
    document.title = `Room – ${roomId}`;
    updateShareLink();
    createRoomBtn.style.display = 'none';
    await getMedia();
    startAsHost(deterministicId);
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

  // Initialization based on hash (auto‑join)
  async function init() {
    if (location.hash) {
      // Guest flow – directly join as guest
      createRoomBtn.style.display = 'none';
      roomId = location.hash.substring(1);
      const deterministicId = 'ariotica-' + roomId;
      document.title = `Room – ${roomId}`;
      updateShareLink();
      await getMedia();
      startAsGuest(deterministicId);
    } else {
      // No hash – show create button
      createRoomBtn.style.display = 'inline-block';
    }
  }

  window.addEventListener('hashchange', () => {
    // Simple reload to handle new room ids cleanly
    location.reload();
  });

  init();
})();