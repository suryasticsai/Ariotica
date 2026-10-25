(function() {
  const STORAGE_KEY = 'counter_app_count';
  const countEl = document.querySelector('.counter-display');
  const messageEl = document.getElementById('message');
  const incrementBtn = document.getElementById('incrementBtn');
  const resetBtn = document.getElementById('resetBtn');

  const loadCount = function() {
    const stored = localStorage.getItem(STORAGE_KEY);
    const num = parseInt(stored, 10);
    return isNaN(num) ? 0 : num;
  };

  let count = loadCount();

  const updateUI = function() {
    countEl.textContent = count;
    if (count === 0) {
      messageEl.textContent = 'No clicks yet, start counting!';
    } else {
      messageEl.textContent = '';
    }
  };

  incrementBtn.addEventListener('click', function() {
    count++;
    localStorage.setItem(STORAGE_KEY, count);
    updateUI();
  });

  resetBtn.addEventListener('click', function() {
    count = 0;
    localStorage.setItem(STORAGE_KEY, count);
    updateUI();
  });

  updateUI();
})();