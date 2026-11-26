/* R. K. DALVI service worker: offline support, fast repeat visits, admin push notifications */
const VERSION = 'rkd-v1';
const STATIC = `${VERSION}-static`;
const IMAGES = `${VERSION}-images`;
const PAGES = `${VERSION}-pages`;
const PRECACHE = ['/offline', '/assets/css/site.css', '/assets/js/site.js', '/assets/img/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/admin')) return; // never cache admin

  // Photos: cache-first (file names are unique & immutable)
  if (url.pathname.startsWith('/media/') && /\.(webp|jpg|jpeg|png)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(IMAGES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); trim(IMAGES, 300); }
        return res;
      })
    );
    return;
  }
  // Static assets: stale-while-revalidate
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/vendor/')) {
    e.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }
  // Pages: network-first, fall back to cache, then offline page
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(PAGES).then((c) => { c.put(req, copy); trim(PAGES, 40); }); }
          return res;
        })
        .catch(async () => (await caches.match(req)) || caches.match('/offline'))
    );
  }
});

// ---- push notifications for admins (new enquiries) ----
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'New notification', body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'R. K. DALVI', {
      body: data.body || '',
      icon: '/assets/img/icon-192.png',
      badge: '/assets/img/badge-96.png',
      tag: data.tag,
      data: { url: data.url || '/admin/enquiries' },
      vibrate: [120, 60, 120],
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/admin';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
