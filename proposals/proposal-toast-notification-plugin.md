# Toast Notification Plugin

Injects a lightweight toast system (CSS, container div, and JS helper) into the generated app so developers can easily show user-friendly notifications.

## Target
`lib/plugins/toast-plugin.js`

## Code
```javascript
module.exports = {
  name: 'toast-notifier',
  execute: async (context) => {
    if (!context || typeof context !== 'object') return;
    const files = context.files || {};

    const toastCSS = `/* Toast container */
#toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 1050;
}

/* Individual toast */
.toast {
  min-width: 250px;
  margin-bottom: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 0.25rem;
  color: #fff;
  background-color: rgba(0,0,0,0.85);
  opacity: 0;
  transform: translateY(-20px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.toast.show {
  opacity: 1;
  transform: translateY(0);
}
.toast.success { background-color: #28a745; }
.toast.error { background-color: #dc3545; }
.toast.info { background-color: #17a2b8; }
.toast.warning { background-color: #ffc107; color: #212529; }`;

    // Update style.css
    if (files['style.css']) {
      if (!files['style.css'].includes('#toast-container')) {
        files['style.css'] = files['style.css'].trimEnd() + '\n' + toastCSS;
      }
    } else {
      files['style.css'] = toastCSS;
    }

    // Add toast container div to index.html
    const toastDiv = '<div id="toast-container"></div>';
    if (files['index.html']) {
      if (!files['index.html'].includes('id="toast-container"')) {
        if (files['index.html'].match(/<\/body>/i)) {
          files['index.html'] = files['index.html'].replace(/<\/body>/i, toastDiv + '\n</body>');
        } else {
          files['index.html'] = files['index.html'].trimEnd() + '\n' + toastDiv;
        }
      }
    } else {
      files['index.html'] = toastDiv;
    }

    // Add JS function to script.js
    const toastJS = `function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  // trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  // remove after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => container.removeChild(toast), 300);
  }, duration);
}`;

    if (files['script.js']) {
      if (!files['script.js'].includes('function showToast')) {
        files['script.js'] = files['script.js'].trimEnd() + '\n' + toastJS;
      }
    } else {
      files['script.js'] = toastJS;
    }

    // Persist changes
    context.files = files;
  }
};
```