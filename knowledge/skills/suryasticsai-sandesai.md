---
name: suryasticsai-sandesai
status: verified
source: https://github.com/suryasticsai/sandesai
created: 2026-10-29T09:02:47.413Z
---

# Refresh Connection Button
**Keywords:** reconnect, network, peerjs, firebase, refresh, button, vanilla js  

## Requirements
- An HTML button with `id="refreshConnectionBtn"` (already present in the markup).  
- A global or module‑scoped PeerJS instance named `peer` (created elsewhere in the app).  
- Optional: a status badge element (`#statusBadge` / `#statusDot`) to show “Reconnecting…”.  
- The script must run **after** the DOM is ready (e.g., placed at the end of `<body>` or wrapped in `DOMContentLoaded`).  

## Pattern
```html
<!-- Include this script after the PeerJS initialization -->
<script>
document.addEventListener('DOMContentLoaded', () => {
  // -----------------------------------------------------------------
  // 1️⃣ Grab UI elements
  // -----------------------------------------------------------------
  const btn   = document.getElementById('refreshConnectionBtn');
  const badge = document.getElementById('statusBadge');
  const dot   = document.getElementById('statusDot');

  // -----------------------------------------------------------------
  // 2️⃣ Helper: toggle UI while reconnecting
  // -----------------------------------------------------------------
  const setBusy = (busy) => {
    btn.disabled = busy;
    badge.style.display = busy ? 'inline-flex' : 'none';
    if (dot) dot.style.background = busy ? '#ffb400' : '#4caf50';
  };

  // -----------------------------------------------------------------
  // 3️⃣ Core: attempt PeerJS reconnection
  // -----------------------------------------------------------------
  const reconnect = async () => {
    if (!window.peer) {
      console.warn('PeerJS instance not found – nothing to reconnect.');
      return;
    }
    setBusy(true);
    try {
      // PeerJS 1.x provides .reconnect() – fallback to .destroy() + new Peer()
      if (typeof peer.reconnect === 'function') {
        await peer.reconnect();               // ✅ must‑have‑code
      } else {
        // Manual recreation (preserves original config)
        const cfg = peer.options || {};
        peer.destroy();
        window.peer = new Peer(cfg);
        await new Promise((res, rej) => {
          peer.once('open', res);
          peer.once('error', rej);
        });
      }
      console.info('🔌 Reconnected successfully');
    } catch (e) {
      console.error('❌ Reconnect failed', e);
      // Optional: retry after a back‑off
    } finally {
      setBusy(false);
    }
  };

  // -----------------------------------------------------------------
  // 4️⃣ Wire UI → logic
  // -----------------------------------------------------------------
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    reconnect();
  });
});
</script>
```

### Quick‑copy version
```js
document.getElementById('refreshConnectionBtn')
  .addEventListener('click', async () => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      if (peer.reconnect) await peer.reconnect();
      else {
        const cfg = peer.options || {};
        peer.destroy();
        window.peer = new Peer(cfg);
        await new Promise((res, rej) => {
          peer.once('open', res);
          peer.once('error', rej);
        });
      }
      console.log('Reconnected');
    } catch (err) { console.error(err); }
    btn.disabled = false;
  });
```

## Gotchas
- **Undefined `peer`** – ensure the PeerJS instance is attached to `window.peer` (or import it) *before* this script runs.  
- **Multiple rapid clicks** – the button is disabled during the async flow to avoid race conditions.  
- **Browser‑level throttling** – some browsers limit reconnection attempts; implement an exponential back‑off if you need repeated retries.  
- **Network offline** – `navigator.onLine` can be checked first; otherwise the promise will reject instantly.  
- **Memory leaks** – calling `peer.destroy()` without recreating a new instance leaves old event listeners dangling.  
- **Firebase listeners** – if you also rely on Firestore real‑time listeners, they survive a PeerJS reconnect; however, if you close the whole app socket, you may need to re‑subscribe after `peer.reconnect()`.  

## Checks
- **must-have-code:** `refreshConnectionBtn.addEventListener`  
- **must-have-selector:** `#refreshConnectionBtn`  
- **must-not-have:** `alert(`