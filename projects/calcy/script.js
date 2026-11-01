// Simple Calculator – vanilla JS with proper declarations and hash routing
let num1 = '';
let num2 = '';
let operator = '+';
let resultDiv = null;
let numberButtons = null;
let calcBtn = null;

const routes = {
  '#/home': { title: 'Calculator', sections: ['.calculator'] },
  '#/settings': { title: 'Settings', sections: ['.settings'] },
  '#/about': { title: 'About', sections: ['.about'] }
};

function init() {
  resultDiv = document.getElementById('result');
  numberButtons = document.querySelectorAll('.num-btn');
  calcBtn = document.getElementById('calcBtn');
  const operatorSelect = document.getElementById('operator');

  numberButtons.forEach(btn => btn.addEventListener('click', () => {
    const val = btn.dataset.num;
    if (operatorSelect.value && num1 && !num2) {
      num2 += val;
    } else {
      num1 += val;
    }
    updateDisplay();
  }));

  operatorSelect.addEventListener('change', e => {
    operator = e.target.value;
  });

  calcBtn.addEventListener('click', calculate);

  // routing
  window.addEventListener('hashchange', updateRoute);
  updateRoute();
}

function updateDisplay() {
  const display = `${num1} ${operator} ${num2}`.trim();
  resultDiv.textContent = display || 'Start by entering numbers';
}

function calculate() {
  const a = parseFloat(num1);
  const b = parseFloat(num2);
  if (isNaN(a) || isNaN(b)) {
    showToast('Please enter both numbers', 'warning');
    return;
  }
  if (operator === '/' && b === 0) {
    showToast('Cannot divide by zero', 'error');
    resultDiv.textContent = 'Cannot divide by zero';
    return;
  }
  let res;
  switch (operator) {
    case '+': res = a + b; break;
    case '-': res = a - b; break;
    case '*': res = a * b; break;
    case '/': res = a / b; break;
    default: res = 'Error';
  }
  resultDiv.textContent = `Result: ${res}`;
  showToast('Calculation successful', 'success');
  // reset for next calculation
  num1 = '';
  num2 = '';
}

function showToast(message, type = 'info') {
  const container = document.querySelector('.toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
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
  // hide all sections first
  document.querySelectorAll('.calculator, .settings, .about').forEach(sec => sec.classList.add('hidden'));
  // show relevant sections
  route.sections.forEach(sel => document.querySelector(sel).classList.remove('hidden'));
}

window.addEventListener('DOMContentLoaded', init);
