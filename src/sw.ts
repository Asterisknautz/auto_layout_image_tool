/// <reference lib="webworker" />

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string }>;
};

const PRECACHE_NAME = 'imagetool-precache-v1';
const manifestEntries = (self.__WB_MANIFEST || []).map((entry) =>
  typeof entry === 'string' ? entry : entry.url
);

const manifestSet = new Set(manifestEntries);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE_NAME).then((cache) => cache.addAll(Array.from(manifestSet)))
  );
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== PRECACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  void self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const offlineFallback = manifestEntries.find((entry) => entry.endsWith('index.html'));
        if (!offlineFallback) {
          return Response.error();
        }
        const cached = await caches.match(offlineFallback);
        return cached ?? Response.error();
      })
    );
    return;
  }

  if (manifestSet.has(requestUrl.pathname) || manifestSet.has(requestUrl.pathname + requestUrl.search)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached ?? fetch(event.request))
    );
    return;
  }

  // Default: try cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request))
  );
});
