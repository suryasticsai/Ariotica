document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'kanbanData';
  const THEME_KEY = 'kanbanTheme';
  const COLUMNS = ['todo', 'inprogress', 'done'];

  const data = loadData();
  applySavedTheme();
  renderAll();
  initAddButtons();
  initThemeToggle();

  function loadData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { columns: { todo: [], inprogress: [], done: [] } };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.columns) return parsed;
    } catch { }
    return { columns: { todo: [], inprogress: [], done: [] } };
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function renderAll() {
    COLUMNS.forEach(id => {
      const list = document.querySelector(`.card-list[data-id="${id}"]`);
      list.innerHTML = '';
      data.columns[id].forEach(card => list.appendChild(createCard(card, id)));
    });
    initDragAndDrop();
  }

  function createCard(card, colId) {
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    el.dataset.id = card.id;

    const txt = document.createElement('span');
    txt.textContent = card.text;
    txt.title = 'Double‑click to edit';
    txt.addEventListener('dblclick', () => {
      const newText = prompt('Edit card title:', card.text);
      if (newText !== null && newText !== '') {
        card.text = newText;
        txt.textContent = newText;
        saveData();
      }
    });

    const del = document.createElement('button');
    del.className = 'deleteBtn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const idx = data.columns[colId].findIndex(c => c.id === card.id);
      if (idx > -1) data.columns[colId].splice(idx, 1);
      saveData();
      el.remove();
    });

    el.appendChild(txt);
    el.appendChild(del);
    return el;
  }

  function initAddButtons() {
    document.querySelectorAll('.addBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const colId = btn.parentElement.dataset.id;
        const title = prompt('Enter card title:');
        if (!title) return;
        const card = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          text: title
        };
        data.columns[colId].push(card);
        saveData();
        const list = document.querySelector(`.card-list[data-id="${colId}"]`);
        list.appendChild(createCard(card, colId));
      });
    });
  }

  function initDragAndDrop() {
    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('text/plain', card.dataset.id);
        ev.dataTransfer.effectAllowed = 'move';
      });
    });

    document.querySelectorAll('.card-list').forEach(list => {
      list.addEventListener('dragover', ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        list.parentElement.classList.add('drag-over');
      });
      list.addEventListener('dragleave', () => {
        list.parentElement.classList.remove('drag-over');
      });
      list.addEventListener('drop', ev => {
        ev.preventDefault();
        list.parentElement.classList.remove('drag-over');
        const cardId = ev.dataTransfer.getData('text/plain');
        const dragged = document.querySelector(`.card[data-id="${cardId}"]`);
        if (!dragged) return;
        const sourceCol = dragged.parentElement.parentElement.dataset.id;
        const targetCol = list.dataset.id;
        const beforeEl = ev.target.closest('.card');
        if (sourceCol === targetCol) {
          if (beforeEl && beforeEl !== dragged) list.insertBefore(dragged, beforeEl);
          else list.appendChild(dragged);
          reorderColumn(targetCol, list);
          return;
        }
        // move between columns
        const srcArr = data.columns[sourceCol];
        const idx = srcArr.findIndex(c => c.id === cardId);
        if (idx > -1) {
          const [moved] = srcArr.splice(idx, 1);
          data.columns[targetCol].push(moved);
          saveData();
        }
        if (beforeEl) list.insertBefore(dragged, beforeEl);
        else list.appendChild(dragged);
      });
    });
  }

  function reorderColumn(colId, listEl) {
    const newOrder = [];
    listEl.querySelectorAll('.card').forEach(cardEl => {
      const id = cardEl.dataset.id;
      const obj = data.columns[colId].find(c => c.id === id);
      if (obj) newOrder.push(obj);
    });
    data.columns[colId] = newOrder;
    saveData();
  }

  function initThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
      btn.textContent = isLight ? '☀️' : '🌙';
    });
  }

  function applySavedTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const isLight = saved === 'light';
    document.body.classList.toggle('light', isLight);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  }
});