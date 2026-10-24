document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'miniJira_tasks';
  const taskInput = document.getElementById('taskInput');
  const statusSelect = document.getElementById('statusSelect');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const board = document.getElementById('board');
  const emptyState = document.getElementById('emptyState');

  let tasks = [];

  const loadTasks = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    tasks = stored ? JSON.parse(stored) : [];
    render();
  };

  const saveTasks = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  };

  const generateId = () => {
    return 't_' + Date.now() + '_' + Math.random().toString(16).slice(2);
  };

  const createCardElement = (task) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.id = task.id;
    card.setAttribute('aria-label', `Task: ${task.title}`);

    const titleSpan = document.createElement('span');
    titleSpan.textContent = task.title;
    card.appendChild(titleSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.setAttribute('aria-label', 'Delete task');
    deleteBtn.innerHTML = '&#x2716;'; // heavy multiplication X
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });
    card.appendChild(deleteBtn);

    // Drag events
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    // Double click to edit title
    titleSpan.addEventListener('dblclick', () => {
      const newTitle = prompt('Edit task title', task.title);
      if (newTitle !== null && newTitle.trim() !== '') {
        updateTaskTitle(task.id, newTitle.trim());
      }
    });

    return card;
  };

  const render = () => {
    const containers = board.querySelectorAll('.card-container');
    containers.forEach(c => c.innerHTML = '');
    if (tasks.length === 0) {
      emptyState.hidden = false;
    } else {
      emptyState.hidden = true;
    }
    tasks.forEach(task => {
      const card = createCardElement(task);
      const container = board.querySelector(`.card-container[data-status="${task.status}"]`);
      if (container) container.appendChild(card);
    });
  };

  const addTask = () => {
    const title = taskInput.value.trim();
    const status = statusSelect.value;
    if (title === '') {
      alert('Task title cannot be empty');
      return;
    }
    const newTask = { id: generateId(), title, status };
    tasks.push(newTask);
    saveTasks();
    render();
    taskInput.value = '';
    statusSelect.value = 'todo';
  };

  const deleteTask = (id) => {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    render();
  };

  const updateTaskStatus = (id, newStatus) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.status = newStatus;
      saveTasks();
      render();
    }
  };

  const updateTaskTitle = (id, newTitle) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.title = newTitle;
      saveTasks();
      render();
    }
  };

  // Drag handlers
  let draggedId = null;

  const handleDragStart = (e) => {
    draggedId = e.currentTarget.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '';
    draggedId = null;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const newStatus = e.currentTarget.dataset.status;
    if (draggedId && newStatus) {
      updateTaskStatus(draggedId, newStatus);
    }
  };

  // Attach dragover/drop to containers
  const containers = board.querySelectorAll('.card-container');
  containers.forEach(container => {
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
  });

  // Button listeners
  addTaskBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
  });

  loadTasks();
});