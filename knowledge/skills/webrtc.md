---
name: webrtc
status: verified
---
# WebRTC peer-to-peer voice, video and chat (PeerJS, static hosting)

Keywords: webrtc, peer2peer, p2p, peer-to-peer, peerjs, voice call, video call, audio call, chat messenger, text chat, data channel, room link, mute, hang up, camera toggle, video chat app

This runs on GitHub Pages with no server of our own. PeerJS Cloud does the signaling, so never write a WebSocket signaling server or raw offer/answer/ICE code. Load PeerJS from the approved CDN: `https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js` (use the global `Peer`).

## Required features for a "voice + chat messenger" (build ALL of them)

1. Audio call, with an optional camera. Offer a "Camera" toggle; default is audio only.
2. Text chat over a PeerJS DataConnection (works even if the mic is blocked).
3. Controls: Start/Join, Hang up, Mute/Unmute mic, Camera on/off, Send, Copy invite link.
4. Status line that always reflects state: Idle, Getting microphone, Waiting for a friend, Connecting, Connected, Call ended, Error: <reason>.
5. Room link in `location.hash`, copy-to-clipboard button, and a clear "share this link" hint.
6. Chat log with sender, time and an empty state. Render messages with `textContent` only.
7. Graceful errors: mic denied, no device, peer unavailable, peer disconnected.
8. Responsive layout, large touch targets, `aria-live="polite"` on status and chat log.

## Room model: deterministic host id (no id exchange needed)

- `room = location.hash.slice(1)`. If empty, create `room = random 6-8 chars` and set `location.hash = room`.
- Host id is `'ariotica-' + room`. Everyone first tries to become the host: `new Peer(hostId)`.
- If PeerJS reports `err.type === 'unavailable-id'`, somebody already hosts this room, so destroy that peer, create `new Peer()` (random id) and become the guest.
- The guest connects to the host: `peer.connect(hostId)` for chat and `peer.call(hostId, stream)` for audio.
- The host handles `peer.on('connection')` and `peer.on('call')`.
- Wait for `peer.on('open')` before connecting or calling.

## Pattern

```js
let peer, conn, call, localStream, micOn = true;
const $ = (id) => document.getElementById(id);

function setStatus(t) { $('status').textContent = t; }

async function getMedia(withVideo) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!withVideo });
    $('local').srcObject = localStream;            // <video id="local" autoplay muted playsinline>
  } catch (e) {
    localStream = null;                            // keep going: chat still works
    setStatus('Microphone unavailable (' + e.name + '). Chat only.');
  }
}

function start(hostId, withVideo) {
  peer = new Peer(hostId);
  peer.on('open', () => { setStatus('Waiting for a friend…'); });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') { peer.destroy(); joinAsGuest(hostId); }
    else if (err.type === 'peer-unavailable') setStatus('Nobody is in this room yet.');
    else setStatus('Error: ' + err.type);
  });
  peer.on('connection', (c) => wireChat(c));
  peer.on('call', (c) => { call = c; c.answer(localStream || undefined); wireCall(c); });
}

function joinAsGuest(hostId) {
  peer = new Peer();
  peer.on('open', () => {
    wireChat(peer.connect(hostId, { reliable: true }));
    if (localStream) { call = peer.call(hostId, localStream); wireCall(call); }
    setStatus('Connecting…');
  });
  peer.on('error', (err) => setStatus('Error: ' + err.type));
}

function wireCall(c) {
  c.on('stream', (s) => { $('remote').srcObject = s; setStatus('Connected'); });  // <video id="remote" autoplay playsinline>
  c.on('close', () => setStatus('Call ended'));
}

function wireChat(c) {
  conn = c;
  c.on('open', () => { setStatus('Connected'); $('send').disabled = false; });
  c.on('data', (d) => addMessage('Friend', String(d).slice(0, 2000)));
  c.on('close', () => { $('send').disabled = true; setStatus('Friend left'); });
}

function addMessage(who, text) {
  const li = document.createElement('li');
  li.textContent = who + ': ' + text;              // never innerHTML
  $('log').append(li);
  li.scrollIntoView({ block: 'end' });
}

function sendMessage() {
  const t = $('msg').value.trim();
  if (!t || !conn || !conn.open) return;
  conn.send(t); addMessage('You', t); $('msg').value = '';
}

function toggleMic() {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach((t) => { t.enabled = micOn; });
  $('mute').textContent = micOn ? 'Mute' : 'Unmute';
  $('mute').setAttribute('aria-pressed', String(!micOn));
}

function toggleCamera() {
  if (!localStream) return;
  localStream.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
}

function hangUp() {
  if (call) call.close();
  if (conn) conn.close();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  if (peer) peer.destroy();
  setStatus('Call ended');
}
```

## Gotchas

- Start from a user click ("Start" / "Join"): browsers block autoplay audio and some block `getUserMedia` otherwise.
- `getUserMedia` needs HTTPS (GitHub Pages is fine) and the user's permission. Always handle `NotAllowedError` and `NotFoundError`.
- Answering with no stream (`c.answer()`) is allowed, so a listener without a mic can still hear the caller.
- Use `reliable: true` on the DataConnection for chat.
- Two tabs of the same browser can test the flow, but use headphones to avoid echo.
- Strict corporate networks may need a TURN server. Pass `new Peer(id, { config: { iceServers: [...] } })` only if the user supplies one. Never invent credentials.
- Do not store the room or messages on a server. If you persist anything, use `localStorage` keys prefixed with the app name.
