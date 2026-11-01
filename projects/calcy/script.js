// Simple Calculator – vanilla JS
// Declare variables at top
let num1Input = null;
let num2Input = null;
let operatorSelect = null;
let calcBtn = null;
let resultDiv = null;

function init() {
  num1Input = document.getElementById('num1');
  num2Input = document.getElementById('num2');
  operatorSelect = document.getElementById('operator');
  calcBtn = document.getElementById('calcBtn');
  resultDiv = document.getElementById('result');

  calcBtn.addEventListener('click', handleCalc);
}

function handleCalc() {
  const a = parseFloat(num1Input.value);
  const b = parseFloat(num2Input.value);
  const op = operatorSelect.value;

  if (isNaN(a) || isNaN(b)) {
    updateResult('Please enter both numbers');
    showToast('Both numbers are required', 'warning');
    return;
  }
  if (op === '/' && b === 0) {
    updateResult('Cannot divide by zero');
    showToast('Division by zero', 'error');
    return;
  }

  let res;
  switch (op) {
    case '+': res = a + b; break;
    case '-': res = a - b; break;
    case '*': res = a * b; break;
    case '/': res = a / b; break;
    default: res = 'Error';
  }
  updateResult(`Result: ${res}`);
  showToast('Calculation successful', 'success');
}

function updateResult(message) {
  resultDiv.textContent = message;
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

window.addEventListener('DOMContentLoaded', init);
