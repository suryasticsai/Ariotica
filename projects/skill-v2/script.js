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

  const setStatus = (text) => (statusEl.textContent = text);

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
      // If we already have an audio track, keep it when adding video
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
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.textContent = `${who}: ${text}`;
    log.appendChild(li);
    li.scrollIntoView({ block: 'end' });
  };

  const sendMessage = () => {
    const txt = msgInput.value.trim();
    if (!txt || !conn || !conn.open) return;
    conn.send(txt);
    addMessage('You', txt);
    msgInput.value = '';
    msgInput.focus();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink.value);
    } catch (_) {
      fallbackCopy();
    }
  };

  const fallbackCopy = () => {
    shareLink.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      // ignore
    }
  };

  const resetUI = () => {
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    localVideo.classList.add('placeholder');
    remoteVideo.classList.add('placeholder');
    startBtn.disabled = false;
    muteBtn.disabled = true;
    cameraBtn.disabled = true;
    hangupBtn.disabled = true;
    sendBtn.disabled = true;
    shareLink.value = '';
    setStatus('Idle');
    log.innerHTML = '<li class="empty" aria-live="polite">No messages yet. Say hello!</li>';
  };

  const hangUp = () => {
    if (call) call.close();
    if (conn) conn.close();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (peer) peer.destroy();
    call = null;
    conn = null;
    peer = null;
    resetUI();
  };

  const wireChat = (c) => {
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
  };

  const wireCall = (c) => {
    call = c;
    c.on('stream', (s) => {
      remoteVideo.srcObject = s;
      remoteVideo.classList.remove('placeholder');
      setStatus('Connected');
    });
    c.on('close', () => {
      setStatus('Call ended');
    });
  };

  const startOrJoin = async () => {
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
  };

  const joinAsGuest = (hostId) => {
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
  };

  // Event bindings
  startBtn.addEventListener('click', startOrJoin);
  startBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startOrJoin();
  });

  muteBtn.addEventListener('click', toggleMic);
  cameraBtn.addEventListener('click', async () => {
    if (!localStream) {
      await getMedia(true);
    } else if (!videoOn) {
      // Enable video track without renegotiating call – PeerJS will send updated stream automatically
      toggleCamera();
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

  // Update title & share link on hash change (manual navigation)
  window.addEventListener('hashchange', () => {
    updateTitle();
    updateShareLink();
  });

  // Initial setup
  updateTitle();
  updateShareLink();
});