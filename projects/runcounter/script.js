document.addEventListener('DOMContentLoaded', () => {
  const countEl = document.getElementById('count');
  const incBtn = document.getElementById('incBtn');
  const resetBtn = document.getElementById('resetBtn');
  let count = 0;

  const updateDisplay = () => {
    countEl.textContent = count;
  };

  incBtn.addEventListener('click', () => {
    count++;
    updateDisplay();
  });

  resetBtn.addEventListener('click', () => {
    count = 0;
    updateDisplay();
  });

  // Ensure initial state is rendered
  updateDisplay();
});