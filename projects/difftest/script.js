(function() {
  const STORAGE_KEY = 'counter_app_count';
  const countEl = document.querySelector('.counter-display');
  const messageEl = document.getElementById('message');
  const btn = document.getElementById('incrementBtn');

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

  btn.addEventListener('click', function() {
    count++;
    localStorage.setItem(STORAGE_KEY, count);
    updateUI();
  });

  updateUI();
})();