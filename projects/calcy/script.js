// Simple Calculator with hash routing – pure vanilla JS
let displayEl = null;
let num1 = '';
let num2 = '';
let currentOp = '';

const routes = {
  '#/home': { title: 'Simple Calculator', sections: ['.calculator'] },
  '#/settings': { title: 'Settings', sections: ['.settings'] }
};

function init() {
  displayEl = document.getElementById('result');
  const keys = document.querySelectorAll('.key');
  const clearBtn = document.getElementById('clearBtn');
  const calcBtn = document.getElementById('calcBtn');

  keys.forEach(k => {
    if (k.dataset.num !== undefined) {
      k.addEventListener('click', () => handleNumber(k.dataset.num));
    } else if (k.dataset.op !== undefined) {
      k.addEventListener('click', () => handleOperator(k.dataset.op));
    }
  });

  clearBtn.addEventListener('click', resetCalculator);
  calcBtn.addEventListener('click', calculate);

  // navigation buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      location.hash = btn.dataset.route;
    });
  });

  window.addEventListener('hashchange', updateRoute);
  updateRoute();
}

function handleNumber(digit) {
  if (!currentOp) {
    num1 += digit;
  } else {
    num2 += digit;
  }
  updateDisplay();
}

function handleOperator(op) {
  if (num1) {
    currentOp = op;
    updateDisplay();
  } else {
    showToast('Enter a number first', 'warning');
  }
}

function updateDisplay() {
  const expr = `${num1} ${currentOp} ${num2}`.trim();
  displayEl.textContent = expr || 'Start by entering numbers';
}

function calculate() {
  const a = parseFloat(num1);
  const b = parseFloat(num2);
  if (isNaN(a) || isNaN(b) || !currentOp) {
    showToast('Complete the expression first', 'warning');
    return;
  }
  if (currentOp === '/' && b === 0) {
    showToast('Cannot divide by zero', 'error');
    displayEl.textContent = 'Error: Division by 0';
    return;
  }
  let res;
  switch (currentOp) {
    case '+': res = a + b; break;
    case '-': res = a - b; break;
    case '*': res = a * b; break;
    case '/': res = a / b; break;
    default: res = 'Error';
  }
  displayEl.textContent = `Result: ${res}`;
  showToast('Calculation successful', 'success');
  num1 = '';
  num2 = '';
  currentOp = '';
}

function resetCalculator() {
  num1 = '';
  num2 = '';
  currentOp = '';
  updateDisplay();
}

function showToast(msg, type = 'info') {
  const container = document.querySelector('.toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hidden');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createToastContainer() {
  const div = document.createElement('div');
  div.className = 'toast-container';
  document.body.appendChild(div);
  return div;
}

function updateRoute() {
  const hash = location.hash || '#/home';
  const route = routes[hash] || routes['#/home'];
  document.title = route.title;
  document.querySelectorAll('.calculator, .settings').forEach(el => el.classList.add('hidden'));
  route.sections.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.classList.remove('hidden');
  });
}

window.addEventListener('DOMContentLoaded', init);
