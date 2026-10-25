// Peer2Peer Voice & Chat Messenger using PeerJS
(() => {
  const localAudioEl = document.getElementById('local-audio');
  const remoteAudioEl = document.getElementById('remote-audio');
  const copyBtn = document.getElementById('copy-btn');
  const shareLinkEl = document.getElementById('share-link');
  const toggleAudioBtn = document.getElementById('toggle-audio');
  const messagesEl = document.getElementById('messages');
  const msgForm = document.getElementById('msg-form');
  const msgInput = document.getElementById('msg-input');
  const emptyStateEl = document.getElementById('empty-state');

  let localStream = null;
  let peer = null;
  let dataConn = null;
  let callObj = null;
  let isMuted = false;

  // Helper to add chat message
  function addMessage(text, fromSelf) {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.textAlign = fromSelf ? 'right' : 'left';
    messagesEl.appendChild(li);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    // Hide empty state after first message
    if (emptyStateEl) emptyStateEl.style.display = 'none';
  }

  // Copy share link to clipboard
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  });

  // Mute / unmute microphone
  toggleAudioBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
    toggleAudioBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  });

  // Handle sending chat messages
  msgForm.addEventListener('submit', e => {
    e.preventDefault();
    const msg = msgInput.value.trim();
    if (!msg) return;
    addMessage(msg, true);
    if (dataConn && dataConn.open) dataConn.send(msg);
    msgInput.value = '';
  });

  // Initialize PeerJS and media
  async function init() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localAudioEl.srcObject = localStream;
    } catch (err) {
      alert('Microphone access denied. The app cannot work without it.');
      console.error(err);
      return;
    }

    peer = new Peer();

    peer.on('open', id => {
      // If there is no hash, we are the host – use our peer id as room identifier
      if (!location.hash) {
        location.hash = id;
        updateShareLink(id);
        document.title = `Room – ${id}`;
      } else {
        const remoteId = location.hash.substring(1);
        document.title = `Room – ${remoteId}`;
        // Connect data channel
        dataConn = peer.connect(remoteId);
        dataConn.on('open', () => console.log('Data connection open'));
        dataConn.on('data', data => addMessage(data, false));
        dataConn.on('error', err => console.error('Data connection error', err));
        // Initiate audio call
        callObj = peer.call(remoteId, localStream);
        setupCallHandlers(callObj);
      }
    });

    // Incoming data connections (when we are the host)
    peer.on('connection', conn => {
      dataConn = conn;
      dataConn.on('open', () => console.log('Incoming data connection open'));
      dataConn.on('data', data => addMessage(data, false));
      dataConn.on('error', err => console.error('Incoming data error', err));
    });

    // Incoming audio call
    peer.on('call', call => {
      call.answer(localStream);
      setupCallHandlers(call);
    });

    peer.on('error', err => console.error('Peer error', err));
  }

  function setupCallHandlers(call) {
    call.on('stream', remoteStream => {
      remoteAudioEl.srcObject = remoteStream;
    });
    call.on('close', () => console.log('Call closed'));
    call.on('error', err => console.error('Call error', err));
  }

  function updateShareLink(id) {
    const url = `${location.origin}${location.pathname}#${id}`;
    shareLinkEl.textContent = url;
  }

  // Listen to hash changes – allow joining a different room without reload
  window.addEventListener('hashchange', () => {
    // Simple reload to reset state (keeps implementation straightforward)
    location.reload();
  });

  // Kick off
  init();
})();