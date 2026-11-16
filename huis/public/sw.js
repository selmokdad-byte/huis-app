// Service worker: app-schil offline beschikbaar, data altijd vers van de server.
const CACHE = 'huis-v4';
// Relatief aan de plek van deze service worker
const SHELL = ['./', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/feed/')) return;
  // Netwerk eerst, cache als terugval (zo krijg je updates meteen).
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});

// ---------- Pushmeldingen ----------
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data?.text() };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Huis', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      // Android toont het badge-icoon in de statusbalk: wit op transparant.
      badge: 'icons/badge-96.png',
      vibrate: [80, 40, 80],
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Server stuurt bijv. '/#/taken'; maak dat relatief aan de app.
  const url = new URL(String(e.notification.data?.url || '/').replace(/^\//, ''), self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope)) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
