---
name: user-attachments-assets
status: draft
source: https://github.com/user-attachments/assets/4eb2e782-6732-4542-8ce3-4a0085cdb989)
created: 2026-11-01T04:53:42.766Z
---

# GitHub Session Refresh
Keywords: github, session, reload, auth, tab sync
## Requirements
- Detect when the GitHub auth state changes in another tab.
- Show a dismissible alert prompting the user to reload.
- Automatically reload the page when the user confirms.
- Works in any vanilla JS web page embedding GitHub auth flows.
## Pattern
```html
<!-- Alert container (must exist) -->
<div id="auth-alert" class="hidden">
  <p>You signed in/out in another tab. <button id="reload-btn">Reload</button></p>
</div>
```

```js
// must-have-code: window.addEventListener('storage', handleStorage);
(function () {
  const ALERT_SELECTOR = '#auth-alert';
  const RELOAD_BTN = '#reload-btn';

  const alertEl = document.querySelector(ALERT_SELECTOR);
  const reloadBtn = document.querySelector(RELOAD_BTN);

  // Show alert when storage event signals auth change
  function handleStorage(e) {
    if (e.key === 'github-auth-event' && e.newValue) {
      alertEl.classList.remove('hidden');
    }
  }

  // Reload page on user click
  reloadBtn.addEventListener('click', () => location.reload());

  // Listen for cross‑tab auth changes
  window.addEventListener('storage', handleStorage);
})();
```

```js
// In any other tab/window where auth changes (login/logout)
function broadcastAuthChange() {
  // must-have-code: localStorage.setItem('github-auth-event', Date.now());
  localStorage.setItem('github-auth-event', Date.now());
  // clean up so future events fire
  setTimeout(() => localStorage.removeItem('github-auth-event'), 0);
}
```
## Gotchas
- **Storage event only fires in other tabs**, not in the same tab that wrote the value.
- The `localStorage` key must be unique to avoid clashing with other apps.
- Some browsers (Safari private mode) may block `localStorage`; fallback to `BroadcastChannel` if needed.
- Ensure the alert element is initially hidden via CSS (`.hidden { display:none; }`).
- Debounce rapid login/logout cycles to avoid flickering alerts.
## Checks
- must-have-code: window.addEventListener('storage', handleStorage);
- must-have-selector: #auth-alert
- must-not-have: placeholder-host.com