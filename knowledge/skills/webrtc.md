# WebRTC 1:1 Video Call Boilerplate (PeerJS)

When building a video call app, use this exact pattern to avoid async errors.

## The Pattern
1. Initialize `const peer = new Peer();`
2. Request media immediately: `navigator.mediaDevices.getUserMedia({ video: true, audio: true })`
3. Attach local stream to `<video id="local" autoplay muted playsinline>`.
4. **CRITICAL:** Wait for `peer.on('open', (id) => { ... })` before attempting to call anyone.
5. To call: `const call = peer.call(remotePeerId, localStream);` and listen for `call.on('stream', (remoteStream) => { ... })`.
6. To answer: `peer.on('call', (call) => { call.answer(localStream); call.on('stream', ...); });`
7. Store the Room ID in `window.location.hash`. If a hash exists on load, automatically call that ID.

## Full Working Snippet
```html
<video id="local" autoplay muted playsinline></video>
<video id="remote" autoplay playsinline></video>
<button id="share">Copy Link</button>

<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"></script>
<script>
  const peer = new Peer();
  const room = location.hash.slice(1) || Math.random().toString(36).slice(2, 9);
  location.hash = room;
  
  document.getElementById('share').onclick = () => {
    navigator.clipboard.writeText(location.href);
    alert('Link copied! Send it to a friend.');
  };

  navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
    document.getElementById('local').srcObject = stream;

    peer.on('call', call => {
      call.answer(stream);
      call.on('stream', remoteStream => {
        document.getElementById('remote').srcObject = remoteStream;
      });
    });

    peer.on('open', id => {
      // If there's already a hash in the URL, it means we are the callee
      // We wait 1 second to ensure the other peer is ready, then call.
      if (location.hash.length > 1) {
        setTimeout(() => {
          const call = peer.call(room, stream);
          call.on('stream', remoteStream => {
            document.getElementById('remote').srcObject = remoteStream;
          });
        }, 1000);
      }
    });
  });
</script>