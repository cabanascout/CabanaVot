/* CabanaVot — service worker pentru notificări push.
   Rulează pe același domeniu ca site-ul (Netlify sau Cloudflare Workers). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function payloadFrom(event) {
  if (!event.data) return {};
  try { return event.data.json(); } catch { return { body: event.data.text() }; }
}

self.addEventListener('push', (event) => {
  const data = payloadFrom(event);
  const kind = data.type === 'manual' ? 'manual' : 'question';
  const title = data.title || (kind === 'manual' ? 'Memento — CabanaVot' : 'CabanaVot');
  const body = data.body || 'Ai o notificare nouă.';
  const url = data.url || '/';
  const sessionCode = String(data.sessionCode || '').toUpperCase();
  const options = {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.tag || (kind === 'manual' ? 'cabanavot-manual-' + Date.now() : 'cabanavot-question'),
    renotify: true,
    requireInteraction: kind === 'manual',
    vibrate: kind === 'question' ? [500, 150, 500, 150, 900] : [300, 120, 300, 120, 700],
    data: { url, kind, sessionCode },
  };

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try {
        client.postMessage({ type: 'cabanavot-push', kind, title, body, url, sessionCode });
      } catch {}
    }

    // Dacă votantul are chiar pagina votului deschisă și vizibilă, nu mai
    // acoperim ecranul cu o notificare de sistem: pagina vibrează și se actualizează.
    const voterPageVisible = clients.some((client) => {
      if (client.visibilityState !== 'visible') return false;
      if (!client.url.includes('#/voteaza')) return false;
      if (!sessionCode) return true;
      return client.url.toUpperCase().includes('COD=' + sessionCode);
    });
    if (kind === 'question' && voterPageVisible) return;

    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = clients.filter((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    });
    const existing = sameOrigin.find((client) => client.url === targetUrl) || sameOrigin[0];
    if (existing) {
      await existing.focus();
      if (existing.url !== targetUrl) {
        try { await existing.navigate(targetUrl); } catch {
          existing.postMessage({ type: 'cabanavot-open', url: targetUrl });
        }
      }
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});
