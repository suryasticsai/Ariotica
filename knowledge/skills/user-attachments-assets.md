---
name: user-attachments-assets
status: draft
source: https://github.com/user-attachments/assets/228a96ea-e65e-4784-bd86-94b9654d1f65)
created: 2026-11-01T11:35:33.395Z
---

# Session Refresh Alert Handling
Keywords: session, reload, alert, GitHub, authentication, vanilla JavaScript
## Requirements
- Detect when GitHub displays a session‑related alert (signed‑in elsewhere, signed‑out elsewhere, account switched).
- Show a custom UI element (e.g., a banner) prompting the user to reload.
- Perform a hard page reload when the user clicks the prompt.
- Work in any modern browser without external libraries.
- No placeholders for hosts or credentials.

## Pattern
```html
<!-- Add this somewhere in your page, preferably just after <body> -->
<div id="session-alert" class="session-alert hidden">
  <p>You were signed in/out elsewhere. <button id="reload-btn">Reload</button></p>
</div>
```

```css
/* Minimal styling – adjust as needed */
.session-alert {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #ffeb3b;
  color: #000;
  padding: 1rem;
  text-align: center;
  z-index: 1000;
}
.session-alert.hidden { display: none; }
```

```js
// Core logic – paste anywhere after the HTML above
(function () {
  // 1. Selector for the injected banner
  const banner = document.querySelector('#session-alert');
  const btn    = document.querySelector('#reload-btn');

  // 2. Text patterns that GitHub uses in its native alerts
  const patterns = [
    /signed in with another tab/i,
    /signed out in another tab/i,
    /switched accounts on another tab/i
  ];

  // 3. MutationObserver watches the <body> for the native GitHub alert
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const txt = node.textContent || '';
        if (patterns.some(p => p.test(txt))) {
          // Show our custom banner
          banner.classList.remove('hidden');
          // Optionally hide the native GitHub alert
          node.style.display = 'none';
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 4. Reload on user click
  btn.addEventListener('click', () => {
    // Hard reload, bypass cache
    location.reload(true);
  });

  // 5. Cleanup on page unload
  window.addEventListener('beforeunload', () => observer.disconnect());
})();
```

## Gotchas
- **MutationObserver overhead**: Only observe `childList` and `subtree` on `document.body`. Too broad observation can hurt performance on very large pages.
- **`location.reload(true)`** is deprecated in some browsers; fallback to `location.reload()` which still forces a reload in most cases.
- **Pattern brittleness**: GitHub may change alert wording; keep `patterns` array up‑to‑date.
- **Multiple alerts**: If GitHub fires several alerts simultaneously, the observer may fire multiple times—`banner` is idempotent because we simply remove the `hidden` class.
- **CSS specificity**: Ensure your `.session-alert` selector isn’t overridden by site‑wide styles (use higher specificity or `!important` as a last resort).
- **Cross‑origin restrictions**: This script runs only on pages you control; you cannot inject it into GitHub’s own domain unless you’re building a browser extension or userscript.

## Checks
- must-have-code: `location.reload(`
- must-have-selector: `#session-alert`
- must-not-have: `placeholder`