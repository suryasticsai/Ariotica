document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('task-form');
  const input = document.getElementById('task-input');
  const taskList = document.getElementById('task-list');
  const emptyState = document.getElementById('empty-state');
  const STORAGE_KEY = 'todoTasks';

  let tasks = [];

  const saveTasks = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  };

  const loadTasks = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      try { tasks = JSON.parse(data); } catch { tasks = []; }
    }
    render();
  };

  const render = () => {
    taskList.innerHTML = '';
    if (tasks.length === 0) {
      emptyState.hidden = false;
    } else {
      emptyState.hidden = true;
      tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item';
        li.dataset.id = task.id;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'task-content';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.setAttribute('aria-label', 'Mark task as completed');
        checkbox.addEventListener('change', toggleTask);

        const span = document.createElement('span');
        span.className = 'task-text';
        if (task.completed) span.classList.add('completed');
        span.textContent = task.text;

        contentDiv.appendChild(checkbox);
        contentDiv.appendChild(span);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-btn';
        deleteBtn.setAttribute('aria-label', 'Delete task');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.addEventListener('click', deleteTask);

        li.appendChild(contentDiv);
        li.appendChild(deleteBtn);
        taskList.appendChild(li);
      });
    }
  };

  const addTask = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text === '') return;
    const newTask = { id: Date.now().toString(), text, completed: false };
    tasks.push(newTask);
    input.value = '';
    saveTasks();
    render();
  };

  const toggleTask = (e) => {
    const li = e.target.closest('li');
    const id = li.dataset.id;
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.completed = e.target.checked;
      saveTasks();
      render();
    }
  };

  const deleteTask = (e) => {
    const li = e.target.closest('li');
    const id = li.dataset.id;
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    render();
  };

  form.addEventListener('submit', addTask);

  loadTasks();
});