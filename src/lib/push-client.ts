import { savePushSubscription, sendTestPush } from "./notifications.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export type PushResult = "enabled" | "denied" | "unsupported" | "not-configured";

// Register the service worker, ask permission, subscribe, and store it.
export async function enablePush(): Promise<PushResult> {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapid) return "not-configured";

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
    }));

  const json: any = sub.toJSON();
  await savePushSubscription({
    data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  // Confirmation that lands on the device. Only on this explicit path — the
  // silent auto-subscribe below runs on every page load.
  sendTestPush().catch(() => {});
  return "enabled";
}

export type PushStatus = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  serviceWorker: boolean;
  subscribed: boolean;
  /** Tail of this device's subscription endpoint, to match against the account. */
  endpointTail: string | null;
};

// Where this device stands, for the diagnostics card. Read-only: it registers
// nothing and asks for nothing.
export async function pushStatus(): Promise<PushStatus> {
  const none: PushStatus = {
    supported: false,
    permission: "unsupported",
    serviceWorker: false,
    subscribed: false,
    endpointTail: null,
  };
  if (typeof window === "undefined") return none;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return none;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return {
      supported: true,
      permission: Notification.permission,
      serviceWorker: Boolean(reg),
      subscribed: Boolean(sub),
      endpointTail: sub ? sub.endpoint.slice(-24) : null,
    };
  } catch {
    return { ...none, supported: true, permission: Notification.permission };
  }
}

// Put this device's subscription on the account, whether or not one is there.
//
// The card's "This device is subscribed" only ever meant the browser holds a
// subscription. If the row for it was saved under another account, pruned, or
// never written, the server sends to nothing on this device while every check
// still shows green. This resubscribes if needed and saves what it finds.
export async function reRegisterPush(): Promise<PushResult> {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  if (Notification.permission !== "granted") return enablePush();
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapid) return "not-configured";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
    }));
  const json: any = sub.toJSON();
  await savePushSubscription({
    data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return "enabled";
}

export type LocalTestResult = "shown" | "dropped" | "blocked";

// A notification shown by this device's own worker, with no server involved.
//
// "shown" means the browser lists it as displayed — so if nothing appeared,
// the operating system is hiding this browser's notifications, and nothing on
// the server can change that. "dropped" means the browser itself refused to
// display it, which is a site or browser notification setting.
export async function showLocalTestNotification(): Promise<LocalTestResult> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "blocked";
  if (Notification.permission !== "granted") return "blocked";
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    await reg.showNotification("Notifications work on this device 💌", {
      body: 'This one came from this device. Now try "Send me a real push".',
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: "local-test",
      data: { url: "/me" },
    });
    // What the browser thinks it is showing right now.
    const shown = await reg.getNotifications({ tag: "local-test" });
    return shown.length ? "shown" : "dropped";
  } catch {
    return "dropped";
  }
}

// Background auto-subscribe if permission is already granted.
export async function autoSubscribePushIfGranted(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return;
  if (Notification.permission !== "granted") return;
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapid) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      }));
    const json: any = sub.toJSON();
    if (json?.endpoint && json?.keys?.p256dh && json?.keys?.auth) {
      await savePushSubscription({
        data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
    }
  } catch (e) {
    console.debug("Background push auto-subscribe skipped:", e);
  }
}
