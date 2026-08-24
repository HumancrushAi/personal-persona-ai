import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { amIAdmin, adminAddCompanionMedia, adminDeleteCompanionMedia } from "@/lib/admin.functions";
import { studioGenerate, studioClip, studioDelete, refineStudioPrompt } from "@/lib/studio.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Sparkles,
  Film,
  Download,
  Link2,
  Loader2,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

// The files live on Supabase, so a plain <a download> is cross-origin and the
// browser navigates to the image instead of saving it. Fetching to a blob and
// handing that to the anchor is what actually produces a file on disk.
async function saveFile(url: string, name: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not fetch file");
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download before the browser has
  // started it on Firefox and Safari.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

type Shot = {
  id?: string;
  url: string;
  clipUrl?: string;
  clipStatus?: "running" | "failed";
  // The brief that produced this shot, so Regenerate repeats it even after the
  // prompt box has moved on.
  prompt: string;
  reference?: string | null;
  busy?: "regen" | "delete";
};

function StudioPage() {
  const checkAdmin = useServerFn(amIAdmin);
  const generate = useServerFn(studioGenerate);
  const makeClip = useServerFn(studioClip);
  const removeShot = useServerFn(studioDelete);
  const checkJob = useServerFn(checkMediaJob);
  const deleteMedia = useServerFn(adminDeleteCompanionMedia);
  const addMedia = useServerFn(adminAddCompanionMedia);

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  // When set, new images are built from this face instead of from scratch —
  // that is what turns a pile of strangers into a set of one persona.
  const [reference, setReference] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Companion selection, prompt refiner, custom video motion prompts, and gallery filter states
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | null>(null);
  const [loadingShots, setLoadingShots] = useState(false);
  const [refiningPrompt, setRefiningPrompt] = useState(false);
  const [animatingShotUrl, setAnimatingShotUrl] = useState<string | null>(null);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [motionSeconds, setMotionSeconds] = useState(5);
  const [refiningMotion, setRefiningMotion] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "images" | "videos">("all");

  const { data: companions } = useQuery({
    queryKey: ["studio-companions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, image_url")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    checkAdmin({} as any)
      .then((r: any) => setIsAdmin(!!r?.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  async function handleCompanionChange(companionId: string) {
    setSelectedCompanionId(companionId || null);
    if (!companionId) {
      setReference(null);
      setShots([]);
      return;
    }

    const comp = companions?.find((c) => c.id === companionId);
    if (comp) {
      setReference(comp.image_url);
    }

    setLoadingShots(true);
    try {
      const { data, error } = await supabase
        .from("companion_media")
        .select("id, media_url, created_at")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const loaded = (data ?? []).map((row) => {
        const url = row.media_url;
        const isVideo = url.endsWith(".mp4") || url.endsWith(".webm") || url.includes("video");
        return {
          id: row.id,
          url: isVideo ? "" : url,
          clipUrl: isVideo ? url : undefined,
          prompt: "",
          reference: comp?.image_url || null,
        };
      });
      setShots(loaded);
    } catch (e: any) {
      toast.error("Failed to load saved images: " + e.message);
    } finally {
      setLoadingShots(false);
    }
  }

  async function handleRefinePrompt() {
    const p = prompt.trim();
    if (!p || refiningPrompt) return;
    setRefiningPrompt(true);
    try {
      const res = await refineStudioPrompt({ data: { prompt: p, hasReference: !!reference } });
      if (res?.refined) {
        setPrompt(res.refined);
        toast.success("Prompt refined successfully!");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Refinement failed");
    } finally {
      setRefiningPrompt(false);
    }
  }

  async function handleRefineMotion() {
    if (!motionPrompt.trim() || refiningMotion) return;
    setRefiningMotion(true);
    try {
      const res = await refineStudioPrompt({ data: { prompt: motionPrompt, hasReference: true } });
      if (res?.refined) {
        setMotionPrompt(res.refined);
        toast.success("Motion prompt refined successfully!");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Refinement failed");
    } finally {
      setRefiningMotion(false);
    }
  }

  // Segmented gallery filter
  const filteredShots = shots.filter((s) => {
    if (galleryFilter === "images") return !s.clipUrl;
    if (galleryFilter === "videos") return !!s.clipUrl;
    return true;
  });

  async function run() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const res: any = await generate({
        data: {
          prompt: p,
          count,
          referenceUrl: reference ?? undefined,
          companionId: selectedCompanionId ?? undefined,
        },
      });
      setShots((prev) => [
        ...res.images.map((img: { id?: string; url: string }) => ({
          id: img.id,
          url: img.url,
          prompt: p,
          reference,
        })),
        ...prev,
      ]);
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
          let dbId = undefined;
          if (selectedCompanionId) {
            try {
              const addRes = await addMedia({
                data: {
                  companionId: selectedCompanionId,
                  mediaUrl: j.mediaUrl,
                },
              });
              dbId = addRes.id;
            } catch (err: any) {
              toast.error("Failed to save video to database: " + err.message);
            }
          }

          setShots((prev) =>
            prev.map((s) =>
              s.url === shot.url
                ? { ...s, clipUrl: j.mediaUrl, clipStatus: undefined, id: dbId || s.id }
                : s,
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

  // Throws so a batch can count real successes; the click handler below is what
  // turns a failure into a toast.
  async function saveShot(shot: Shot) {
    const url = shot.clipUrl ?? shot.url;
    const ext = shot.clipUrl ? "mp4" : url.split("?")[0].split(".").pop() || "jpg";
    await saveFile(url, `humancrush-${Date.now()}.${ext}`);
  }

  async function download(shot: Shot) {
    try {
      await saveShot(shot);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  }

  // Saving one at a time is the slow part of filling a page, so the whole set
  // downloads in sequence — parallel triggers get dropped by the browser.
  async function downloadAll() {
    if (!shots.length) return;
    setSaving(true);
    let ok = 0;
    for (const s of shots) {
      try {
        await saveShot(s);
        ok++;
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        /* keep going; one bad file shouldn't stop the batch */
      }
    }
    setSaving(false);
    if (ok === shots.length) toast.success(`Saved ${ok} file${ok === 1 ? "" : "s"}`);
    else if (ok === 0) toast.error("Nothing could be saved");
    else toast.warning(`Saved ${ok} of ${shots.length}`);
  }

  async function regenerate(shot: Shot) {
    setShots((prev) => prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: "regen" } : s)));
    try {
      const res: any = await generate({
        data: {
          prompt: shot.prompt || prompt || "same model",
          count: 1,
          referenceUrl: shot.reference ?? undefined,
          companionId: selectedCompanionId ?? undefined,
        },
      });
      const img = res.images?.[0];
      if (!img) throw new Error("No image returned");

      // Swap in place so the grid keeps its order while you iterate on one shot.
      setShots((prev) =>
        prev.map((s) =>
          s.url === shot.url && s.clipUrl === shot.clipUrl
            ? { id: img.id, url: img.url, prompt: shot.prompt, reference: shot.reference }
            : s,
        ),
      );

      // Replaced files are no longer referenced, so don't leave them in storage or db
      if (shot.id) {
        await deleteMedia({ data: { id: shot.id } }).catch(() => {});
      }
      if (shot.url) {
        removeShot({ data: { url: shot.url } }).catch(() => {});
      }
      if (shot.clipUrl) {
        removeShot({ data: { url: shot.clipUrl } }).catch(() => {});
      }
    } catch (e: any) {
      setShots((prev) => prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: undefined } : s)));
      toast.error(e?.message ?? "Regenerate failed");
    }
  }

  async function discard(shot: Shot) {
    setShots((prev) => prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: "delete" } : s)));
    try {
      if (shot.id) {
        await deleteMedia({ data: { id: shot.id } });
      }
      if (shot.url) {
        await removeShot({ data: { url: shot.url } }).catch(() => {});
      }
      if (shot.clipUrl) {
        await removeShot({ data: { url: shot.clipUrl } }).catch(() => {});
      }
      setShots((prev) => prev.filter((s) => !(s.url === shot.url && s.clipUrl === shot.clipUrl)));
      if (reference === shot.url) setReference(null);
      toast.success("Deleted successfully");
    } catch (e: any) {
      setShots((prev) => prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: undefined } : s)));
      toast.error(e?.message ?? "Delete failed");
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

        {/* Companion / persona selector */}
        <div className="mb-4 rounded-3xl border border-white/10 bg-white/5 p-4">
          <label className="mb-2 block text-xs font-semibold text-white/70">
            Select Model / Persona
          </label>
          <select
            value={selectedCompanionId ?? ""}
            onChange={(e) => handleCompanionChange(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/50"
          >
            <option value="">— No persona (freeform) —</option>
            {companions?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedCompanionId && (
            <p className="mt-2 text-[10px] text-primary/80">
              ✓ Images will be saved to this persona's gallery. Her face is locked as the reference.
            </p>
          )}
          {loadingShots && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading saved images…
            </div>
          )}
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

          <div className="mt-2.5 flex items-center justify-between gap-2 border-b border-white/5 pb-2.5">
            <p className="text-[10px] text-white/50">
              Tip: Describe clothing, setting, and lighting.
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleRefinePrompt}
              disabled={refiningPrompt || !prompt.trim()}
              className="min-h-9 rounded-full bg-white/10 text-xs hover:bg-white/15 border border-white/5"
            >
              {refiningPrompt ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Refining...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-3 w-3" /> Refine with AI
                </>
              )}
            </Button>
          </div>

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
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {(["all", "images", "videos"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setGalleryFilter(filter)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-medium capitalize transition-all ${
                    galleryFilter === filter
                      ? "bg-white/15 text-white"
                      : "text-white/60 hover:text-white/80"
                  }`}
                >
                  {filter === "all" ? "All Assets" : filter === "images" ? "Still Images" : "Video Clips"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 justify-between sm:justify-end">
              <p className="text-xs text-muted-foreground">
                {filteredShots.length} asset{filteredShots.length === 1 ? "" : "s"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 rounded-full"
                disabled={saving}
                onClick={downloadAll}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-3.5 w-3.5" /> Download all
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {filteredShots.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {filteredShots.map((s) => (
              <div
                key={s.url}
                className="overflow-hidden rounded-2xl border border-white/10 bg-card flex flex-col justify-between"
              >
                <div>
                  {s.clipUrl ? (
                    <video src={s.clipUrl} controls loop playsInline className="w-full animate-fade-in" />
                  ) : (
                    <img src={s.url} alt="" className="aspect-[2/3] w-full object-cover" />
                  )}
                </div>

                <div className="flex flex-col">
                  {animatingShotUrl === s.url && (
                    <div className="border-t border-white/10 bg-white/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold text-primary">Animate Still Image</p>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleRefineMotion}
                          disabled={refiningMotion || !motionPrompt.trim()}
                          className="h-6 px-1.5 text-[9px] text-primary/85 hover:text-primary hover:bg-white/5"
                        >
                          {refiningMotion ? "Refining..." : "AI Refine"}
                        </Button>
                      </div>
                      <textarea
                        value={motionPrompt}
                        onChange={(e) => setMotionPrompt(e.target.value)}
                        rows={2}
                        placeholder="Describe motion — e.g. smiling and waving at camera"
                        className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-2 text-[11px] outline-none placeholder:text-white/30"
                      />
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] text-white/55">Duration:</span>
                        <select
                          value={motionSeconds}
                          onChange={(e) => setMotionSeconds(Number(e.target.value))}
                          className="h-7 rounded bg-black/40 border border-white/10 text-[9px] text-white outline-none px-1"
                        >
                          {[3, 4, 5, 6, 7, 8, 9, 10].map((sec) => (
                            <option key={sec} value={sec}>{sec}s</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <Button
                          size="sm"
                          className="h-8 flex-1 text-[10px] bg-grad-primary text-primary-foreground"
                          disabled={s.clipStatus === "running"}
                          onClick={async () => {
                            const targetShot = s;
                            setAnimatingShotUrl(null);
                            setShots((prev) => prev.map((item) => (item.url === targetShot.url ? { ...item, clipStatus: "running" } : item)));
                            try {
                              const res: any = await makeClip({ data: { imageUrl: targetShot.url, prompt: motionPrompt, seconds: motionSeconds } });
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
                                    prev.map((item) =>
                                      item.url === targetShot.url ? { ...item, clipUrl: j.mediaUrl, clipStatus: undefined } : item,
                                    ),
                                  );
                                  return;
                                }
                                if (j?.status === "failed") break;
                              }
                              throw new Error("Clip failed");
                            } catch (e: any) {
                              setShots((prev) =>
                                prev.map((item) => (item.url === targetShot.url ? { ...item, clipStatus: "failed" } : item)),
                              );
                              toast.error(e?.message ?? "Clip failed");
                            }
                          }}
                        >
                          Create Video
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-[10px] text-white/70 hover:text-white"
                          onClick={() => setAnimatingShotUrl(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1 p-2 border-t border-white/5">
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
                    {!s.clipUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 flex-1 text-[11px]"
                        disabled={s.clipStatus === "running"}
                        onClick={() => {
                          if (animatingShotUrl === s.url) {
                            setAnimatingShotUrl(null);
                          } else {
                            setAnimatingShotUrl(s.url);
                            setMotionPrompt("she shifts her weight, natural head movement, hair moves slightly, subtle lifelike motion");
                          }
                        }}
                      >
                        {s.clipStatus === "running" ? (
                          <>
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Animating...
                          </>
                        ) : (
                          <>
                            <Film className="mr-1 h-3.5 w-3.5" /> Animate
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 text-[11px]"
                      title="Download this file"
                      onClick={() => download(s)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 text-[11px]"
                      title="Regenerate with the same brief"
                      disabled={!!s.busy}
                      onClick={() => regenerate(s)}
                    >
                      {s.busy === "regen" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 text-[11px] text-red-400 hover:text-red-300"
                      title="Delete this shot"
                      disabled={!!s.busy}
                      onClick={() => discard(s)}
                    >
                      {s.busy === "delete" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
