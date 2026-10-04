/* Trilha Â· service worker
 * - Cacheia o "app shell": assets estÃ¡ticos do Next (imutÃ¡veis), pÃ¡ginas visitadas e fontes.
 * - NÃƒO cacheia dados nem arquivos de usuÃ¡rio (Supabase/API): esses ficam no IndexedDB por conta.
 * - Ao sair da conta, apaga as pÃ¡ginas cacheadas.
 */
const VERSION = 'v1';
const STATIC = `trilha-static-${VERSION}`;
const PAGES = `trilha-pages-${VERSION}`;
const FONTS = `trilha-fonts-${VERSION}`;
const TILES = `trilha-tiles-${VERSION}`;
const KEEP = [STATIC, PAGES, FONTS, TILES];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES).then((c) => c.addAll(['/', '/entrar', '/offline', '/grain.png']).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('trilha-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    throw e;
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') {
    cache.put(request, res.clone());
    if (max) trimCache(cacheName, max);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return; // nunca cacheia API
    if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
      event.respondWith(cacheFirst(req, STATIC));
      return;
    }
    const isRsc = req.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
    if (req.mode === 'navigate' || isRsc) {
      event.respondWith(networkFirst(req, PAGES, req.mode === 'navigate' ? '/offline' : null));
    }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS, 60));
    return;
  }
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(req, TILES, 400));
  }
  // Supabase e demais origens: rede direta (dados de usuÃ¡rio nÃ£o passam pelo cache do SW).
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'warm' && Array.isArray(msg.urls)) {
    // PrÃ©-carrega as telas da trilha para abrirem offline.
    event.waitUntil(
      caches.open(PAGES).then((c) =>
        Promise.all(
          msg.urls
            .filter((u) => typeof u === 'string' && u.startsWith('/'))
            .map((u) => fetch(u, { credentials: 'same-origin' }).then((r) => (r.ok ? c.put(u, r) : undefined)).catch(() => undefined)),
        ),
      ),
    );
  }
  if (msg.type === 'logout') {
    event.waitUntil(caches.delete(PAGES));
  }
  if (msg.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Trilha', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Trilha', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
