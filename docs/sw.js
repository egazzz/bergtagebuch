/* Bergtagebuch Web – Service Worker: App offline verfügbar, Kartenkacheln zwischenspeichern */
const VERSION = 'bt-1.8.0';
const APP_CACHE = 'app-' + VERSION;
const TILE_CACHE = 'tiles-v1';
const TILE_MAX = 3000;
const APP_FILES = ['./', 'index.html', 'manifest.webmanifest', 'js/core.js', 'js/ui.js', 'js/pages.js',
  'lib/leaflet.js', 'lib/leaflet.css', 'lib/markercluster.js', 'lib/markercluster.css',
  'lang/lang_de.txt', 'lang/lang_it.txt', 'lang/lang_en.txt', 'help_de.html', 'help_it.html', 'help_en.html',
  'fonts/atkinson-r.woff2', 'fonts/atkinson-b.woff2', 'fonts/nunito-r.woff2', 'fonts/nunito-b.woff2', 'fonts/lato-r.woff2', 'fonts/lato-b.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('app-') && k !== APP_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

const isTile = url => /tile|arcgisonline|basemaps\.cartocdn|geoservices\.buergernetz/.test(url.hostname + url.pathname);
async function trimTiles() {
  const c = await caches.open(TILE_CACHE), keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    /* App-Dateien: zuerst Cache, bei Seitenaufruf auch ohne Netz */
    e.respondWith(caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(r => r || fetch(req).catch(() => caches.match('index.html'))));
    return;
  }
  if (isTile(url)) {
    /* Kartenkacheln: aus dem Cache, wenn vorhanden (im Hintergrund aktualisieren), sonst übers Netz */
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) { fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r); }).catch(() => {}); return hit; }
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); if (Math.random() < 0.02) trimTiles(); }
        return r;
      } catch (err) { return Response.error(); }
    }));
  }
  /* alles andere (Overpass, Ko-fi) direkt übers Netz */
});
