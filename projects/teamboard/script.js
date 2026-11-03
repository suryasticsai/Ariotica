// Minimal view router
function show(id) {
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.hidden = el.dataset.view !== id;
  });
  document.querySelectorAll("[data-goto]").forEach((el) => {
    const on = el.dataset.goto === id;
    el.classList.toggle("is-active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
}
// Habit data in localStorage
const STORAGE_KEY = 'habitTracker';
let habits = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
const habitList = document.getElementById('habit-list');
const progressList = document.getElementById('progress-list');
function renderHabits() {
  habitList.innerHTML = '';
  habits.forEach((h,i)=>{
    const li=document.createElement('li');li.className='list__item';
    const span=document.createElement('span');span.innerHTML='<span class="list__title">'+h.name+'</span>';
    const btn=document.createElement('button');btn.type='button';btn.className='btn btn--ghost';btn.textContent='Check';btn.dataset.idx=i;
    btn.addEventListener('click',()=>{h.done=!h.done;save();renderHabits();renderProgress();});
    li.append(span,btn);
    habitList.append(li);
  });
}
function renderProgress(){
  progressList.innerHTML='';
  const total=habits.length;const done=habits.filter(h=>h.done).length;
  const li=document.createElement('li');li.className='list__item';li.innerHTML=`<span class="list__title">Completed</span><span class="list__value">${done}/${total}</span>`;
  progressList.append(li);
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(habits));}
// Form handling
const habitForm=document.getElementById('habit-form');habitForm.addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('habit-input');const name=input.value.trim();if(name){habits.push({name,done:false});save();renderHabits();renderProgress();input.value='';}});
// Initial render
renderHabits();renderProgress();
// Router event
document.addEventListener('click',event=>{const go=event.target.closest('[data-goto]');if(go)return show(go.dataset.goto);});

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
