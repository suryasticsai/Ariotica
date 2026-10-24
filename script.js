(function() {
  const STORAGE_PREFIX = 'pomodoro_';
  const SESSION_KEY = STORAGE_PREFIX + 'sessions';
  const STATE_KEY = STORAGE_PREFIX + 'state';

  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const sessionInfo = document.getElementById('sessionInfo');

  const WORK_DURATION = 25 * 60; // seconds
  let remaining = WORK_DURATION;
  let timerId = null;
  let sessions = 0;

  // Load persisted data
  function loadState() {
    const savedSessions = localStorage.getItem(SESSION_KEY);
    if (savedSessions !== null) {
      sessions = parseInt(savedSessions, 10) || 0;
    }
    const savedState = JSON.parse(localStorage.getItem(STATE_KEY));
    if (savedState) {
      remaining = savedState.remaining !== undefined ? savedState.remaining : WORK_DURATION;
      if (savedState.running) {
        startTimer();
      }
    }
    updateDisplay();
    updateSessionInfo();
    updateButtons();
  }

  function saveState() {
    localStorage.setItem(SESSION_KEY, sessions);
    localStorage.setItem(STATE_KEY, JSON.stringify({ remaining, running: !!timerId }));
  }

  function updateDisplay() {
    const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
    const secs = (remaining % 60).toString().padStart(2, '0');
    minutesEl.textContent = mins;
    secondsEl.textContent = secs;
  }

  function updateSessionInfo() {
    if (sessions === 0) {
      sessionInfo.textContent = 'No Pomodoro sessions yet. Start a session!';
    } else {
      sessionInfo.textContent = `Completed Sessions: ${sessions}`;
    }
  }

  function updateButtons() {
    const isRunning = !!timerId;
    startBtn.disabled = isRunning;
    pauseBtn.disabled = !isRunning;
    resetBtn.disabled = remaining === WORK_DURATION && !isRunning;
  }

  function tick() {
    if (remaining > 0) {
      remaining--;
      updateDisplay();
    } else {
      clearInterval(timerId);
      timerId = null;
      sessions++;
      remaining = WORK_DURATION;
      updateDisplay();
      updateSessionInfo();
      saveState();
      // Auto-reset UI after completion
      updateButtons();
      alert('Pomodoro completed!');
    }
  }

  function startTimer() {
    if (timerId) return;
    timerId = setInterval(tick, 1000);
    updateButtons();
    saveState();
  }

  function pauseTimer() {
    if (!timerId) return;
    clearInterval(timerId);
    timerId = null;
    updateButtons();
    saveState();
  }

  function resetTimer() {
    pauseTimer();
    remaining = WORK_DURATION;
    updateDisplay();
    updateButtons();
    saveState();
  }

  // Event listeners
  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);

  // Initialize
  loadState();
})();