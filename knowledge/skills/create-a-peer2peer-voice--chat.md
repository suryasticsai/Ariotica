# 📡 Peer‑to‑Peer Voice & Text Messenger (WebRTC) – Vanilla JS Cheatsheet  

*All snippets are self‑contained; paste into a `<script type="module">` block or a separate .js file.*  

---  

## 1. HTML Skeleton  

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>P2P Messenger</title></head>
<body>
  <video id="local" autoplay muted playsinline></video>
  <video id="remote" autoplay playsinline></video>

  <textarea id="log" rows="8" readonly></textarea>
  <input id="msg" placeholder="Type a message…" />
  <button id="send">Send</button>

  <script type="module" src="app.js"></script>
</body>
</html>
```

*`local` shows your mic/video, `remote` shows the peer, `log` is a debug console.*

---  

## 2. Signaling (WebSocket) – the only non‑WebRTC part  

A minimal signaling server is required to exchange SDP & ICE.  

```js
// app.js – create a single WS connection per page
const SIGNALING_URL = 'wss://your‑signaling.example.com';
const ws = new WebSocket(SIGNALING_URL);

ws.addEventListener('open', () => log('🔗 Signaling ready'));
ws.addEventListener('message', e => handleSignal(JSON.parse(e.data)));

function sendSignal(payload) {
  ws.send(JSON.stringify(payload));
}
```

**Best practice:**  
* Use TLS (wss://).  
* Authenticate users before allowing a room join.  
* Prefix messages with a `type` field (`offer`, `answer`, `ice`, `join`).

---  

## 3. Acquire Media (Audio + Video)  

```js
async function getLocalStream() {
  const constraints = { audio: true, video: true };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  document.getElementById('local').srcObject = stream;
  return stream;
}
```

*Always request the exact tracks you need; avoid `true` for both if you only need voice.*  

---  

## 4. Create the RTCPeerConnection  

```js
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  // Optional TURN for NAT traversal
  // { urls: 'turn:turn.example.com', username: 'user', credential: 'pass' }
];

let pc = null;          // will hold RTCPeerConnection
let dataChannel = null; // reliable text channel

function createPeer(isCaller) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // --- ICE handling -------------------------------------------------
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendSignal({ type: 'ice', candidate });
  };
  pc.oniceconnectionstatechange = () => {
    log('ICE state: ' + pc.iceConnectionState);
  };

  // --- Remote stream ------------------------------------------------
  pc.ontrack = ({ streams }) => {
    document.getElementById('remote').srcObject = streams[0];
  };

  // --- Data channel (text) -----------------------------------------
  if (isCaller) {
    dataChannel = pc.createDataChannel('chat', { ordered: true });
    setupDataChannel();
  } else {
    pc.ondatachannel = e => {
      dataChannel = e.channel;
      setupDataChannel();
    };
  }

  // Attach local tracks
  getLocalStream().then(stream => {
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    if (isCaller) makeOffer();
  });
}
```

**Tip:** Keep a single `RTCPeerConnection` per conversation; reuse for reconnection.

---  

## 5. SDP Offer / Answer  

```js
async function makeOffer() {
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  sendSignal({ type: 'offer', sdp: pc.localDescription });
}

async function handleOffer(sdp) {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({ type: 'answer', sdp: pc.localDescription });
}
```

---  

## 6. ICE Candidate Exchange  

```js
function handleSignal(msg) {
  switch (msg.type) {
    case 'join':        // peer entered same room
      if (!pc) createPeer(true); // caller side
      break;
    case 'offer':       handleOffer(msg.sdp); break;
    case 'answer':      pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); break;
    case 'ice':
      if (msg.candidate) pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      break;
  }
}
```

---  

## 7. Data Channel – Text Messaging  

```js
function setupDataChannel() {
  dataChannel.onopen = () => log('💬 Data channel ready');
  dataChannel.onmessage = e => appendMessage('Peer', e.data);
  dataChannel.onerror = e => console.error('DC error', e);
}

// UI wiring
document.getElementById('send').onclick = () => {
  const txt = document.getElementById('msg').value;
  if (txt && dataChannel?.readyState === 'open') {
    dataChannel.send(txt);
    appendMessage('You', txt);
    document.getElementById('msg').value = '';
  }
};

function appendMessage(sender, text) {
  const log = document.getElementById('log');
  log.value += `${sender}: ${text}\n`;
  log.scrollTop = log.scrollHeight;
}
```

**Best practice:**  
* Use `ordered:true` for chat; for file transfer you may prefer `unordered:true, maxRetransmits:0`.  
* Validate incoming payloads – never trust peer data.

---  

## 8. Clean‑up & Reconnection  

```js
function closeConnection() {
  dataChannel?.close();
  pc?.close();
  pc = null;
  dataChannel = null;
  log('🔚 Connection closed');
}

// Optional: auto‑reconnect on `iceConnectionState === "failed"`
pc?.addEventListener('iceconnectionstatechange', () => {
  if (pc.iceConnectionState === 'failed') {
    log('⚠️ ICE failed – restarting');
    pc.restartIce();
  }
});
```

---  

## 9. Security Checklist  

| ✅ | Item |
|---|------|
| ✅ | Serve page over **HTTPS** (required for `getUserMedia` & `RTCPeerConnection`). |
| ✅ | Use **WSS** for signaling; authenticate users (JWT, cookies). |
| ✅ | Limit media constraints to needed tracks (audio‑only for voice‑only app). |
| ✅ | Enable **ICE gathering timeout** (`iceTransportPolicy: 'relay'` only if you have TURN). |
| ✅ | Sanitize all UI inputs before sending over data channel. |
| ✅ | Periodically verify `pc.signalingState` – abort on `closed`. |

---  

## 10. Full Minimal Flow (copy‑paste)  

```js
// app.js – minimal end‑to‑end example
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9.0.0/+esm';

const ROOM = location.hash.slice(1) || uuidv4(); // auto‑generated room
log(`🪄 Room: ${ROOM}`);

ws.addEventListener('open', () => sendSignal({ type: 'join', room: ROOM }));

// --------------------------------------------------------------
function log(msg) { document.getElementById('log').value += msg + '\n'; }
// --------------------------------------------------------------
// All functions from sections 2‑8 go here (copy them in order)
// --------------------------------------------------------------
```

> **Result:** Open the page on two browsers (same room hash or auto‑generated). After signaling, you’ll see local/remote video, can speak, and exchange typed messages instantly—no server‑side media handling required.  