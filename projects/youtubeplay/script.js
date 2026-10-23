// Vanilla JS YouTube embed manager with robust URL parsing

document.addEventListener('DOMContentLoaded', function () {
  const loadBtn = document.getElementById('load-btn');
  const videoInput = document.getElementById('video-id');
  const container = document.getElementById('player-container');

  // Helper: remove all children from the player container
  function clearContainer() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  // Show the empty‑state message
  function showEmptyState() {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No video loaded, add one!';
    container.appendChild(p);
  }

  // Extract a YouTube video ID from a variety of possible inputs.
  // Accepts full URLs, shortened URLs, embed URLs, or a plain ID.
  function extractVideoID(input) {
    const trimmed = input.trim();
    if (!trimmed) return '';

    // If the input looks like a plain video ID (11 chars, alphanum, -,_)
    const plainIdPattern = /^[a-zA-Z0-9_-]{11}$/;
    if (plainIdPattern.test(trimmed)) {
      return trimmed;
    }

    // Regular expression to capture the ID from common YouTube URL formats
    const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/|user\/.*\/|.*[?&]v=))([^?&\s]{11})/i;
    const match = trimmed.match(regex);
    if (match && match[1]) {
      return match[1];
    }

    // Fallback: try to locate the v= parameter manually (covers URLs with extra params)
    const urlObj = (() => {
      try { return new URL(trimmed); } catch (e) { return null; }
    })();
    if (urlObj && urlObj.searchParams.has('v')) {
      const v = urlObj.searchParams.get('v');
      if (plainIdPattern.test(v)) return v;
    }

    // If nothing matched, return empty string so the caller can handle it gracefully
    return '';
  }

  // Load the video into an iframe using the extracted ID
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
    const rawInput = videoInput.value;
    const videoId = extractVideoID(rawInput);
    if (videoId) {
      loadVideo(videoId);
    } else {
      clearContainer();
      showEmptyState();
    }
  });

  // Initialize with empty state
  showEmptyState();
});