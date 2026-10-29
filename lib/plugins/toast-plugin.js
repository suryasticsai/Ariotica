module.exports = {
  name: 'toast-notification',
  execute: async (context) => {
    const style = `
.toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  min-width: 250px;
  padding: 0.75rem 1rem;
  background: #323232;
  color: #fff;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  font-family: sans-serif;
  opacity: 0;
  transform: translateY(-10px);
  transition: all 0.3s ease;
}
.toast.toast-visible {
  opacity: 1;
  transform: translateY(0);
}
.toast.toast-hidden {
  opacity: 0;
  transform: translateY(-10px);
}
.toast-success { background: #198754; }
.toast-error { background: #dc3545; }
.toast-warning { background: #ffc107; color: #212529; }
.toast-info { background: #0dcaf0; }
`;
    const script = `
function showToast(message, type = 'info') {
  const validTypes = ['info', 'success', 'error', 'warning'];
  if (!validTypes.includes(type)) type = 'info';
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = String(message);
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hidden');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
window.showToast = showToast;
`;
    if (context.files['style.css'] && !context.files['style.css'].includes('toast-container')) {
      context.files['style.css'] += style;
    }
    if (context.files['script.js'] && !context.files['script.js'].includes('function showToast')) {
      context.files['script.js'] += script;
    }
    if (context.files['index.html'] && !context.files['index.html'].includes('toast-container')) {
      context.files['index.html'] = context.files['index.html'].replace('</body>', `
<div class='toast-container'></div>
</body>`);
    }
  }
};