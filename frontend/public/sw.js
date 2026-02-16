self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const title = data?.title || 'Familia – Update';
  const options = {
    body: data?.body || '',
    icon: data?.icon || '/uploads/Familia.png',
    badge: data?.badge || '/uploads/Familia.png',
    data: {
      url: data?.url || '/Admin?tab=updates'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification?.data?.url || '/Admin?tab=updates';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        if (client.url.includes('/Admin')) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(urlToOpen);
          }
          return;
        }
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(urlToOpen);
    }
  })());
});
