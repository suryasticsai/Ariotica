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
  let hostRetryCount = 0;
  const HOST_MAX_RETRIES = 5;
  let guestRetryCount = 0;
  const GUEST_MAX_RETRIES = 3;

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
    hostRetryCount = 0;
    guestRetryCount = 0;
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
    const config = { host: 'peerjs-server.herokuapp.com', secure: true, port: 443 };
    if (tryAsHost) {
      peer = new Peer(hostId, config);
    } else {
      peer = new Peer(undefined, config);
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
      if (tryAsHost) {
        // Host-specific retry logic – never downgrade to guest
        if (hostRetryCount < HOST_MAX_RETRIES) {
          hostRetryCount++;
          setStatus(`Retrying as host (${hostRetryCount}/${HOST_MAX_RETRIES})…`);
          setTimeout(() => initPeer(hostId, true), 3000);
        } else {
          setStatus('Signaling server is down. Please try again later.');
        }
      } else {
        // Guest error handling
        if (err.type === 'unavailable-id') {
          // Should not happen for guest, but fallback to retry
          if (guestRetryCount < GUEST_MAX_RETRIES) {
            guestRetryCount++;
            setStatus(`Retrying connection (${guestRetryCount}/${GUEST_MAX_RETRIES})…`);
            setTimeout(() => initPeer(hostId, false), 3000);
          } else {
            setStatus('Signaling server is down. Please try again later.');
          }
        } else if (err.type === 'server-error' || err.type === 'peer-unavailable') {
          if (guestRetryCount < GUEST_MAX_RETRIES) {
            guestRetryCount++;
            setStatus(`Retrying connection (${guestRetryCount}/${GUEST_MAX_RETRIES})…`);
            setTimeout(() => initPeer(hostId, false), 3000);
          } else {
            setStatus('Signaling server is down. Please try again later.');
          }
        } else {
          console.error('Peer error:', err);
          setStatus('Error: ' + err.type);
        }
      }
    });

    peer.on('connection', (conn) => {
      dataConn = conn;
      setupDataConnection(conn);
    });

    peer.on('call', (incomingCall) => {
      incomingCall.answer(localStream || undefined);
      call = incomingCall;
      setupCallHandlers(incomingCall);
    });

    if (!tryAsHost) {
      // Guest specific actions after peer is open
      peer.on('open', () => {
        dataConn = peer.connect(hostId, { reliable: true });
        setupDataConnection(dataConn);
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
      createRoomBtn.style.display = 'none';
      roomId = location.hash.substring(1);
      const deterministicId = 'ariotica-' + roomId;
      document.title = `Room – ${roomId}`;
      updateShareLink();
      await getMedia();
      startAsGuest(deterministicId);
    } else {
      createRoomBtn.style.display = 'inline-block';
    }
  }

  window.addEventListener('hashchange', () => {
    // Do not reload – if no active peer, attempt to join the new hash as guest
    if (!peer) {
      const newRoom = location.hash.substring(1);
      if (newRoom) {
        const deterministicId = 'ariotica-' + newRoom;
        document.title = `Room – ${newRoom}`;
        updateShareLink();
        getMedia().then(() => startAsGuest(deterministicId));
      }
    }
  });

  init();
})();