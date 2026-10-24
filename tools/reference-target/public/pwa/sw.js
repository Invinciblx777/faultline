const CACHE = "northwind-pwa-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/pwa/", "/styles.css"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true })));
});
