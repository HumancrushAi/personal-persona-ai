import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, Check, Lock, Gem, Camera, Trash2, Loader2, Sparkles, Star, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listToys, buyToy, setRoom, clearRoom, type ChestToy } from "@/lib/toys.functions";

// The treasure chest: a floating box in the chat that opens on a grid of sex
// toys. A toy is bought once, with credits, and from then on she uses THAT
// toy — the exact one — in every photo and clip. When she asks for one in
// chat ("get me one from my treasure chest"), the chest opens on it.
//
// The chest is a collection: what she has is counted, what she does not have
// sits behind a tier, and a purchase unlocks with a small burst — lit like
// the rest of the site, in gold and rose on black, nothing cartoon.

const tierOf = (price: number) => (price >= 600 ? "legendary" : price >= 350 ? "premium" : "classic");

const TIER_LABEL: Record<string, string> = { classic: "Classic", premium: "Premium", legendary: "Legendary" };

const TIER_RING: Record<string, string> = {
  classic: "border-white/10",
  premium: "border-amber-300/30",
  legendary: "border-rose-400/50 shadow-[0_0_22px_rgba(251,113,133,0.18)]",
};

const TIER_BADGE: Record<string, string> = {
  classic: "bg-white/[0.06] text-white/55",
  premium: "bg-amber-400/15 text-amber-200",
  legendary: "bg-gradient-to-r from-rose-500/30 to-amber-400/30 text-rose-100",
};

const STYLES = `
@keyframes hc-chest-idle { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
@keyframes hc-chest-glow { 0%,100% { box-shadow: 0 0 18px rgba(251,191,36,.35) } 50% { box-shadow: 0 0 30px rgba(251,191,36,.6) } }
@keyframes hc-chest-shake { 0%,100% { transform: rotate(0) } 20% { transform: rotate(-8deg) } 40% { transform: rotate(7deg) } 60% { transform: rotate(-5deg) } 80% { transform: rotate(4deg) } }
@keyframes hc-lid-open { from { transform: rotate(0) } to { transform: rotate(-38deg) } }
@keyframes hc-rise { from { opacity: 0; transform: translateY(14px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes hc-card-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
@keyframes hc-shimmer { from { transform: translateX(-120%) skewX(-18deg) } to { transform: translateX(220%) skewX(-18deg) } }
@keyframes hc-unlock { 0% { transform: scale(1) } 40% { transform: scale(1.06) } 100% { transform: scale(1) } }
@keyframes hc-spark { 0% { opacity: 1; transform: translate(0,0) scale(1) } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.2) } }
@keyframes hc-sheen { 0%,100% { opacity: .35 } 50% { opacity: .7 } }
@keyframes hc-star-orbit { from { transform: rotate(0deg) translateX(31px) rotate(0deg) } to { transform: rotate(360deg) translateX(31px) rotate(-360deg) } }
@keyframes hc-light-leak { 0%,100% { opacity: .5; transform: scaleX(.82) scaleY(.75) } 50% { opacity: 1; transform: scaleX(1.12) scaleY(1.08) } }
@keyframes hc-label-breathe { 0%,100% { opacity: .72; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-1px) } }
@keyframes hc-progress-shine { from { transform: translateX(-120%) } to { transform: translateX(240%) } }
.hc-chest-btn { animation: hc-chest-idle 3.2s ease-in-out infinite, hc-chest-glow 3.2s ease-in-out infinite; }
.hc-chest-btn::before { content: ""; position: absolute; inset: -12px; border-radius: 9999px; background: radial-gradient(circle, rgba(251,191,36,.2), transparent 67%); pointer-events: none; }
.hc-chest-btn:hover .hc-lid, .hc-chest-btn.hc-open .hc-lid { animation: hc-lid-open .35s ease-out forwards; }
.hc-chest-btn.hc-attention { animation: hc-chest-shake .7s ease-in-out 3, hc-chest-glow 1s ease-in-out infinite; }
.hc-lid { transform-origin: 4px 14px; transform: rotate(-18deg); transition: transform .3s ease; }
.hc-light-leak { transform-origin: center; animation: hc-light-leak 2.2s ease-in-out infinite; }
.hc-orbit-star { position: absolute; left: calc(50% - 5px); top: calc(50% - 5px); color: #fde68a; filter: drop-shadow(0 0 5px rgba(253,230,138,.9)); animation: hc-star-orbit 5s linear infinite; }
.hc-chest-label { animation: hc-label-breathe 2.2s ease-in-out infinite; }
.hc-modal { animation: hc-rise .28s ease-out; }
.hc-vault { background-image: radial-gradient(circle at 20% 0%, rgba(251,191,36,.08), transparent 28%), linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px); background-size: auto, 28px 28px, 28px 28px; }
.hc-card { animation: hc-card-in .35s ease-out both; transition: transform .22s ease, border-color .22s ease, box-shadow .22s ease; }
.hc-card:hover { transform: translateY(-4px); border-color: rgba(251,191,36,.42); box-shadow: 0 12px 32px rgba(0,0,0,.3), 0 0 18px rgba(251,191,36,.08); }
.hc-card.hc-unlocked { animation: hc-unlock .6s ease-out; }
.hc-shimmer::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.18) 50%, transparent 70%); animation: hc-shimmer 1.1s ease-out 1; }
.hc-spark { position: absolute; width: 6px; height: 6px; border-radius: 9999px; background: radial-gradient(circle, #fde68a, #fb7185); animation: hc-spark .8s ease-out forwards; pointer-events: none; }
.hc-legendary-sheen::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(135deg, rgba(251,113,133,.18), transparent 45%, rgba(251,191,36,.14)); animation: hc-sheen 2.6s ease-in-out infinite; pointer-events: none; }
.hc-progress-shine::after { content: ""; position: absolute; inset: 0; width: 35%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent); animation: hc-progress-shine 2.5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .hc-chest-btn, .hc-light-leak, .hc-orbit-star, .hc-chest-label, .hc-progress-shine::after, .hc-legendary-sheen::before { animation: none !important; } }
`;

function ChestIcon({ open, size = 28 }: { open: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className={open ? "hc-open" : ""}>
      <defs>
        <linearGradient id="hc-wood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7c2d12" />
          <stop offset="1" stopColor="#431407" />
        </linearGradient>
        <linearGradient id="hc-gold" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <ellipse className="hc-light-leak" cx="16" cy="14" rx="10" ry="4" fill="#fde68a" opacity=".75" />
      <rect x="4" y="14" width="24" height="13" rx="2.5" fill="url(#hc-wood)" stroke="url(#hc-gold)" strokeWidth="1.3" />
      <rect x="14" y="17" width="4" height="5" rx="1" fill="url(#hc-gold)" />
      <g className="hc-lid">
        <path d="M4 14 a12 8 0 0 1 24 0 Z" fill="url(#hc-wood)" stroke="url(#hc-gold)" strokeWidth="1.3" />
        <path d="M9 14 a7 5 0 0 1 14 0" fill="none" stroke="url(#hc-gold)" strokeWidth="1" opacity=".7" />
      </g>
    </svg>
  );
}

function OrbitStars() {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Star key={i} className="hc-orbit-star h-2.5 w-2.5 fill-current" style={{ animationDelay: `${i * -1.67}s` }} />
      ))}
    </span>
  );
}

export function TreasureChestButton({
  onClick,
  attention,
  open,
}: {
  onClick: () => void;
  /** She just asked for something: the chest shakes and glows for a moment. */
  attention?: boolean;
  open?: boolean;
}) {
  return (
    <>
      <style>{STYLES}</style>
      <button
        type="button"
        onClick={onClick}
        aria-label="Open the treasure chest"
        title="Treasure chest — toys she can use"
        className={`hc-chest-btn group fixed bottom-24 right-3 z-30 flex h-16 w-16 items-center justify-center rounded-full border border-amber-200/55 bg-gradient-to-br from-[#42250b] via-[#2b1508] to-[#100803] ring-1 ring-amber-400/20 transition hover:scale-110 sm:right-6 ${
          attention ? "hc-attention" : ""
        } ${open ? "hc-open" : ""}`}
      >
        <OrbitStars />
        <span className="absolute inset-1 rounded-full border border-amber-200/15" />
        <ChestIcon open={Boolean(open)} size={38} />
        <span className="hc-chest-label absolute -bottom-7 rounded-full border border-amber-300/25 bg-black/85 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.16em] text-amber-100 shadow-lg backdrop-blur">
          Treasure
        </span>
        {attention && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow">
            !
          </span>
        )}
      </button>
    </>
  );
}

function Sparks({ seed }: { seed: number }) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 + (seed % 7) * 0.1;
        const dist = 38 + ((i * 17 + seed) % 28);
        return { dx: `${Math.cos(angle) * dist}px`, dy: `${Math.sin(angle) * dist}px`, delay: `${(i % 5) * 40}ms` };
      }),
    [seed],
  );
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {sparks.map((s, i) => (
        <span
          key={i}
          className="hc-spark"
          style={{ ["--dx" as any]: s.dx, ["--dy" as any]: s.dy, animationDelay: s.delay }}
        />
      ))}
    </span>
  );
}

export function TreasureChestModal({
  name,
  conversationId,
  highlight,
  onClose,
}: {
  name: string;
  conversationId?: string;
  /** A toy she just asked for — shown first and marked. */
  highlight?: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listToys);
  const buy = useServerFn(buyToy);
  const uploadRoom = useServerFn(setRoom);
  const removeRoom = useServerFn(clearRoom);
  const [buying, setBuying] = useState<string | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<{ id: string; at: number } | null>(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["toys", conversationId ?? "none"],
    queryFn: () => list({ data: { conversationId } }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toys: ChestToy[] = useMemo(
    () => [...(data?.toys ?? [])].sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : 0)),
    [data, highlight],
  );
  const ownedCount = (data?.toys ?? []).filter((t) => t.owned).length + (data?.room.owned ? 1 : 0);
  const totalCount = (data?.toys.length ?? 0) + 1;
  const progress = totalCount ? Math.round((ownedCount / totalCount) * 100) : 0;
  const collectionLevel = Math.max(1, Math.floor(ownedCount / 3) + 1);

  async function purchase(id: string, label: string, price: number) {
    if (buying) return;
    setBuying(id);
    try {
      const res = await buy({ data: { toyId: id } });
      if ((res as any)?.needsCredits) {
        toast.error(`You need ${price} credits for the ${label.toLowerCase()} — add more to get it`);
        navigate({ to: "/credits" });
        return;
      }
      setJustUnlocked({ id, at: Date.now() });
      toast.success(id === "room" ? `Unlocked — now show ${name} your room` : `${name} has the ${label.toLowerCase()} now 😈 ask her to use it`);
      qc.invalidateQueries({ queryKey: ["toys"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not buy that");
    } finally {
      setBuying(null);
    }
  }

  async function onRoomFile(file: File | undefined) {
    if (!file || !conversationId) return;
    if (file.size > 6_000_000) {
      toast.error("That photo is over 6MB — try a smaller one");
      return;
    }
    setRoomBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read that file"));
        r.readAsDataURL(file);
      });
      const res = await uploadRoom({ data: { conversationId, dataUrl } });
      if ((res as any)?.needsItem) {
        toast.error("Unlock 'Your room' first");
        return;
      }
      toast.success(`${name} is in your room now — ask her for a photo`);
      qc.invalidateQueries({ queryKey: ["toys"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not use that photo");
    } finally {
      setRoomBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRoomClear() {
    if (!conversationId) return;
    setRoomBusy(true);
    try {
      await removeRoom({ data: { conversationId } });
      qc.invalidateQueries({ queryKey: ["toys"] });
    } finally {
      setRoomBusy(false);
    }
  }

  const room = data?.room;
  const roomTier = "premium";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/80 backdrop-blur-sm md:items-center md:p-6"
      onClick={onClose}
    >
      <style>{STYLES}</style>
      <div
        className="hc-modal hc-vault flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-amber-300/25 bg-[#131009] text-white shadow-[0_25px_90px_rgba(0,0,0,.72),0_0_45px_rgba(251,191,36,.08)] md:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-start justify-between gap-3 overflow-hidden border-b border-amber-200/10 px-5 py-5 sm:px-6">
          <div className="pointer-events-none absolute -left-12 -top-16 h-44 w-44 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative min-w-0 flex-1">
            <div className="flex items-center gap-3 text-lg font-semibold sm:text-xl">
              <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-amber-200/25 bg-gradient-to-br from-amber-400/15 to-rose-500/5 shadow-[0_0_25px_rgba(251,191,36,.16)]">
                <Sparkles className="absolute -right-1 -top-1 h-4 w-4 text-amber-200" />
                <ChestIcon open size={40} />
              </span>
              <span className="min-w-0">
                <span className="block truncate">{name}&apos;s treasure chest</span>
                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  <Trophy className="h-3 w-3" /> Level {collectionLevel}
                </span>
              </span>
            </div>
            <p className="mt-1 text-sm text-white/60">
              Collect lasting unlocks, then call them into any photo or video.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="hc-progress-shine relative h-full overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-500 transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-amber-200/80">
                {data ? `Her collection · ${ownedCount}/${totalCount}` : "Opening…"}
              </span>
            </div>
            {data && (
              <p className="mt-1.5 text-xs text-white/45">
                {data.free ? "Free on this account — unlock what you want her to use." : `You have ${data.credits} credits.`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {isLoading && <div className="py-10 text-center text-sm text-white/50">Opening the chest…</div>}

          {room && (
            <div
              className={`hc-card relative mb-4 overflow-hidden rounded-2xl border p-4 ${TIER_RING[roomTier]} bg-white/[0.04] ${
                justUnlocked?.id === "room" ? "hc-unlocked hc-shimmer" : ""
              }`}
            >
              {justUnlocked?.id === "room" && <Sparks seed={justUnlocked.at} />}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                  <div className="text-3xl" aria-hidden>
                    🛏️
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">Your room</div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TIER_BADGE[roomTier]}`}>
                        {TIER_LABEL[roomTier]}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] leading-snug text-white/55">
                      Show her a photo of your bedroom and she poses in it — your bed, your walls, your light — in every
                      photo and clip of this chat.
                    </div>
                    {room.owned && room.description && (
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-300/90">
                        <Check className="h-3.5 w-3.5" /> She&apos;s in your room: <span className="truncate text-white/60">{room.description}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(room.url || room.image) && (
                    <img
                      src={room.url ?? room.image}
                      alt={room.url ? "Your room" : "A room"}
                      className="h-16 w-16 rounded-xl border border-white/10 object-cover"
                    />
                  )}
                  {!room.owned ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={buying === "room"}
                      onClick={() => purchase("room", "Your room", room.price)}
                      className="h-8 rounded-full bg-gradient-to-r from-amber-500 to-rose-600 text-xs font-semibold text-white hover:opacity-90"
                    >
                      {buying === "room" ? "Unlocking…" : (
                        <span className="inline-flex items-center gap-1">
                          <Gem className="h-3.5 w-3.5" /> {data?.free ? "Unlock free" : `${room.price} credits`}
                        </span>
                      )}
                    </Button>
                  ) : (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onRoomFile(e.target.files?.[0])}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={roomBusy || !conversationId}
                        onClick={() => fileRef.current?.click()}
                        className="h-8 rounded-full bg-white/10 text-xs font-medium text-white hover:bg-white/20"
                      >
                        {roomBusy ? (
                          <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking…</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" /> {room.url ? "Change photo" : "Add a photo"}</span>
                        )}
                      </Button>
                      {room.url && (
                        <button
                          type="button"
                          onClick={onRoomClear}
                          disabled={roomBusy}
                          aria-label="Remove the room"
                          className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                <Sparkles className="h-4 w-4 text-amber-300" /> Collectibles
              </div>
              <p className="mt-0.5 text-[11px] text-white/40">Build the collection and use every unlocked item in chat.</p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] text-white/50">{progress}% complete</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {toys.map((t, i) => {
              const wanted = t.id === highlight;
              const tier = tierOf(t.price);
              const unlocked = justUnlocked?.id === t.id;
              return (
                <div
                  key={t.id}
                  style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  className={`hc-card relative flex flex-col overflow-hidden rounded-2xl border p-3 ${
                    wanted
                      ? "border-amber-300/70 bg-amber-400/10 shadow-[0_0_18px_rgba(251,191,36,0.25)]"
                      : `${TIER_RING[tier]} bg-white/[0.04]`
                  } ${tier === "legendary" && !t.owned ? "hc-legendary-sheen" : ""} ${unlocked ? "hc-unlocked hc-shimmer" : ""}`}
                >
                  {unlocked && <Sparks seed={justUnlocked!.at} />}
                  <div className="relative -mx-3 -mt-3 mb-1 aspect-square overflow-hidden rounded-t-2xl bg-[#0d0b08]">
                    {t.image ? (
                      <img
                        src={t.image}
                        alt={t.name}
                        loading="lazy"
                        className={`h-full w-full object-cover transition duration-500 ${t.owned ? "" : "saturate-[.85]"} hover:scale-105`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-5xl" aria-hidden>
                        {t.emoji}
                      </div>
                    )}
                    <span className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur ${TIER_BADGE[tier]}`}>
                      <Star className="h-2.5 w-2.5 fill-current" /> {TIER_LABEL[tier]}
                    </span>
                    {t.owned && (
                      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/90 text-white shadow">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {!t.owned && (
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-amber-200 backdrop-blur">
                        {data?.free ? "free" : <>{t.price} <Gem className="-mt-0.5 inline h-3 w-3" /></>}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-semibold leading-tight">{t.name}</div>
                  <div className="mt-1 flex-1 text-[11px] leading-snug text-white/55">{t.blurb}</div>
                  {wanted && <div className="mt-2 text-[11px] font-medium text-amber-300">she asked for this one</div>}
                  <div className="mt-3">
                    {t.owned ? (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                        <Check className="h-3.5 w-3.5" /> Hers
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={buying === t.id}
                        onClick={() => purchase(t.id, t.name, t.price)}
                        className="h-8 w-full rounded-full bg-gradient-to-r from-amber-500 to-rose-600 text-xs font-semibold text-white hover:opacity-90"
                      >
                        {buying === t.id ? (
                          "Unlocking…"
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Lock className="h-3 w-3 opacity-70" /> {data?.free ? "Unlock free" : <><Gem className="h-3.5 w-3.5" /> {t.price}</>}
                          </span>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3 text-[11px] text-white/45">
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" /> What you unlock stays hers in every chat with her.
          </span>
          <button type="button" onClick={() => navigate({ to: "/credits" })} className="text-amber-200/80 hover:underline">
            Get credits
          </button>
        </div>
      </div>
    </div>
  );
}
