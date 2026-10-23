// Vanilla JS YouTube embed manager
document.addEventListener('DOMContentLoaded', function () {
  const loadBtn = document.getElementById('load-btn');
  const videoInput = document.getElementById('video-id');
  const container = document.getElementById('player-container');

  function clearContainer() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  function showEmptyState() {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No video loaded, add one!';
    container.appendChild(p);
  }

  function loadVideo(id) {
    if (!id) return;
    clearContainer();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', `https://www.youtube.com/embed/${id}?rel=0`);
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'YouTube video player');
    container.appendChild(iframe);
  }

  loadBtn.addEventListener('click', function () {
    const id = videoInput.value.trim();
    if (id) {
      loadVideo(id);
    } else {
      clearContainer();
      showEmptyState();
    }
  });

  // Initialize with empty state
  showEmptyState();
});