// Minimal service worker used only to display notifications via
// ServiceWorkerRegistration.showNotification, which reliably triggers the
// Windows taskbar attention flash (orange/red) in Chrome.
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      try { await c.focus(); return; } catch (_) {}
    }
  })());
});