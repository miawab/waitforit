// Shows Wait For It's notifications, even when no tab is open, and opens the right watch when tapped.
// One notification per watch (same tag), but each new one still pops up and makes a sound (renotify).
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { title: 'Wait For It', body: 'Something changed.' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: 'sloth.svg', badge: 'sloth.svg', tag: d.tag, renotify: true, data: { url: d.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
