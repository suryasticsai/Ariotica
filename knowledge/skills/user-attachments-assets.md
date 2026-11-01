---
name: user-attachments-assets
status: draft
source: https://github.com/user-attachments/assets/3d6b642d-12cc-452c-aa6b-07554b6376af)
created: 2026-11-01T09:42:36.386Z
---

# Session Sync Alert
Keywords: session, storage event, cross‑tab, reload, alert
## Requirements
- Detect when the user signs in/out or switches accounts in another browser tab or window.
- Show a dismissable alert prompting the user to reload the page.
- Use only vanilla JavaScript and a simple CSS selector for the alert container.
## Pattern
```html
<!-- HTML -->
<div class="session-alert hidden">
  <p>You signed in/out in another tab. <a href="#" class="reload-link">Reload</a></p>
  <button class="close-alert">✕</button>
</div>
```

```css
/* CSS */
.session-alert { 
  background:#ffeb3b; color:#000; padding:1rem; 
  position:fixed; top:0; left:0; right:0; text-align:center;
}
.session-alert.hidden { display:none; }
```

```js
/* JavaScript */
(function () {
  const ALERT_SELECTOR = '.session-alert';
  const alertEl = document.querySelector(ALERT_SELECTOR);
  if (!alertEl) return; // no alert container → nothing to do

  // Show alert
  function showAlert() { alertEl.classList.remove('hidden'); }

  // Hide alert
  function hideAlert() { alertEl.classList.add('hidden'); }

  // Reload handler
  alertEl.querySelector('.reload-link').addEventListener('click', e => {
    e.preventDefault();
    location.reload();
  });

  // Close button
  alertEl.querySelector('.close-alert').addEventListener('click', hideAlert);

  // Cross‑tab sync: listen for changes to a known key in localStorage
  window.addEventListener('storage', e => {
    if (e.key !== 'session-sync') return;
    // Any change means another tab altered the session state
    showAlert();
  });

  // Optional: broadcast own changes (e.g., after a successful login/logout)
  // window.localStorage.setItem('session-sync', Date.now());
})();
```
## Gotchas
- **Storage event only fires in *other* tabs** – the tab that writes to `localStorage` does **not** receive the event. Always write a dummy value (`Date.now()`) after login/logout to trigger other tabs.
- **Privacy mode / Safari** may block `localStorage` writes; wrap calls in `try/catch`.
- **Multiple alerts**: guard against duplicate alerts by checking `alertEl.classList.contains('hidden')` before showing.
- **Performance**: the `storage` listener is cheap, but avoid heavy work inside it; just toggle UI.
- **CSS selector specificity**: ensure `.session-alert` is unique on the page to satisfy the `must-have-selector` check.
## Checks
- must-have-code: `addEventListener('storage'`
- must-have-selector: `.session-alert`
- must-not-have: `placeholder`