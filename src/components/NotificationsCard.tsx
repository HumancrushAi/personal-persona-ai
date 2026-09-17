import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  BellRing,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  Smartphone,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushDiagnostics, sendTestPush } from "@/lib/notifications.functions";
import {
  enablePush,
  pushStatus,
  reRegisterPush,
  showLocalTestNotification,
  type LocalTestResult,
  type PushStatus,
} from "@/lib/push-client";
import { toast } from "sonner";

type Diagnostics = {
  configured: boolean;
  keysMatch: boolean;
  devices: { tail: string; host: string; createdAt: string }[];
};

// Notifications, with the diagnostics that make "it says enabled but nothing
// arrives" answerable.
//
// A push has to survive five hand-offs: the browser granting permission, this
// device's subscription being on THIS account, the server holding the key that
// subscription was made with, the push service accepting the message, and the
// device choosing to show it. "Enabled" only ever proved the first, and
// "accepted for 1 of 1 device" only the fourth. Each row below is one of them,
// and the two test buttons split the last: a local notification never touches
// the server, so if it does not appear the device is hiding notifications and
// no server change will help.
export function NotificationsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState<"enable" | "register" | "local" | "push" | null>(null);
  const [localResult, setLocalResult] = useState<LocalTestResult | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const testPush = useServerFn(sendTestPush);
  const getDiag = useServerFn(pushDiagnostics);

  async function refresh() {
    const [s, d] = await Promise.all([
      pushStatus(),
      (getDiag() as Promise<Diagnostics>).catch(() => null),
    ]);
    setStatus(s);
    setDiag(d);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    setBusy("enable");
    try {
      const r = await enablePush();
      if (r === "enabled") toast.success("Notifications on — a test is on its way");
      else if (r === "denied")
        toast.error("Blocked in the browser — allow notifications for this site");
      else if (r === "not-configured") toast.error("Push isn't set up on the server yet");
      else toast.error("This browser can't receive push notifications");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't turn notifications on");
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function register() {
    setBusy("register");
    try {
      const r = await reRegisterPush();
      if (r === "enabled") toast.success("This device is now on your account");
      else toast.error("Couldn't register this device");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't register this device");
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function local() {
    setBusy("local");
    setLocalResult(null);
    try {
      setLocalResult(await showLocalTestNotification());
    } finally {
      setBusy(null);
    }
  }

  async function push() {
    setBusy("push");
    setPushResult(null);
    try {
      const r: any = await testPush();
      setPushResult(
        r.total === 0
          ? "No device is on this account — tap Register this device."
          : `The push service accepted it for ${r.sent} of ${r.total} device${
              r.total === 1 ? "" : "s"
            }. That is the last thing the server can see; whether the device shows it is the device's decision.${
              r.errors?.length ? ` Errors: ${r.errors.join("; ")}` : ""
            }`,
      );
    } catch (e: any) {
      setPushResult(e?.message ?? "Sending failed");
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const granted = status?.permission === "granted";
  const registered = Boolean(
    status?.endpointTail && diag?.devices.some((d) => d.tail === status.endpointTail),
  );
  const on = granted && status?.subscribed;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = /Android/i.test(ua)
    ? "android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "ios"
      : /Windows/i.test(ua)
        ? "windows"
        : /Mac OS X/i.test(ua)
          ? "mac"
          : "other";

  return (
    <div className="glass mt-10 rounded-3xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
          {on ? (
            <BellRing className="h-5 w-5 text-primary" />
          ) : (
            <Bell className="h-5 w-5 text-muted-foreground" />
          )}
          Notifications
        </h2>
        {!on && (
          <Button
            onClick={enable}
            disabled={busy !== null}
            className="rounded-full bg-grad-primary text-primary-foreground"
          >
            {busy === "enable" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Turn on
          </Button>
        )}
      </div>

      {status && (
        <ul className="mt-4 space-y-1.5 text-sm">
          <Row ok={status.supported} label="This browser supports push" />
          <Row
            ok={granted}
            label={
              status.permission === "denied"
                ? "Permission blocked — allow notifications for this site in the browser"
                : "Permission granted"
            }
          />
          <Row ok={status.serviceWorker} label="Background worker installed" />
          <Row ok={status.subscribed} label="This browser holds a subscription" />
          {diag && (
            <Row
              ok={registered}
              label={
                registered
                  ? `This device is on your account (${diag.devices.length} device${
                      diag.devices.length === 1 ? "" : "s"
                    } total)`
                  : status.subscribed
                    ? "This device's subscription is NOT on your account — pushes are going elsewhere"
                    : "This device is not on your account"
              }
            />
          )}
          {diag && !diag.configured && (
            <Row
              ok={false}
              label="The server has no push keys (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)"
            />
          )}
          {diag && diag.configured && !diag.keysMatch && (
            <Row
              ok={false}
              label="The site's public key and the server's public key differ — every subscription is for a key the server doesn't hold. Fix VITE_VAPID_PUBLIC_KEY / VAPID_PUBLIC_KEY in Vercel, then register again."
            />
          )}
        </ul>
      )}

      {diag && diag.devices.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          On this account:{" "}
          {diag.devices
            .map((d) => `${vendor(d.host)}${d.tail === status?.endpointTail ? " (this one)" : ""}`)
            .join(", ")}
        </p>
      )}

      {granted && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {!registered && (
              <Button
                onClick={register}
                disabled={busy !== null}
                className="rounded-full bg-grad-primary text-xs text-primary-foreground"
              >
                {busy === "register" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Register this device
              </Button>
            )}
            <Button
              variant="outline"
              onClick={local}
              disabled={busy !== null}
              className="rounded-full border-white/15 text-xs"
            >
              {busy === "local" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Smartphone className="mr-1.5 h-3.5 w-3.5" />
              )}
              Show a test on this device
            </Button>
            <Button
              variant="outline"
              onClick={push}
              disabled={busy !== null || !registered}
              className="rounded-full border-white/15 text-xs"
            >
              {busy === "push" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send me a real push
            </Button>
          </div>

          {localResult === "shown" && (
            <p className="mt-2 text-xs text-muted-foreground">
              The browser displayed it. If you saw nothing, the operating system is hiding this
              browser's notifications — see below.
            </p>
          )}
          {localResult === "dropped" && (
            <p className="mt-2 text-xs text-red-300">
              The browser refused to display it. Notifications for this site are off in the
              browser's own settings — see below.
            </p>
          )}
          {pushResult && <p className="mt-2 text-xs text-muted-foreground">{pushResult}</p>}

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-white/80">If a test doesn't appear on this device:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {platform === "windows" && (
                <>
                  <li>
                    Windows Settings → System → Notifications: on, and{" "}
                    <span className="text-white/80">Google Chrome</span> allowed in the list of
                    apps. Turn off{" "}
                    <span className="text-white/80">Do not disturb / Focus assist</span> — it
                    swallows notifications silently into the Action Center.
                  </li>
                  <li>
                    Chrome → ⋮ → Settings → Privacy and security → Site settings → Notifications:
                    this site under "Allowed".
                  </li>
                </>
              )}
              {platform === "mac" && (
                <>
                  <li>
                    System Settings → Notifications → Google Chrome → Allow notifications, and Focus
                    off.
                  </li>
                  <li>
                    Chrome → Settings → Privacy and security → Site settings → Notifications: this
                    site under "Allowed".
                  </li>
                </>
              )}
              {platform === "android" && (
                <>
                  <li>
                    Phone Settings → Apps → Chrome → Notifications: on. On Xiaomi/Redmi also set{" "}
                    <span className="text-white/80">Battery saver → No restrictions</span> and turn
                    on <span className="text-white/80">Autostart</span>, or Android holds pushes
                    until you open Chrome.
                  </li>
                  <li>
                    Chrome → ⋮ → Settings → Notifications: this site allowed. Do Not Disturb off.
                  </li>
                </>
              )}
              {platform === "ios" && (
                <li>
                  iPhone only delivers web push to sites added to the Home Screen: Share → Add to
                  Home Screen, open it from there, then turn notifications on again.
                </li>
              )}
              {platform === "other" && (
                <li>Check the operating system's notification settings for this browser.</li>
              )}
              <li>
                Each device registers itself: open this page on the phone too and check the same
                rows there.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function vendor(host: string): string {
  if (/fcm\.googleapis|android\.googleapis/i.test(host)) return "Chrome";
  if (/mozilla/i.test(host)) return "Firefox";
  if (/apple/i.test(host)) return "Safari / iPhone";
  if (/notify\.windows/i.test(host)) return "Edge";
  return host || "a device";
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      )}
      <span className={ok ? "text-white/85" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
