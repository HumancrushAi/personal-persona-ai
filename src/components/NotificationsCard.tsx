import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellRing, CheckCircle2, Loader2, Send, Smartphone, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendTestPush } from "@/lib/notifications.functions";
import {
  enablePush,
  pushStatus,
  showLocalTestNotification,
  type PushStatus,
} from "@/lib/push-client";
import { toast } from "sonner";

// Notifications, with the diagnostics that make "it says enabled but nothing
// arrives" answerable.
//
// A push has to survive four hand-offs: the browser granting permission, this
// device's subscription being on file, the push service accepting the message,
// and the phone choosing to SHOW it. "Enabled" only ever proved the first. The
// two test buttons split the rest: a local notification skips the server
// entirely, so if it does not appear the phone is hiding notifications and no
// server change will help; a real push goes the whole way and reports how many
// devices the push service accepted it for.
export function NotificationsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<"enable" | "local" | "push" | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const testPush = useServerFn(sendTestPush);

  const refresh = () => pushStatus().then(setStatus);
  useEffect(() => {
    refresh();
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

  async function local() {
    setBusy("local");
    try {
      const ok = await showLocalTestNotification();
      if (!ok) toast.error("Turn notifications on first");
    } finally {
      setBusy(null);
    }
  }

  async function push() {
    setBusy("push");
    setPushResult(null);
    try {
      const r: any = await testPush();
      const line =
        r.total === 0
          ? "No device is subscribed on this account — tap Turn on first."
          : `Push service accepted it for ${r.sent} of ${r.total} device${r.total === 1 ? "" : "s"}.${
              r.errors?.length ? ` Errors: ${r.errors.join("; ")}` : ""
            }`;
      setPushResult(line);
    } catch (e: any) {
      setPushResult(e?.message ?? "Sending failed");
    } finally {
      setBusy(null);
    }
  }

  const on = status?.permission === "granted" && status?.subscribed;
  const android = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);

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
            ok={status.permission === "granted"}
            label={
              status.permission === "denied"
                ? "Permission blocked — allow notifications for this site in the browser"
                : "Permission granted"
            }
          />
          <Row ok={status.serviceWorker} label="Background worker installed" />
          <Row ok={status.subscribed} label="This device is subscribed" />
        </ul>
      )}

      {on && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
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
              disabled={busy !== null}
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
          {pushResult && <p className="mt-2 text-xs text-muted-foreground">{pushResult}</p>}

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-white/80">If the test doesn't pop up on your phone:</p>
            {android ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  Phone Settings → Apps → Chrome → Notifications: on. On Xiaomi/Redmi also set{" "}
                  <span className="text-white/80">Battery saver → No restrictions</span> and turn on{" "}
                  <span className="text-white/80">Autostart</span>, or Android holds pushes until
                  you open Chrome.
                </li>
                <li>Chrome → ⋮ → Settings → Notifications: this site allowed.</li>
                <li>Do Not Disturb off. Then tap "Show a test on this device" again.</li>
              </ul>
            ) : ios ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  iPhone only delivers web push to sites added to the Home Screen: Share → Add to
                  Home Screen, open it from there, then turn notifications on again.
                </li>
              </ul>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Check the operating system's notification settings for this browser.</li>
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-red-400" />
      )}
      <span className={ok ? "text-white/85" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
