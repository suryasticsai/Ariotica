// Router (from template)
function show(id) {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.hidden = el.dataset.view !== id;
  });
  document.querySelectorAll('[data-goto]').forEach(el => {
    const on = el.dataset.goto === id;
    el.classList.toggle('is-active', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
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

// Focus Board Logic
let timerInterval = null;
let totalSeconds = 25 * 60; // 25 minutes
const timerEl = document.getElementById('timer');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function updateDisplay() {
  timerEl.textContent = formatTime(totalSeconds);
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    if (totalSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      alert('Pomodoro session completed!');
      pauseBtn.disabled = true;
      resetBtn.disabled = false;
      return;
    }
    totalSeconds--;
    updateDisplay();
  }, 1000);
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
}

function pauseTimer() {
  if (!timerInterval) return;
  clearInterval(timerInterval);
  timerInterval = null;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  totalSeconds = 25 * 60;
  updateDisplay();
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
}

startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);

// Simple task management (click to move between columns)
function createTask(text) {
  const li = document.createElement('li');
  li.className = 'list-group-item';
  li.textContent = text;
  li.style.cursor = 'pointer';
  li.addEventListener('click', () => {
    if (li.parentElement.id === 'todo') {
      document.getElementById('done').appendChild(li);
    } else {
      document.getElementById('todo').appendChild(li);
    }
  });
  return li;
}

// Add a few placeholder tasks
['Write report','Read article','Plan sprint'].forEach(t => {
  document.getElementById('todo').appendChild(createTask(t));
});

// Initial display
updateDisplay();
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
