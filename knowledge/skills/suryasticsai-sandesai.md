---
name: suryasticsai-sandesai
status: verified
source: https://github.com/suryasticsai/sandesai
created: 2026-10-29T09:27:50.137Z
---

# Refresh Connection Button  
Keywords: refresh, reconnect, network, PeerJS, Firebase, button, offline, online  

## Requirements  
- An element with `id="refreshConnectionBtn"` present in the HTML (the refresh button).  
- A globally‑accessible Firebase app instance (`firebase.initializeApp`) and Firestore (`firebase.firestore()`).  
- A PeerJS connection stored in a variable (e.g., `let peer = new Peer();`).  
- Optional UI elements to show connection status (e.g., `#statusBadge`, `#statusDot`).  

## Pattern  
```html
<!-- HTML (already present) -->
<button class="reg-btn" id="refreshConnectionBtn" title="Reconnect to network">
    <i class="fas fa-rotate-right"></i>
</button>
```

```js
/* -------------------------------------------------
   Refresh Connection Logic (vanilla JavaScript)
   ------------------------------------------------- */
(() => {
    // 1️⃣ Grab UI refs
    const btn = document.getElementById('refreshConnectionBtn');
    const statusBadge = document.getElementById('statusBadge');
    const statusDot   = document.getElementById('statusDot');
    const statusText  = document.getElementById('statusText');

    // 2️⃣ Helper to toggle UI
    const setStatus = (online) => {
        const cls = online ? 'online' : 'offline';
        statusBadge.style.display = 'inline-flex';
        statusDot.className = `status-dot-badge ${cls}`;
        statusText.textContent = online ? 'Online' : 'Offline';
    };

    // 3️⃣ Re‑initialize Firebase (no re‑load)
    const resetFirebase = async () => {
        // Close existing listeners (if any)
        if (window._firestoreUnsubscribe) {
            window._firestoreUnsubscribe();
        }
        // Re‑create Firestore instance
        const app = firebase.apps[0]; // assumes single app
        window.db = app.firestore();
        // Example: re‑attach a simple listener
        window._firestoreUnsubscribe = window.db.collection('users')
            .onSnapshot(() => setStatus(true), () => setStatus(false));
    };

    // 4️⃣ Re‑initialize PeerJS
    const resetPeer = () => {
        if (window.peer && !window.peer.destroyed) {
            window.peer.disconnect();
            window.peer.destroy();
        }
        window.peer = new Peer(undefined, {
            host: 'your-peerjs-server.com',
            port: 443,
            path: '/myapp',
            secure: true
        });

        window.peer.on('open', () => setStatus(true));
        window.peer.on('error', () => setStatus(false));
        window.peer.on('close', () => setStatus(false));
    };

    // 5️⃣ Master reset function
    const refreshConnection = async () => {
        try {
            setStatus(false);          // UI → offline while we work
            await resetFirebase();     // async Firestore reconnect
            resetPeer();               // sync PeerJS reconnect
        } catch (e) {
            console.error('Refresh failed:', e);
            // keep UI in offline state
        }
    };

    // 6️⃣ Wire button
    btn.addEventListener('click', refreshConnection);
})();
```

## Gotchas  
- **Firebase listeners** – if you have multiple `onSnapshot`/`onAuthStateChanged` callbacks, store the unsubscribe functions (`window._firestoreUnsubscribe`) and call them before creating a new Firestore instance; otherwise you’ll leak listeners.  
- **PeerJS state** – calling `peer.disconnect()` **does not** destroy the underlying socket; you must also call `peer.destroy()` before creating a fresh instance, otherwise the old socket stays open and new connections fail.  
- **Race conditions** – both Firebase and PeerJS reconnect asynchronously. If you need to guarantee that the UI shows *online* only after **both** are ready, wrap the two promises in `Promise.all([...])` and set the status inside the `.then`.  
- **Browser limits** – some mobile browsers throttle background network activity; a quick UI flash (`setStatus(false)`) prevents the user from assuming the app is still online while the underlying sockets are being torn down.  
- **CORS / TLS** – PeerJS must be served over HTTPS (`secure: true`) when the page is loaded via `https://`. Mixing protocols will silently fail and trigger the `error` event.  

## Checks  
- must-have-code: `refreshConnectionBtn.addEventListener`  
- must-have-selector: `#refreshConnectionBtn`  
- must-not-have: `debugger`