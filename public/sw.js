/* CabanaVot — service worker pentru notificări push.
   Rulează pe același domeniu ca site-ul (Cloudflare Workers). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function payloadFrom(event) {
  if (!event.data) return {};
  try { return event.data.json(); } catch { return { body: event.data.text() }; }
}

// Pagina de vot scrie periodic un marcaj în Cache API cât timp e vizibilă.
// Îl citim ca plasă de siguranță pentru browser-ele unde `visibilityState`
// din `clients.matchAll` nu e de încredere.
async function voterVisibleRecently(sessionCode) {
  try {
    const cache = await caches.open('cabanavot-presence');
    const res = await cache.match('/__voter-visible');
    if (!res) return false;
    let info = {};
    try { info = JSON.parse(await res.text()) || {}; } catch {}
    const at = Number(info.at) || 0;
    if (Date.now() - at > 45000) return false;
    const code = String(info.code || '').toUpperCase();
    if (sessionCode && code && code !== sessionCode) return false;
    return true;
  } catch {
    return false;
  }
}

self.addEventListener('push', (event) => {
  const data = payloadFrom(event);
  const kind = data.type === 'manual' ? 'manual' : 'question';
  const title = data.title || (kind === 'manual' ? 'Memento — CabanaVot' : 'CabanaVot');
  const body = data.body || 'Ai o notificare nouă.';
  const url = data.url || '/';
  const sessionCode = String(data.sessionCode || '').toUpperCase();
  const questionId = String(data.questionId || '');
  const options = {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.tag || (kind === 'manual' ? 'cabanavot-manual-' + Date.now() : 'cabanavot-question'),
    renotify: true,
    // Notificarea rămâne vizibilă și trebuie să iasă ca pop-up, nu doar în bara de stare.
    requireInteraction: true,
    silent: false,
    timestamp: Date.now(),
    vibrate: kind === 'question' ? [550, 160, 550, 160, 1000] : [350, 120, 350, 120, 800],
    actions: [{ action: 'vote', title: 'Votează' }],
    data: { url, kind, sessionCode, questionId },
  };

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try {
        client.postMessage({
          type: 'cabanavot-push',
          kind,
          title,
          body,
          url,
          sessionCode,
          questionId,
          at: data.at || Date.now(),
        });
      } catch {}
    }

    // Notificarea de sistem nu mai apare dacă votantul vede chiar pagina de vot.
    // Pop-up-ul din site preia mesajul. Dacă pagina e deschisă în fundal / pe
    // altă aplicație, notificarea de sistem apare normal.
    const voterPageVisible = clients.some((client) => {
      if (client.visibilityState !== 'visible') return false;
      if (!client.url.includes('#/voteaza')) return false;
      // Tab de vot fără cod în adresă (ecranul de introducere): suprimăm mereu.
      if (!client.url.toUpperCase().includes('COD=')) return true;
      if (!sessionCode) return true;
      return client.url.toUpperCase().includes('COD=' + sessionCode);
    }) || await voterVisibleRecently(sessionCode);
    if (voterPageVisible) {
      await self.registration.getNotifications({ tag: options.tag }).then((existing) => {
        existing.forEach((n) => { try { n.close(); } catch {} });
      });
      return;
    }

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
