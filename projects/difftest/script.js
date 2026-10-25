(function() {
  const STORAGE_KEY = 'counter_app_count'; // namespaced with app name
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

  // Increment handler
  incrementBtn.addEventListener('click', function() {
    count++;
    localStorage.setItem(STORAGE_KEY, count);
    updateUI();
  });

  // Reset handler – fixed to ensure button type="button" prevents default submit behavior
  resetBtn.addEventListener('click', function(event) {
    event.preventDefault(); // safeguard against accidental form submission
    count = 0;
    localStorage.setItem(STORAGE_KEY, count);
    updateUI();
  });

  // Initialise UI on load
  updateUI();
})();