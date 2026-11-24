"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data; try { data = event.data?.json(); } catch { return; }
  if (!data || typeof data.eventId !== "string" || typeof data.date !== "string") return;
  const url = "/calendar?" + new URLSearchParams({ event: data.eventId, date: data.date });
  event.waitUntil(self.registration.showNotification(String(data.title || "Careplan").slice(0, 180), { body: String(data.body || "").slice(0, 300), tag: String(data.tag || data.eventId), renotify: false, data: { url } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/calendar", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(client.url).origin === url.origin) { await client.navigate(url.href); return client.focus(); }
    }
    return self.clients.openWindow(url.href);
  })());
});
