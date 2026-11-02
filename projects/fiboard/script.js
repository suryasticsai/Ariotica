// Simple view router and habit toggle logic
function show(id) {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.hidden = el.dataset.view !== id;
  });
  document.querySelectorAll('[data-goto]').forEach(el => {
    const active = el.dataset.goto === id;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}
function updateStats() {
  const statsContainer = document.getElementById('stats-list');
  statsContainer.innerHTML = '';
  const habits = document.querySelectorAll('.list__item');
  habits.forEach(item => {
    const title = item.querySelector('.list__title').textContent.trim();
    const sw = item.querySelector('.switch');
    const completed = sw.getAttribute('aria-checked') === 'true';
    const dt = document.createElement('dt');
    dt.textContent = title;
    const dd = document.createElement('dd');
    dd.textContent = completed ? '✓' : '✗';
    const wrapper = document.createElement('div');
    wrapper.appendChild(dt);
    wrapper.appendChild(dd);
    statsContainer.appendChild(wrapper);
  });
}
document.addEventListener('click', e => {
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    show(goto.dataset.goto);
    return;
  }
  const sw = e.target.closest('[role="switch"]');
  if (sw) {
    const on = sw.getAttribute('aria-checked') === 'true';
    sw.setAttribute('aria-checked', String(!on));
    updateStats();
  }
});
// Initialize stats on load
updateStats();
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