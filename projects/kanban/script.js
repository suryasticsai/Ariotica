(() => {
  const STORAGE_KEY = 'kanban_cards';
  const form = document.getElementById('add-form');
  const titleInput = document.getElementById('title-input');
  const descInput = document.getElementById('desc-input');
  const statusSelect = document.getElementById('status-select');
  const columns = document.querySelectorAll('.column');
  let cards = [];

  function load() {
    const data = localStorage.getItem(STORAGE_KEY);
    cards = data ? JSON.parse(data) : [];
    render();
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }

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

      li.appendChild(titleDiv);
      li.appendChild(descDiv);
      addDragHandlers(li);

      const list = document.querySelector(`.card-list[data-status="${card.status}"]`);
      if (list) list.appendChild(li);
    });
  }

  function addCard(e) {
    e.preventDefault();
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    const status = statusSelect.value;
    if (!title || !desc) return;
    const card = { id: Date.now().toString(), title, desc, status };
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

  form.addEventListener('submit', addCard);
  load();
})();