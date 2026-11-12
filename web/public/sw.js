// Service worker of HEIG-Kit: it only shows the notifications the server sends (Web Push) and opens the application on
// the right page when one is tapped. It handles no request and caches nothing.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not ours: shown as a plain notice below.
  }
  // Every push must show something: iOS withdraws the permission of an application that receives silent ones.
  event.waitUntil(
    self.registration.showNotification(typeof data.title === "string" && data.title ? data.title : "HEIG-Kit", {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only pages of the application itself.
  let target = new URL("/", self.location.origin);
  try {
    const asked = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    if (asked.origin === self.location.origin) target = asked;
  } catch {
    // Keeps the home page.
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        try {
          await client.focus();
          client.postMessage({ type: "heig-open", url: target.pathname + target.search });
          return;
        } catch {
          // This window cannot be brought forward: the next one, or a new one.
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
