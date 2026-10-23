// Vanilla JS YouTube player with live‑typing transcript

document.addEventListener('DOMContentLoaded', function () {
  const loadBtn = document.getElementById('load-btn');
  const videoInput = document.getElementById('video-id');
  const container = document.getElementById('player-container');
  const transcriptEl = document.getElementById('transcript');
  const transcriptMsg = document.getElementById('transcript-message');
  const copyBtn = document.getElementById('copy-transcript');

  // ---------- Helper UI ----------
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
    clearTranscript();
  }

  function clearTranscript() {
    while (transcriptEl.firstChild) {
      transcriptEl.removeChild(transcriptEl.firstChild);
    }
    transcriptMsg.textContent = '';
  }

  // ---------- Video ID extraction ----------
  function extractVideoID(input) {
    const trimmed = input.trim();
    if (!trimmed) return '';
    const plainIdPattern = /^[a-zA-Z0-9_-]{11}$/;
    if (plainIdPattern.test(trimmed)) return trimmed;
    const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/|user\/.*\/|.*[?&]v=))([^?&\s]{11})/i;
    const match = trimmed.match(regex);
    if (match && match[1]) return match[1];
    try {
      const url = new URL(trimmed);
      if (url.searchParams.has('v')) {
        const v = url.searchParams.get('v');
        if (plainIdPattern.test(v)) return v;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // ---------- Video loading ----------
  function loadVideo(id) {
    if (!id) return;
    clearContainer();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', `https://www.youtube.com/embed/${id}?rel=0&enablejsapi=1`);
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'YouTube video player');
    container.appendChild(iframe);
  }

  // ---------- Subtitle fetching ----------
  async function fetchSubtitles(videoId) {
    const url = `https://video.google.com/timedtext?lang=en&v=${videoId}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Network response was not ok');
      const text = await response.text();
      if (!text.includes('<text')) return [];
      return parseSubtitlesXML(text);
    } catch (e) {
      console.error('Subtitle fetch error:', e);
      return [];
    }
  }

  function parseSubtitlesXML(xmlString) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString, 'application/xml');
    const texts = xml.getElementsByTagName('text');
    const cues = [];
    for (let i = 0; i < texts.length; i++) {
      const el = texts[i];
      const start = parseFloat(el.getAttribute('start'));
      const dur = parseFloat(el.getAttribute('dur'));
      const txt = el.textContent.replace(/\s+/g, ' ').trim();
      cues.push({ start, dur, text: txt });
    }
    return cues;
  }

  // ---------- Typing effect ----------
  function typeText(element, fullText, callback) {
    let idx = 0;
    const speed = 30; // ms per character
    function step() {
      if (idx < fullText.length) {
        element.textContent += fullText.charAt(idx);
        idx++;
        setTimeout(step, speed);
      } else if (typeof callback === 'function') {
        callback();
      }
    }
    step();
  }

  // ---------- Transcript handling ----------
  async function displayTranscript(videoId) {
    clearTranscript();
    const cues = await fetchSubtitles(videoId);
    if (!cues.length) {
      transcriptMsg.textContent = 'No subtitles found for this video.';
      return;
    }
    transcriptMsg.textContent = '';
    cues.forEach((cue) => {
      const li = document.createElement('li');
      transcriptEl.appendChild(li);
      setTimeout(() => {
        typeText(li, cue.text);
      }, cue.start * 1000);
    });
  }

  // ---------- Copy transcript ----------
  copyBtn.addEventListener('click', function () {
    const items = Array.from(transcriptEl.querySelectorAll('li'))
      .map(li => li.textContent.trim())
      .filter(t => t);
    if (!items.length) {
      alert('Nothing to copy yet.');
      return;
    }
    const fullText = String(items.join('\n'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullText).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 1500);
      }).catch(err => {
        console.error('Copy failed', err);
        alert('Copy failed. Please copy manually.');
      });
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = fullText;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 1500);
      } catch (err) {
        console.error('Fallback copy failed', err);
        alert('Copy failed.');
      }
      document.body.removeChild(textarea);
    }
  });

  // ---------- Load button ----------
  loadBtn.addEventListener('click', async function () {
    const rawInput = videoInput.value;
    const videoId = extractVideoID(rawInput);
    if (videoId) {
      loadVideo(videoId);
      await displayTranscript(videoId);
    } else {
      clearContainer();
      showEmptyState();
    }
  });

  // Initialize UI
  showEmptyState();
});