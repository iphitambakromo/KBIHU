/* IPHI service worker — kerangka aplikasi offline (aset statis), API selalu jaringan */
const VERSI = 'iphi-BWHgJ8WQ';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => c.addAll([
    '/',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/kabah-ikon.png'
  ])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then(h => h || fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSI).then(c => c.put(e.request, cp)); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match('/')));
});
