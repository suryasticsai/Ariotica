// Variables
let currentTheme = 'light';
const themeToggle = document.getElementById('toggle-theme');
const addTaskBtn = document.getElementById('add-task');
const columns = document.getElementById('columns');
const statuses = ['todo', 'inprogress', 'done'];
// Router (from template)
function show(id) {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.hidden = el.dataset.view !== id;
  });
  document.querySelectorAll('[data-goto]').forEach(el => {
    const on = el.dataset.goto === id;
    el.classList.toggle('is-active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}
document.addEventListener('click', event => {
  const go = event.target.closest('[data-goto]');
  if (go) return show(go.dataset.goto);
  const sw = event.target.closest('[role="switch"]');
  if (sw) {
    const on = sw.getAttribute('aria-checked') === 'true';
    sw.setAttribute('aria-checked', String(!on));
  }
});
// Theme toggle
function applyTheme() {
  if (currentTheme === 'dark') {
    document.documentElement.style.setProperty('--background', '#2c3e50');
    document.documentElement.style.setProperty('--text', '#ecf0f1');
  } else {
    document.documentElement.style.setProperty('--background', '#ecf0f1');
    document.documentElement.style.setProperty('--text', '#2c3e50');
  }
}
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme();
  });
}
// Task handling
function createTask(text) {
  const li = document.createElement('li');
  li.className = 'list-group-item';
  li.textContent = text;
  li.draggable = true;
  li.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', e.target.textContent);
    e.target.classList.add('dragging');
  });
  li.addEventListener('dragend', e => {
    e.target.classList.remove('dragging');
  });
  return li;
}
function initBoard() {
  statuses.forEach(status => {
    const ul = document.getElementById(status);
    ul.addEventListener('dragover', e => e.preventDefault());
    ul.addEventListener('drop', e => {
      e.preventDefault();
      const text = e.dataTransfer.getData('text/plain');
      const item = createTask(text);
      ul.appendChild(item);
    });
  });
}
if (addTaskBtn) {
  addTaskBtn.addEventListener('click', () => {
    const txt = prompt('Task description');
    if (txt) {
      const task = createTask(txt);
      document.getElementById('todo').appendChild(task);
    }
  });
}
// Initialize
applyTheme();
initBoard();
show('home');
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
