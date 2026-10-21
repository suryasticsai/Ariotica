(function() {
  const STORAGE_KEY = 'kanban_cards';
  const COL_KEY = 'kanban_columns';
  const THEME_KEY = 'kanban_theme';
  const form = document.getElementById('add-form');
  const titleInput = document.getElementById('title-input');
  const descInput = document.getElementById('desc-input');
  const statusSelect = document.getElementById('status-select');
  const columns = document.querySelectorAll('.column');
  const themeToggle = document.getElementById('theme-toggle');
  let cards = [];// [{id, title, desc, status}]
  let columnNames = {
    todo: '🗒 To Do',
    inprogress: '🚧 In Progress',
    done: '✅ Done'
  };
  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') {
      document.body.classList.add('dark');
      themeToggle.textContent = '☀️';
    } else {
      document.body.classList.remove('dark');
      themeToggle.textContent = '🌙';
    }
  }
  function toggleTheme() {
    if (document.body.classList.toggle('dark')) {
      localStorage.setItem(THEME_KEY, 'dark');
      themeToggle.textContent = '☀️';
    } else {
      localStorage.setItem(THEME_KEY, 'light');
      themeToggle.textContent = '🌙';
    }
  }
  function loadColumns() {
    const data = localStorage.getItem(COL_KEY);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        columnNames = {...columnNames, ...parsed};
      } catch (e) {}
    }
    // apply names
    document.querySelectorAll('.column h2').forEach(h2 => {
      const status = h2.parentElement.dataset.status;
      const name = columnNames[status] || h2.textContent;
      const btn = h2.querySelector('.rename-col');
      h2.textContent = name + ' ';
      if (btn) h2.appendChild(btn);
    });
  }
  function saveColumns() {
    localStorage.setItem(COL_KEY, JSON.stringify(columnNames));
  }
  function load() {
    const data = localStorage.getItem(STORAGE_KEY);
    cards = data ? JSON.parse(data) : [];}
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));}
  function render() {
    document.querySelectorAll('.card-list').forEach(ul => ul.innerHTML = '');
    cards.forEach(card => {
      const li = document.createElement('li');
      li.className = 'card';
      li.draggable = true;
      li.dataset.id = card.id;
      const titleDiv = document.createElement('div');
      titleDiv.className = 'card-title';
      titleDiv.textContent = card.title;
      const descDiv = document.createElement('div');
      descDiv.className = 'card-desc';
      descDiv.textContent = card.desc;
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit';
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '🗑';
      delBtn.title = 'Delete';
      li.appendChild(titleDiv);
      li.appendChild(descDiv);
      li.appendChild(editBtn);
      li.appendChild(delBtn);
      addDragHandlers(li);
      addCardBtnHandlers(li, editBtn, delBtn);
      const list = document.querySelector(`.card-list[data-status="${card.status}"]`);
      if (list) list.appendChild(li);
    });
    loadColumns();
    initColumnRename();
  }
  function addCard(e) {
    e.preventDefault();
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    const status = statusSelect.value;
    if (!title || !desc) return;
    const card = {id: Date.now().toString(), title, desc, status};
    cards.push(card);
    save();
    render();
    form.reset();
  }
  function addDragHandlers(el) {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });
  }
  function addCardBtnHandlers(cardEl, editBtn, delBtn) {
    editBtn.addEventListener('click', () => {
      const id = cardEl.dataset.id;
      const card = cards.find(c => c.id === id);
      if (!card) return;
      const newTitle = prompt('Edit title', card.title);
      if (newTitle === null) return;
      const newDesc = prompt('Edit description', card.desc);
      if (newDesc === null) return;
      card.title = newTitle.trim();
      card.desc = newDesc.trim();
      save();
      render();
    });
    delBtn.addEventListener('click', () => {
      const id = cardEl.dataset.id;
      cards = cards.filter(c => c.id !== id);
      save();
      render();
    });
  }
  function initColumnRename() {
    document.querySelectorAll('.rename-col').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        const current = columnNames[status] || '';
        const newName = prompt('Rename column', current.replace(/^\S+\s/, ''));
        if (newName === null) return;
        const emoji = columnNames[status] ? columnNames[status].match(/^\S+/)[0] : '' ;
        columnNames[status] = `${emoji} ${newName.trim()}`;
        saveColumns();
        render();
      });
    });
  }
  columns.forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });
    col.addEventListener('drop', e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const card = cards.find(c => c.id === id);
      if (card) {
        card.status = col.dataset.status;
        save();
        render();
      }
      col.classList.remove('drag-over');
    });
  });
  themeToggle.addEventListener('click', toggleTheme);
  form.addEventListener('submit', addCard);
  load();
  loadTheme();
  render();
})();