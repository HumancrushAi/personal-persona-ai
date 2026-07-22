import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { viewerCount, getCompanionReel } from "@/lib/reels";
import { companionImage } from "@/lib/companion-images";
import { sendTip, startPrivateShow, TIP_AMOUNTS, PRIVATE_ENTRY_COST } from "@/lib/cams.functions";
import { startChat } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { X, Circle, Coins, Gift, Lock, Heart, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/cams/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "Live — HumanCrush.com" }] }),
  component: CamView,
});

const AMBIENT: { u: string; t: string }[] = [
  { u: "user827", t: "nobody told me i'd be falling in love today" },
  { u: "guest7", t: "the eye contact through the screen feels illegal" },
  { u: "mike_d", t: "worth every credit 🔥" },
  { u: "user19", t: "that look just hit different 😮‍💨" },
  { u: "guest23", t: "perfect background for my work session lol" },
  { u: "j_playa", t: "tip them, they earned it 💸" },
  { u: "anon_44", t: "going private brb 😏" },
  { u: "leo_x", t: "how is this so real" },
  { u: "danny", t: "okay new favorite fr" },
];

const NAME_COLORS = ["#ff7ab6", "#8fd3ff", "#c9a3ff", "#9be29b", "#ffd479"];

function CamView() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tip = useServerFn(sendTip);
  const goPrivate = useServerFn(startPrivateShow);
  const openChat = useServerFn(startChat);

  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  const { data: model } = useQuery({
    queryKey: ["cam", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, age, ethnicity, image_url")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const reel = model ? getCompanionReel(model.name) : null;

  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("credit_balances")
        .select("free_messages_remaining, paid_credits")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return data;
    },
  });
  const credits = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);

  // Rolling ambient live chat.
  const [chat, setChat] = useState<{ u: string; t: string; c: string }[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let i = 0;
    const tick = () => {
      const m = AMBIENT[i % AMBIENT.length];
      setChat((prev) => [
        ...prev.slice(-7),
        { u: m.u, t: m.t, c: NAME_COLORS[i % NAME_COLORS.length] },
      ]);
      i++;
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0); // tip animation trigger

  function requireLogin(): boolean {
    if (authed) return true;
    navigate({ to: "/auth", search: { companion: id } as any });
    return false;
  }

  async function doTip(amount: number) {
    if (!requireLogin() || busy) return;
    setBusy(true);
    try {
      await tip({ data: { amount, companionId: id } });
      setBurst((b) => b + 1);
      setChat((prev) => [
        ...prev.slice(-7),
        { u: "you", t: `tipped ${amount} 💸`, c: "#ff4d8d" },
        { u: model?.name ?? "she", t: "mmm thank you baby 😘", c: "#ff7ab6" },
      ]);
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e: any) {
      if (String(e?.message).includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits");
        navigate({ to: "/credits" });
      } else toast.error(e?.message ?? "Tip failed");
    } finally {
      setBusy(false);
    }
  }

  async function doChat() {
    if (!requireLogin() || busy) return;
    setBusy(true);
    try {
      const res = await openChat({ data: { companionId: id } });
      navigate({ to: "/chat/$conversationId", params: { conversationId: res.conversationId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open chat");
    } finally {
      setBusy(false);
    }
  }

  async function doPrivate() {
    if (!requireLogin() || busy) return;
    setBusy(true);
    try {
      const res = await goPrivate({ data: { companionId: id } });
      navigate({ to: "/chat/$conversationId", params: { conversationId: res.conversationId } });
    } catch (e: any) {
      if (String(e?.message).includes("OUT_OF_CREDITS")) {
        toast.error(`Private shows cost ${PRIVATE_ENTRY_COST} credits to start`);
        navigate({ to: "/credits" });
      } else toast.error(e?.message ?? "Couldn't start private");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-screen w-full items-stretch justify-center overflow-hidden bg-black">
      {/* Blurred backdrop fills the wide desktop screen behind the portrait stage */}
      <img
        aria-hidden
        src={companionImage(model?.image_url ?? "")}
        alt=""
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
      />
      {/* Portrait stage — the model, centered and readable on any screen */}
      <div className="relative h-full w-full max-w-[460px] overflow-hidden shadow-2xl">
        {reel ? (
          <video
            key={id}
            src={reel}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <img
            key={id}
            src={companionImage(model?.image_url ?? "")}
            alt={model?.name ?? ""}
            className="animate-live absolute inset-0 h-full w-full object-cover object-top"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/50" />

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-black/55 px-3 py-1 backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                {model?.name ?? "…"}
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-1.5 py-0.5 text-[10px]">
                  <Circle className="h-1.5 w-1.5 fill-white text-white" /> LIVE
                </span>
              </div>
              <div className="text-[11px] text-white/70">👁 {viewerCount(id)} watching</div>
            </div>
          </div>
          <Link
            to="/cams"
            className="rounded-full bg-black/55 p-2 text-white backdrop-blur hover:bg-black/75"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>

        {/* Credits pill */}
        <Link
          to="/credits"
          className="absolute right-3 top-16 inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur"
        >
          <Coins className="h-3.5 w-3.5 text-primary" /> {credits}
        </Link>

        {/* Ambient live chat */}
        <div
          ref={feedRef}
          className="absolute inset-x-0 bottom-44 mx-auto max-h-48 max-w-lg space-y-1.5 overflow-y-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chat.map((m, i) => (
            <div key={i} className="text-sm drop-shadow">
              <span className="font-semibold" style={{ color: m.c }}>
                {m.u}
              </span>{" "}
              <span className="text-white/90">{m.t}</span>
            </div>
          ))}
        </div>

        {/* Tip burst */}
        {burst > 0 && (
          <div
            key={burst}
            className="pointer-events-none absolute bottom-40 left-1/2 -translate-x-1/2 animate-bounce text-4xl"
          >
            💸💖
          </div>
        )}

        {/* Controls */}
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-lg space-y-3 p-4">
          <div className="flex items-center justify-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TIP_AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => doTip(a)}
                disabled={busy}
                className="shrink-0 rounded-full border border-primary/40 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-primary/20"
              >
                💸 {a}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => doTip(TIP_AMOUNTS[1])}
              disabled={busy}
              variant="outline"
              size="icon"
              className="rounded-full border-white/20 bg-black/50 text-white backdrop-blur"
              title="Send a tip"
            >
              <Gift className="h-4 w-4 text-primary" />
            </Button>
            <Button
              onClick={doChat}
              disabled={busy}
              className="flex-1 rounded-full bg-grad-primary text-primary-foreground shadow-glow"
            >
              <MessageCircle className="mr-1 h-4 w-4" /> Chat
            </Button>
            <Button
              onClick={doPrivate}
              disabled={busy}
              variant="outline"
              className="flex-1 rounded-full border-white/20 bg-black/50 text-white backdrop-blur"
            >
              <Lock className="mr-1 h-4 w-4" /> Private · {PRIVATE_ENTRY_COST}
            </Button>
          </div>
          {authed === false && (
            <p className="flex items-center justify-center gap-1 text-center text-[11px] text-white/60">
              <Heart className="h-3 w-3 fill-primary text-primary" /> Sign in to chat, tip, or go
              private
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
