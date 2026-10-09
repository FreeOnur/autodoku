/* AutoDoku – Offline-Cache für die App-Hülle (API-Aufrufe gehen immer ins Netz) */
const CACHE = 'autodoku-v2';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/latex2omml.js', 'js/markdown.js', 'js/docx.js', 'js/store.js', 'js/claude.js', 'js/prompts.js', 'js/speech.js', 'js/images.js', 'js/app.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css', 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('anthropic.com') || url.hostname.endsWith('wikimedia.org')) return;
  // Netz zuerst (immer aktuelle Version), bei Offline aus dem Cache
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes('jsdelivr') || url.hostname.includes('gstatic') || url.hostname.includes('googleapis'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
