import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { enablePush } from "@/lib/push-client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Plus, Coins, Shield, Bell, LifeBuoy } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { mySupportTickets } from "@/lib/support.functions";
import { NotificationsCard } from "@/components/NotificationsCard";
import { useSystemStatus } from "@/hooks/use-app-setting";
import { toast } from "sonner";

export const Route = createFileRoute("/me")({
  ssr: false,
  head: () => ({ meta: [{ title: "My chats — HumanCrush.com" }] }),
  component: MePage,
});

function MePage() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: conversations } = useQuery({
    enabled: !!userId,
    queryKey: ["my-convs", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, title, updated_at, relationship_level, user_personalities(nickname, companion_id, companions(image_url))",
        )
        .eq("user_id", userId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      // One entry per model — keep the most recent conversation per companion.
      const seen = new Set<string>();
      return (data ?? []).filter((c: any) => {
        const key = c.user_personalities?.companion_id ?? c.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });

  const { data: isAdmin } = useQuery({
    enabled: !!userId,
    queryKey: ["is-admin", userId],
    queryFn: async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: userId!, _role: "admin" });
      return !!data;
    },
  });

  const { data: balance } = useQuery({
    enabled: !!userId,
    queryKey: ["balance"],
    queryFn: async () => {
      const { data } = await supabase
        .from("credit_balances")
        .select("free_messages_remaining, paid_credits")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function turnOnNotifications() {
    try {
      const r = await enablePush();
      if (r === "enabled") toast.success("Notifications on — she'll ping you 💌");
      else if (r === "denied") toast.error("You blocked notifications in your browser");
      else toast.error("Notifications aren't available on this device/browser");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't enable notifications");
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader
        mobileRight={
          <Link
            to="/credits"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5 text-xs font-medium ring-1 ring-white/10"
          >
            <Coins className="h-3.5 w-3.5 text-primary" />{" "}
            {(balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0)}
          </Link>
        }
        right={
          <>
            <Link
              to="/credits"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5 text-xs font-medium ring-1 ring-white/10"
            >
              <Coins className="h-3.5 w-3.5 text-primary" />{" "}
              {(balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0)}
            </Link>
            <Button
              onClick={turnOnNotifications}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              title="Enable notifications"
            >
              <Bell className="h-4 w-4" />
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2 text-xs sm:px-3"
            >
              <Link to="/history">History</Link>
            </Button>
            {/* Shown to everyone, not only to existing affiliates: the page is
                also where you apply, and a link that only appears once you are
                already an affiliate can never be how anyone becomes one. */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2 text-xs sm:px-3"
            >
              <Link to="/affiliate">Earn</Link>
            </Button>
            {isAdmin && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-2 text-xs sm:px-3"
              >
                <Link to="/admin">
                  <Shield className="mr-1 h-3.5 w-3.5" /> Admin
                </Link>
              </Button>
            )}
            <Button
              onClick={signOut}
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2 text-xs sm:px-3"
            >
              Sign out
            </Button>
          </>
        }
      />

      <section className="mx-auto max-w-4xl px-6 pb-20">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-4xl font-semibold md:text-5xl">Your chats</h1>
          <Button
            asChild
            className="rounded-full bg-grad-primary text-primary-foreground shadow-glow"
          >
            <Link to="/browse">
              <Plus className="mr-1 h-4 w-4" /> New
            </Link>
          </Button>
        </div>

        {!conversations?.length && (
          <div className="glass mt-10 rounded-3xl p-10 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">No chats yet. Pick someone.</p>
            <Button asChild className="mt-5 rounded-full bg-grad-primary text-primary-foreground">
              <Link to="/browse">Browse companions</Link>
            </Button>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {conversations?.map((c) => {
            const p: any = c.user_personalities;
            return (
              <Link
                key={c.id}
                to="/chat/$conversationId"
                params={{ conversationId: c.id }}
                className="glass flex items-center gap-4 rounded-2xl p-4 transition hover:shadow-glow"
              >
                {p?.companions?.image_url && (
                  <img
                    src={companionImage(p.companions.image_url)}
                    alt=""
                    width={64}
                    height={64}
                    className="h-14 w-14 rounded-full object-cover object-top ring-2 ring-primary/50"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg font-semibold">{p?.nickname}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Heart className="h-3 w-3 fill-primary text-primary" /> Level{" "}
                    {c.relationship_level ?? 1}
                    <span>·</span>
                    <span>{new Date(c.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <NotificationsCard />
        <SupportThreads />
        <SystemStatusLine />
      </section>
    </div>
  );
}

// The admin's "System status" message (Platform Content tab). It was saved and
// never shown anywhere; this is where it shows.
function SystemStatusLine() {
  const status = useSystemStatus();
  if (!status) return null;
  return (
    <p className="mt-10 text-center text-[11px] text-muted-foreground">
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
      {status}
    </p>
  );
}

// A staff reply is emailed, but a push notification saying "Support replied"
// has to lead somewhere — this is where it lands. Renders nothing at all when
// the account has never opened a ticket, so it stays out of the way.
function SupportThreads() {
  const fetchTickets = useServerFn(mySupportTickets);
  const { data } = useQuery({
    queryKey: ["my-support-tickets"],
    queryFn: () => fetchTickets({} as any) as any,
    staleTime: 30_000,
  });

  const tickets = (data as any)?.tickets ?? [];
  if (!tickets.length) return null;

  return (
    <div className="mt-12">
      <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-semibold">
        <LifeBuoy className="h-5 w-5 text-primary" /> Support
      </h2>
      <div className="space-y-3">
        {tickets.map((t: any) => (
          <div key={t.id} className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-primary">
                #{String(t.id).slice(0, 8)}
              </span>
              <span className="text-sm font-medium">{t.subject}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t.status}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {t.messages.map((m: any) => (
                <div
                  key={m.id}
                  className={`rounded-lg p-2.5 text-xs ${
                    m.direction === "in"
                      ? "border-l-2 border-white/25 bg-black/30"
                      : "border-l-2 border-primary bg-primary/10"
                  }`}
                >
                  <p className="mb-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {m.direction === "in" ? "You" : "Support"} ·{" "}
                    {new Date(m.created_at).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
