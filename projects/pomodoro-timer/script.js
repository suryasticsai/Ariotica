(() => {
  const STORAGE_KEY = 'pomodoro_completed';
  const FOCUS_DURATION = 25 * 60; // seconds
  const BREAK_DURATION = 5 * 60; // seconds

  const timeDisplay = document.querySelector('.time-display');
  const modeLabel = document.getElementById('modeLabel');
  const sessionCountEl = document.getElementById('sessionCount');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const progressCircle = document.querySelector('.timer-progress');

  const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 54; // radius 54 as in SVG
  progressCircle.style.strokeDasharray = CIRCLE_CIRCUMFERENCE;

  let mode = 'focus'; // 'focus' or 'break'
  let remaining = FOCUS_DURATION;
  let timerId = null;
  let isRunning = false;
  let completedSessions = parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0;

  const updateSessionDisplay = () => {
    sessionCountEl.textContent = completedSessions;
  };

  const formatTime = secs => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const updateDisplay = () => {
    timeDisplay.textContent = formatTime(remaining);
    const offset = CIRCLE_CIRCUMFERENCE - (remaining / getCurrentDuration()) * CIRCLE_CIRCUMFERENCE;
    progressCircle.style.strokeDashoffset = offset;
    modeLabel.textContent = mode === 'focus' ? 'Focus' : 'Break';
  };

  const getCurrentDuration = () => (mode === 'focus' ? FOCUS_DURATION : BREAK_DURATION);

  const beep = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, ctx.currentTime); // A4
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  };

  const switchMode = () => {
    if (mode === 'focus') {
      completedSessions += 1;
      localStorage.setItem(STORAGE_KEY, completedSessions);
      updateSessionDisplay();
      mode = 'break';
      remaining = BREAK_DURATION;
    } else {
      mode = 'focus';
      remaining = FOCUS_DURATION;
    }
    updateDisplay();
  };

  const tick = () => {
    if (remaining > 0) {
      remaining -= 1;
      updateDisplay();
    } else {
      beep();
      clearInterval(timerId);
      isRunning = false;
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      resetBtn.disabled = false;
      switchMode();
    }
  };

  const startTimer = () => {
    if (isRunning) return;
    isRunning = true;
    timerId = setInterval(tick, 1000);
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;
  };

  const pauseTimer = () => {
    if (!isRunning) return;
    clearInterval(timerId);
    isRunning = false;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
  };

  const resetTimer = () => {
    clearInterval(timerId);
    isRunning = false;
    remaining = getCurrentDuration();
    updateDisplay();
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = true;
  };

  // Event listeners
  startBtn.addEventListener('click', startTimer);
  pauseBtn.addEventListener('click', pauseTimer);
  resetBtn.addEventListener('click', resetTimer);

  // Initial render
  updateDisplay();
  updateSessionDisplay();
})();