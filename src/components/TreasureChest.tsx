import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, Check, Lock, Gem } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listToys, buyToy, type ChestToy } from "@/lib/toys.functions";

// The treasure chest: a floating box in the chat that opens on a grid of sex
// toys. A toy is bought once, with credits, and from then on she uses THAT
// toy — the exact one — in every photo and clip. When she asks for one in
// chat ("get me one from my treasure chest"), the chest opens on it.

export function TreasureChestButton({ onClick, attention }: { onClick: () => void; attention?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open the treasure chest"
      title="Treasure chest — toys she can use"
      className={`fixed bottom-24 right-3 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/40 bg-gradient-to-br from-amber-500 to-rose-600 text-xl shadow-[0_0_24px_rgba(251,191,36,0.45)] transition hover:scale-105 sm:right-6 ${
        attention ? "animate-bounce" : ""
      }`}
    >
      <span aria-hidden>🧰</span>
    </button>
  );
}

export function TreasureChestModal({
  name,
  highlight,
  onClose,
}: {
  name: string;
  /** A toy she just asked for — shown first and marked. */
  highlight?: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listToys);
  const buy = useServerFn(buyToy);
  const [buying, setBuying] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["toys"],
    queryFn: () => list(),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toys: ChestToy[] = [...(data?.toys ?? [])].sort((a, b) =>
    a.id === highlight ? -1 : b.id === highlight ? 1 : 0,
  );

  async function purchase(t: ChestToy) {
    if (buying) return;
    setBuying(t.id);
    try {
      const res = await buy({ data: { toyId: t.id } });
      if ((res as any)?.needsCredits) {
        toast.error(`You need ${t.price} credits for the ${t.name.toLowerCase()} — add more to get it`);
        navigate({ to: "/credits" });
        return;
      }
      toast.success(`${name} has the ${t.name.toLowerCase()} now 😈 ask her to use it`);
      qc.invalidateQueries({ queryKey: ["toys"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not buy that");
    } finally {
      setBuying(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/80 backdrop-blur-sm md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-3xl border border-amber-300/20 bg-[#161210] text-white shadow-2xl md:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden>🧰</span> {name}&apos;s treasure chest
            </div>
            <p className="mt-1 text-sm text-white/60">
              Buy a toy once and it&apos;s hers for good — she&apos;ll use that exact one in every photo and video you ask for.
            </p>
            {data && (
              <p className="mt-1 text-xs text-amber-200/80">
                {data.free ? "Everything in the chest is free on this account." : `You have ${data.credits} credits.`}
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

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {isLoading && <div className="col-span-full py-10 text-center text-sm text-white/50">Opening the chest…</div>}
          {toys.map((t) => {
            const wanted = t.id === highlight;
            return (
              <div
                key={t.id}
                className={`flex flex-col rounded-2xl border p-3 ${
                  wanted
                    ? "border-amber-300/70 bg-amber-400/10 shadow-[0_0_18px_rgba(251,191,36,0.25)]"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="text-3xl" aria-hidden>
                  {t.emoji}
                </div>
                <div className="mt-2 text-sm font-semibold leading-tight">{t.name}</div>
                <div className="mt-1 flex-1 text-[11px] leading-snug text-white/55">{t.blurb}</div>
                {wanted && <div className="mt-2 text-[11px] font-medium text-amber-300">she asked for this one</div>}
                <div className="mt-3">
                  {t.owned ? (
                    <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                      <Check className="h-3.5 w-3.5" /> {data?.free ? "Free for you" : "Hers"}
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={buying === t.id}
                      onClick={() => purchase(t)}
                      className="h-8 w-full rounded-full bg-gradient-to-r from-amber-500 to-rose-600 text-xs font-semibold text-white hover:opacity-90"
                    >
                      {buying === t.id ? (
                        "Buying…"
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Gem className="h-3.5 w-3.5" /> {t.price} credits
                        </span>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3 text-[11px] text-white/45">
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" /> Toys stay in her chest for every chat with her.
          </span>
          <button type="button" onClick={() => navigate({ to: "/credits" })} className="text-amber-200/80 hover:underline">
            Get credits
          </button>
        </div>
      </div>
    </div>
  );
}
