import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Plus, Coins, Shield } from "lucide-react";
import { AgeGate } from "@/components/AgeGate";

export const Route = createFileRoute("/me")({
  ssr: false,
  head: () => ({ meta: [{ title: "My chats — HumanCrush.ai" }] }),
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
          "id, title, updated_at, relationship_level, user_personalities(nickname, companions(image_url))",
        )
        .eq("user_id", userId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
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

  return (
    <div className="min-h-screen">
      <AgeGate />
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-2xl font-semibold">HumanCrush.ai</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/credits"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium ring-1 ring-white/10"
          >
            <Coins className="h-3.5 w-3.5 text-primary" />{" "}
            {(balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0)}
          </Link>
          <Button asChild variant="ghost" className="rounded-full">
            <Link to="/history">History</Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="ghost" className="rounded-full">
              <Link to="/admin">
                <Shield className="mr-1 h-3.5 w-3.5" /> Admin
              </Link>
            </Button>
          )}
          <Button onClick={signOut} variant="ghost" className="rounded-full">
            Sign out
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-20">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-4xl font-semibold md:text-5xl">Your girls</h1>
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
                    className="h-14 w-14 rounded-full object-cover ring-2 ring-primary/50"
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
      </section>
    </div>
  );
}
