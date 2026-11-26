// GIGI Picks service worker: shows phone alerts and opens the right page when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'GIGI Picks', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'GIGI Picks', {
    body: d.body || '',
    icon: '/icon-512.png',
    badge: '/apple-touch-icon.png',
    data: { url: d.url || '/' },
    tag: d.tag || undefined,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return; } }
    await self.clients.openWindow(url);
  })());
});
