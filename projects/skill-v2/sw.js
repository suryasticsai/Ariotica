/* Ariotica SW · app-skill-v2-fc58a1b1 */
const CACHE = "app-skill-v2-fc58a1b1";
const PRECACHE = ["./","./index.html","./style.css","./script.js","./manifest.json","./icon-192.png","./icon-512.png"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))); return;
  }
  e.respondWith(caches.match(req).then((cached) => { const network = fetch(req).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {}); return res; }).catch(() => cached); return cached || network; }));
});
