function show(id){
  document.querySelectorAll('[data-view]').forEach(el=>{el.hidden=el.dataset.view!==id;});
  document.querySelectorAll('[data-goto]').forEach(el=>{
    const on=el.dataset.goto===id;
    el.classList.toggle('is-active',on);
    if(on)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
}

document.addEventListener('click',event=>{
  const go=event.target.closest('[data-goto]');
  if(go){show(go.dataset.goto);return;}
});

// Simple refresh simulation
document.getElementById('refresh')?.addEventListener('click',()=>{
  // In real app you'd fetch new data; here we just toggle a class for demo
  document.getElementById('balance').textContent='$12,340.00';
  document.getElementById('income').textContent='$4,200.00';
  document.getElementById('expenses').textContent='$1,850.00';
});
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
