/* Service worker: deja la app disponible sin conexión.
   Subí el número de VERSION cada vez que cambies archivos para forzar la actualización. */
var VERSION = 'ged-fotos-1.2.0';
var FILES = [
  './', './index.html', './styles.css', './app.js', './exif.js', './config.js', './manifest.webmanifest',
  './fonts/roboto-latin-400-normal.woff2', './fonts/roboto-latin-700-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Solo archivos propios (GET). Las llamadas a Apps Script nunca pasan por la caché. */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;           // rápido: sirve la copia local y actualiza por detrás
      });
    })
  );
});
