import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { amIAdmin } from "@/lib/admin.functions";
import { studioGenerate, studioClip } from "@/lib/studio.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Film, Download, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/studio")({
  ssr: false,
  head: () => ({ meta: [{ title: "Promo Studio — HumanCrush.com" }] }),
  component: StudioPage,
});

// Starting points that already read like the reference pages this is for.
const PRESETS = [
  "a goth woman, black bob haircut, black lipstick, green eyes, black silk robe over white lace lingerie, sitting on a balcony, daylight",
  "a redhead in a tight green dress, freckles, standing in a city apartment at golden hour",
  "a blonde in a white crop top and denim shorts, kitchen, morning light, natural smile",
  "a brunette in black gym wear, mirror selfie in a modern gym, confident look",
];

type Shot = { url: string; clipUrl?: string; clipStatus?: "running" | "failed" };

function StudioPage() {
  const checkAdmin = useServerFn(amIAdmin);
  const generate = useServerFn(studioGenerate);
  const makeClip = useServerFn(studioClip);
  const checkJob = useServerFn(checkMediaJob);

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  // When set, new images are built from this face instead of from scratch —
  // that is what turns a pile of strangers into a set of one persona.
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    checkAdmin({} as any)
      .then((r: any) => setIsAdmin(!!r?.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  async function run() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const res: any = await generate({
        data: { prompt: p, count, referenceUrl: reference ?? undefined },
      });
      setShots((prev) => [...res.images.map((url: string) => ({ url })), ...prev]);
      if (res.errors?.length) toast.warning(`${res.errors.length} of ${count} failed`);
    } catch (e: any) {
      toast.error(e?.message ?? "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function animate(shot: Shot) {
    setShots((prev) => prev.map((s) => (s.url === shot.url ? { ...s, clipStatus: "running" } : s)));
    try {
      const res: any = await makeClip({ data: { imageUrl: shot.url, seconds: 5 } });
      // Same reconcile the chat uses; clips take a couple of minutes.
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let j: any = null;
        try {
          j = await checkJob({ data: { jobId: res.jobId } });
        } catch {
          continue;
        }
        if (j?.status === "completed" && j.mediaUrl) {
          setShots((prev) =>
            prev.map((s) =>
              s.url === shot.url ? { ...s, clipUrl: j.mediaUrl, clipStatus: undefined } : s,
            ),
          );
          return;
        }
        if (j?.status === "failed") break;
      }
      throw new Error("Clip failed");
    } catch (e: any) {
      setShots((prev) =>
        prev.map((s) => (s.url === shot.url ? { ...s, clipStatus: "failed" } : s)),
      );
      toast.error(e?.message ?? "Clip failed");
    }
  }

  if (isAdmin === null) {
    return <div className="p-8 text-sm text-muted-foreground">Checking access…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Admins only.</p>
        <Link to="/" className="text-sm text-primary hover:underline">
          Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-24">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <div className="mb-5 flex items-center gap-3">
          <Link to="/admin" className="rounded-full p-2 hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold">Promo Studio</h1>
            <p className="text-xs text-muted-foreground">
              Clothed promo images and short clips for social pages and funnels.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder="Describe the model — e.g. a goth woman, black bob, black lipstick, silk robe over lace, balcony"
            className="w-full resize-y rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-white/35 focus:border-primary/50"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrompt(p)}
                className="min-h-11 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/75 hover:bg-white/10"
              >
                {p.split(",")[0]}
              </button>
            ))}
          </div>

          {reference && (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 p-2">
              <img src={reference} alt="" className="h-12 w-12 rounded-lg object-cover" />
              <p className="flex-1 text-[11px] text-white/80">
                Keeping this face. New images will be the same person.
              </p>
              <Button size="sm" variant="ghost" onClick={() => setReference(null)}>
                Clear
              </Button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`min-h-11 w-11 rounded-full border text-xs font-medium ${
                    count === n
                      ? "border-primary/60 bg-grad-primary text-primary-foreground"
                      : "border-white/10 bg-white/5 text-white/75"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button
              onClick={run}
              disabled={busy || !prompt.trim()}
              className="min-h-11 flex-1 rounded-full bg-grad-primary text-primary-foreground shadow-glow"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Generate {count}
                </>
              )}
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Each image is billed by xAI. Images are clothed by design — explicit versions come from
            the chat pipeline.
          </p>
        </div>

        {shots.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            {shots.map((s) => (
              <div
                key={s.url}
                className="overflow-hidden rounded-2xl border border-white/10 bg-card"
              >
                {s.clipUrl ? (
                  <video src={s.clipUrl} controls loop playsInline className="w-full" />
                ) : (
                  <img src={s.url} alt="" className="aspect-[2/3] w-full object-cover" />
                )}
                <div className="flex flex-wrap gap-1 p-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 flex-1 text-[11px]"
                    onClick={() => {
                      setReference(s.url);
                      toast.success("Locked this face for the next generation");
                    }}
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" /> Same person
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 flex-1 text-[11px]"
                    disabled={s.clipStatus === "running"}
                    onClick={() => animate(s)}
                  >
                    {s.clipStatus === "running" ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Clip…
                      </>
                    ) : (
                      <>
                        <Film className="mr-1 h-3.5 w-3.5" /> Clip
                      </>
                    )}
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="min-h-11 text-[11px]">
                    <a href={s.clipUrl ?? s.url} target="_blank" rel="noreferrer">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
