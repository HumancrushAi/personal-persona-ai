// HumanCrush.com push service worker.
//
// A push is shown unless the user is already looking at the very chat it is
// about — a reply they are watching arrive does not also need to buzz their
// phone. Chrome only allows skipping the notification while a page of ours is
// visible, which is exactly the case being skipped.
async function viewingUrl(url) {
  const target = new URL(url, self.location.origin);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return clients.some((c) => {
    if (c.visibilityState !== "visible") return false;
    const here = new URL(c.url);
    return here.origin === target.origin && here.pathname === target.pathname;
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "HumanCrush.com", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "HumanCrush.com";
  const url = data.url || "/";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.png",
    badge: "/favicon.png",
    tag: data.tag || url,
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url },
  };
  event.waitUntil(
    (async () => {
      if (url.startsWith("/chat/") && (await viewingUrl(url))) return;
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if (!("focus" in c)) continue;
        try {
          // navigate() only works on a page this worker controls; a tab opened
          // before the worker was installed rejects, so fall through to a new
          // window rather than leaving the tap doing nothing.
          const moved = "navigate" in c ? await c.navigate(url) : c;
          return (moved || c).focus();
        } catch {
          /* try the next tab, then a new window */
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// Take over straight away, so a fix to this file reaches phones on their next
// visit rather than after every old tab has been closed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
