// Application name for storage prefix
const APP_PREFIX = 'taskmate_';
let tasks = [];

// DOM elements
const taskListEl = document.getElementById('taskList');
const newTaskInput = document.getElementById('newTask');
const addTaskBtn = document.getElementById('addTaskBtn');
const emptyStateEl = document.getElementById('emptyState');

// Initialize app
init();

function init() {
  loadTasks();
  renderTasks();
  addTaskBtn.addEventListener('click', handleAddTask);
  newTaskInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') handleAddTask();
  });
  window.addEventListener('hashchange', handleRouting);
  handleRouting(); // initial route
}

function loadTasks() {
  const stored = localStorage.getItem(APP_PREFIX + 'tasks');
  if (stored) {
    try { tasks = JSON.parse(stored); }
    catch { tasks = []; }
  }
}

function saveTasks() {
  localStorage.setItem(APP_PREFIX + 'tasks', JSON.stringify(tasks));
}

function renderTasks() {
  taskListEl.innerHTML = '';
  if (tasks.length === 0) {
    emptyStateEl.classList.remove('hidden');
    return;
  }
  emptyStateEl.classList.add('hidden');
  tasks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.setAttribute('data-index', i);
    li.innerHTML = `<span>${t}</span><button aria-label="Delete task">&times;</button>`;
    li.querySelector('button').addEventListener('click', () => deleteTask(i));
    taskListEl.appendChild(li);
  });
}

function handleAddTask() {
  const value = newTaskInput.value.trim();
  if (!value) return;
  tasks.push(value);
  newTaskInput.value = '';
  saveTasks();
  renderTasks();
}

function deleteTask(index) {
  tasks.splice(index, 1);
  saveTasks();
  renderTasks();
}

function handleRouting() {
  const hash = location.hash || '#/dashboard';
  const viewId = hash.replace('#/', '');
  document.title = `TaskMate - ${capitalize(viewId)}`;
  document.querySelectorAll('.view').forEach(v => {
    if (v.id === viewId) v.classList.remove('hidden');
    else v.classList.add('hidden');
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

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
