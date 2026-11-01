let currentHash = '';
const panes = {
  home: document.getElementById('home'),
  settings: document.getElementById('settings'),
  about: document.getElementById('about')
};
const navButtons = document.querySelectorAll('.nav-btn');
function showPane(hash) {
  const target = hash.replace('#/', '') || 'home';
  Object.values(panes).forEach(p => p.classList.add('hidden'));
  Object.values(panes).forEach(p => p.hidden = true);
  const pane = panes[target];
  if (pane) {
    pane.hidden = false;
    pane.classList.add('active');
    document.title = `Ariotica • ${target.charAt(0).toUpperCase()+target.slice(1)}`;
    navButtons.forEach(b => b.removeAttribute('aria-current'));
    const btn = Array.from(navButtons).find(b=>b.dataset.target===target);
    if (btn) btn.setAttribute('aria-current','page');
  }
}
window.addEventListener('hashchange',()=>{showPane(location.hash);});
// initial load
showPane(location.hash);
// Nav button click handling
navButtons.forEach(btn=>{
  btn.addEventListener('click',()=>{
    const target = btn.dataset.target;
    if (target) location.hash = `#/${target}`;
  });
});
// FAB placeholder action
const fab = document.querySelector('.fab');
fab.addEventListener('click',()=>{
  alert('FAB clicked – implement primary action');
});
// Simple glassmorphic chart placeholder using Canvas
const ctx = document.getElementById('chartCanvas').getContext('2d');
function drawPlaceholder(){
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = 'rgba(231,161,90,0.2)';
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = 'rgba(232,237,244,0.3)';
  ctx.beginPath();
  ctx.moveTo(0,h/2);
  for(let i=0;i<w;i+=20){
    const y = h/2 + Math.sin(i/30)*20;
    ctx.lineTo(i,y);
  }
  ctx.stroke();
}
if(ctx){drawPlaceholder();}
// GSAP subtle entrance
if (window.gsap) {
  gsap.from('.pane.active', {opacity:0, y:20, duration:0.6, ease:'power2.out'});
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
