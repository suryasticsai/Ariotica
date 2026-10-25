(function(){
  const localAudioEl = document.getElementById('local-audio');
  const remoteAudioEl = document.getElementById('remote-audio');
  const copyBtn = document.getElementById('copy-btn');
  const shareLinkEl = document.getElementById('share-link');
  const createRoomBtn = document.getElementById('create-room');
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
  let isHost = false;
  let roomId = null;

  function addMessage(text, fromSelf) {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.textAlign = fromSelf ? 'right' : 'left';
    messagesEl.appendChild(li);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (emptyStateEl) emptyStateEl.style.display = 'none';
  }

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  });

  toggleAudioBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
    toggleAudioBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  });

  msgForm.addEventListener('submit', e => {
    e.preventDefault();
    const msg = msgInput.value.trim();
    if (!msg) return;
    addMessage(msg, true);
    if (dataConn && dataConn.open) dataConn.send(msg);
    msgInput.value = '';
  });

  createRoomBtn.addEventListener('click', () => {
    roomId = Math.random().toString(36).substring(2, 8);
    isHost = true;
    location.hash = roomId;
    updateUIForRoom();
    initPeer();
  });

  function updateShareLink(){
    const url = `${location.origin}${location.pathname}#${roomId}`;
    shareLinkEl.textContent = url;
  }

  function updateUIForRoom(){
    createRoomBtn.style.display = 'none';
    updateShareLink();
    document.title = `Room – ${roomId}`;
  }

  async function init(){
    if (location.hash) {
      roomId = location.hash.substring(1);
      isHost = false;
      updateUIForRoom();
      await startMedia();
      initPeer();
    } else {
      createRoomBtn.style.display = 'inline-block';
      await startMedia();
    }
  }

  async function startMedia(){
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localAudioEl.srcObject = localStream;
    } catch (err) {
      alert('Microphone access denied. The app cannot work without it.');
      console.error(err);
    }
  }

  function initPeer(){
    peer = new Peer();
    peer.on('open', id => {
      if (isHost) {
        document.title = `Room – ${roomId}`;
        updateShareLink();
      } else {
        dataConn = peer.connect(roomId);
        dataConn.on('open', () => console.log('Data connection open'));
        dataConn.on('data', data => addMessage(data, false));
        dataConn.on('error', err => console.error('Data connection error', err));
        callObj = peer.call(roomId, localStream);
        setupCallHandlers(callObj);
      }
    });
    peer.on('connection', conn => {
      if (!isHost) return;
      dataConn = conn;
      dataConn.on('open', () => console.log('Incoming data connection open'));
      dataConn.on('data', data => addMessage(data, false));
      dataConn.on('error', err => console.error('Incoming data error', err));
    });
    peer.on('call', call => {
      call.answer(localStream);
      setupCallHandlers(call);
    });
    peer.on('error', err => console.error('Peer error', err));
  }

  function setupCallHandlers(call){
    call.on('stream', remoteStream => {
      remoteAudioEl.srcObject = remoteStream;
    });
    call.on('close', () => console.log('Call closed'));
    call.on('error', err => console.error('Call error', err));
  }

  window.addEventListener('hashchange', () => {
    location.reload();
  });

  init();
})();