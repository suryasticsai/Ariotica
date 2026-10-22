document.addEventListener('DOMContentLoaded', () => {
  const storageKey = 'kanbanData';
  const columnIds = ['todo', 'inprogress', 'done'];
  const columnNames = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' };

  const boardData = loadData();
  renderBoard();

  document.querySelectorAll('.addBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const colId = btn.parentElement.getAttribute('data-id');
      const title = prompt('Enter card title:');
      if (!title) return;
      const card = { id: Date.now().toString() + Math.random().toString(36).substr(2, 5), text: title };
      boardData.columns[colId].push(card);
      saveData();
      const list = document.querySelector(`.card-list[data-id="${colId}"]`);
      list.appendChild(createCardElement(card, colId));
    });
  });

  function loadData() {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.columns) return parsed;
      } catch { }
    }
    return { columns: { todo: [], inprogress: [], done: [] } };
  }

  function saveData() {
    localStorage.setItem(storageKey, JSON.stringify(boardData));
  }

  function renderBoard() {
    columnIds.forEach(id => {
      const list = document.querySelector(`.card-list[data-id="${id}"]`);
      list.innerHTML = '';
      boardData.columns[id].forEach(card => {
        list.appendChild(createCardElement(card, id));
      });
    });
    attachDragHandlers();
  }

  function createCardElement(card, colId) {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('draggable', 'true');
    el.dataset.id = card.id;
    const span = document.createElement('span');
    span.textContent = card.text;
    const del = document.createElement('button');
    del.className = 'deleteBtn';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const idx = boardData.columns[colId].findIndex(c => c.id === card.id);
      if (idx > -1) boardData.columns[colId].splice(idx, 1);
      saveData();
      el.remove();
    });
    el.appendChild(span);
    el.appendChild(del);
    return el;
  }

  function attachDragHandlers() {
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
        if (sourceCol === targetCol) {
          list.insertBefore(dragged, ev.target.closest('.card'));
          return;
        }
        // remove from source data
        const srcArr = boardData.columns[sourceCol];
        const idx = srcArr.findIndex(c => c.id === cardId);
        if (idx > -1) {
          const [cardObj] = srcArr.splice(idx, 1);
          boardData.columns[targetCol].push(cardObj);
          saveData();
        }
        list.appendChild(dragged);
      });
    });
  }
});