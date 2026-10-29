---
name: suryasticsai-sandesai
status: verified
source: https://github.com/suryasticsai/sandesai
created: 2026-10-29T07:55:03.642Z
---

# Refresh Connection (Vanilla JS)  
Keywords: refresh, reconnect, PeerJS, Firebase, Firestore, vanilla, JavaScript, button, network  

## Requirements  
- HTML must contain a button with `id="refreshConnectionBtn"` (already present in the UI).  
- The app uses Firebase (app, auth, firestore) and PeerJS for real‑time connections.  
- A global `peer` instance (created via `new Peer()`) and a Firebase Firestore listener should be re‑initialized on demand.  
- UI feedback (e.g., status badge) should reflect reconnect attempts.  

## Pattern  
```html
<!-- Add a small spinner for feedback (optional) -->
<span id="refreshSpinner" style="display:none;margin-left:8px;">
    <i class="fas fa-spinner fa-pulse"></i>
</span>
```

```js
/* ---------- 1. Core refresh logic ---------- */
async function refreshConnection() {
    const spinner = document.getElementById('refreshSpinner');
    spinner.style.display = 'inline-block';

    try {
        // ---- 1️⃣ Disconnect existing PeerJS connection ----
        if (window.peer && !window.peer.destroyed) {
            await new Promise((resolve) => {
                window.peer.once('close', resolve);
                window.peer.destroy();
            });
        }

        // ---- 2️⃣ Re‑initialize PeerJS ----
        window.peer = new Peer(undefined, {
            host: 'your-peerjs-server.com', // replace with actual host
            port: 443,
            secure: true,
        });

        window.peer.on('open', (id) => {
            console.log('Peer re‑connected with ID:', id);
            // You may want to update UI with the new ID
            document.getElementById('myNumberDisplay').textContent = id;
        });

        window.peer.on('error', (err) => console.error('Peer error:', err));

        // ---- 3️⃣ Re‑attach Firestore listeners (example) ----
        // Assume you have a function `attachChatListeners()` that sets up
        // real‑time snapshots for the current chat collection.
        if (window.detachChatListeners) window.detachChatListeners(); // clean old unsubscribes
        window.detachChatListeners = attachChatListeners(); // returns an unsubscribe fn

        // ---- 4️⃣ UI success state ----
        showStatus('online', 'Reconnected');
    } catch (e) {
        console.error('Refresh failed:', e);
        showStatus('offline', 'Refresh failed');
    } finally {
        spinner.style.display = 'none';
    }
}

/* ---------- 2. Helper to toggle status badge ---------- */
function showStatus(state, text) {
    const badge = document.getElementById('statusBadge');
    const dot   = document.getElementById('statusDot');

    badge.style.display = 'inline-flex';
    dot.style.backgroundColor = state === 'online' ? '#4ade80' : '#ef4444';
    document.getElementById('statusText').textContent = text;
}

/* ---------- 3. Wire the button ---------- */
document
    .getElementById('refreshConnectionBtn')
    .addEventListener('click', refreshConnection);

/* ---------- 4. Example Firestore listener wrapper ---------- */
function attachChatListeners() {
    const userId = firebase.auth().currentUser?.uid;
    if (!userId) return () => {};

    const chatRef = firebase.firestore()
        .collection('chats')
        .where('participants', 'array-contains', userId);

    const unsubscribe = chatRef.onSnapshot((snap) => {
        // render chat list, messages, etc.
        console.log('Chat snapshot:', snap.docs.map(d => d.id));
    }, (err) => console.error('Firestore error:', err));

    // Return a function that can be called to stop listening
    return unsubscribe;
}
```

## Gotchas  
- **PeerJS cleanup**: Always wait for the `'close'` event before creating a new `Peer`; otherwise you may hit “Peer already exists” errors.  
- **Firebase auth latency**: If the user is not yet authenticated when `refreshConnection` runs, `firebase.auth().currentUser` will be `null`. Guard against it or trigger a re‑login flow.  
- **Multiple listeners**: `onSnapshot` returns an unsubscribe function; forgetting to call it will stack duplicate listeners, causing UI duplication and memory leaks.  
- **Network‑flaky environments**: On mobile networks, rapid consecutive clicks can overwhelm the server. Debounce the button (e.g., 2 s) if needed.  
- **CORS / host config**: PeerJS requires the correct `host`, `port`, and `secure` flags; mismatched values will reject the connection silently.  
- **UI feedback**: The spinner (`#refreshSpinner`) is optional but recommended to avoid “dead” UI during async reconnection.  

## Checks  
- must-have-code: `refreshConnectionBtn.addEventListener`  
- must-have-selector: `#refreshConnectionBtn`  
- must-not-have: `$(`