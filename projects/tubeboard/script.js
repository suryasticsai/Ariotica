// Router (unchanged)
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

// Habit Tracker Logic
const habitList = document.getElementById('habitList');
const addBtn = document.getElementById('addHabitBtn');
const newHabitInput = document.getElementById('newHabit');
const completedCountEl = document.getElementById('completedCount');
const totalCountEl = document.getElementById('totalCount');

let habits = [];

function renderHabits() {
  habitList.innerHTML = '';
  habits.forEach((h, i) => {
    const li = document.createElement('li');
    li.className = 'list__item';
    li.innerHTML = `<p><span class="list__title">${h.name}</span></p>
      <button class="switch" role="switch" aria-checked="${h.done}" aria-label="Mark ${h.name} as done"></button>`;
    habitList.appendChild(li);
  });
  updateStats();
}

function updateStats() {
  const total = habits.length;
  const completed = habits.filter(h => h.done).length;
  totalCountEl.textContent = total;
  completedCountEl.textContent = completed;
}

addBtn.addEventListener('click', () => {
  const name = newHabitInput.value.trim();
  if (!name) return;
  habits.push({ name, done: false });
  newHabitInput.value = '';
  renderHabits();
});

// Delegate toggle for habit switches
habitList.addEventListener('click', e => {
  const sw = e.target.closest('[role="switch"]');
  if (!sw) return;
  const idx = Array.from(habitList.children).indexOf(sw.closest('li'));
  habits[idx].done = !habits[idx].done;
  sw.setAttribute('aria-checked', String(habits[idx].done));
  updateStats();
});

// Reset button in settings
document.getElementById('resetBtn')?.addEventListener('click', () => {
  habits = [];
  renderHabits();
});

// Initialize default view
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
