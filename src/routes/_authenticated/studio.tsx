import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { amIAdmin, adminAddCompanionMedia, adminDeleteCompanionMedia } from "@/lib/admin.functions";
import { studioGenerate, studioClip, studioDelete, refineStudioPrompt } from "@/lib/studio.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Sparkles,
  Film,
  Download,
  Link2,
  Loader2,
  Trash2,
  RefreshCw,
  Crop,
  Check,
  ChevronDown,
  Layers,
  Eye,
  SlidersHorizontal,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  STUDIO_SIZES,
  StudioSize,
  FocalPoint,
  getStudioSizeById,
  saveCroppedFile,
  CORE_AD_PACK,
  DEFAULT_STUDIO_SIZE_ID,
} from "@/lib/studio-sizes";

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

type Shot = {
  id?: string;
  url: string;
  clipUrl?: string;
  clipStatus?: "running" | "failed";
  prompt: string;
  reference?: string | null;
  aspectRatio?: string;
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
  const [reference, setReference] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Size and cropping configuration
  const [selectedSizeId, setSelectedSizeId] = useState<string>(DEFAULT_STUDIO_SIZE_ID);
  const [focalPoint, setFocalPoint] = useState<FocalPoint>("face");
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [sizeTab, setSizeTab] = useState<"social" | "banner">("social");
  const [previewCropped, setPreviewCropped] = useState(false);
  const [adjustShot, setAdjustShot] = useState<Shot | null>(null);
  const [adjustSizeId, setAdjustSizeId] = useState<string>(DEFAULT_STUDIO_SIZE_ID);
  const [adjustFocal, setAdjustFocal] = useState<FocalPoint>("face");

  const selectedSize = getStudioSizeById(selectedSizeId);

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
          aspectRatio: selectedSize.nativeRatio,
        },
      });
      setShots((prev) => [
        ...res.images.map((img: { id?: string; url: string }) => ({
          id: img.id,
          url: img.url,
          prompt: p,
          reference,
          aspectRatio: selectedSize.nativeRatio,
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

  // Export single shot with target size specification
  async function downloadShot(shot: Shot, customSize?: StudioSize, customFocal?: FocalPoint) {
    const targetSize = customSize ?? selectedSize;
    const targetFocal = customFocal ?? focalPoint;
    const url = shot.clipUrl ?? shot.url;
    const ext = shot.clipUrl ? "mp4" : "jpg";
    const filename = `humancrush-${targetSize.id}-${Date.now()}.${ext}`;

    try {
      if (!shot.clipUrl && targetSize.w && targetSize.h) {
        await saveCroppedFile({
          url,
          filename,
          targetWidth: targetSize.w,
          targetHeight: targetSize.h,
          focalPoint: targetFocal,
        });
      } else {
        await saveCroppedFile({
          url,
          filename,
        });
      }
      toast.success(`Downloaded ${targetSize.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  }

  // Download raw uncropped source file
  async function downloadOriginal(shot: Shot) {
    const url = shot.clipUrl ?? shot.url;
    const ext = shot.clipUrl ? "mp4" : "jpg";
    try {
      await saveCroppedFile({
        url,
        filename: `humancrush-original-${Date.now()}.${ext}`,
      });
      toast.success("Downloaded original full-resolution image");
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  }

  // Batch export the 6 core standard ad sizes for a single shot
  async function exportCoreAdPack(shot: Shot) {
    if (shot.clipUrl) {
      await downloadOriginal(shot);
      return;
    }
    toast.info("Exporting core ad bundle (6 formats)…");
    let count = 0;
    for (const sizeId of CORE_AD_PACK) {
      const sizeDef = getStudioSizeById(sizeId);
      try {
        await saveCroppedFile({
          url: shot.url,
          filename: `humancrush-${sizeDef.id}-${Date.now()}.jpg`,
          targetWidth: sizeDef.w,
          targetHeight: sizeDef.h,
          focalPoint,
        });
        count++;
        await new Promise((r) => setTimeout(r, 450));
      } catch {
        /* continue batch */
      }
    }
    toast.success(`Successfully exported ${count} ad formats!`);
  }

  // Batch download all visible shots
  async function downloadAll(asOriginal = false) {
    if (!shots.length) return;
    setSaving(true);
    let ok = 0;
    for (const s of shots) {
      try {
        if (asOriginal || s.clipUrl || !selectedSize.w || !selectedSize.h) {
          await downloadOriginal(s);
        } else {
          await downloadShot(s, selectedSize, focalPoint);
        }
        ok++;
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        /* keep going */
      }
    }
    setSaving(false);
    if (ok === shots.length) toast.success(`Saved all ${ok} files`);
    else if (ok === 0) toast.error("Nothing could be saved");
    else toast.warning(`Saved ${ok} of ${shots.length}`);
  }

  async function regenerate(shot: Shot) {
    setShots((prev) =>
      prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: "regen" } : s)),
    );
    try {
      const res: any = await generate({
        data: {
          prompt: shot.prompt || prompt || "same model",
          count: 1,
          referenceUrl: shot.reference ?? undefined,
          companionId: selectedCompanionId ?? undefined,
          aspectRatio: shot.aspectRatio ?? selectedSize.nativeRatio,
        },
      });
      const img = res.images?.[0];
      if (!img) throw new Error("No image returned");

      setShots((prev) =>
        prev.map((s) =>
          s.url === shot.url && s.clipUrl === shot.clipUrl
            ? {
                id: img.id,
                url: img.url,
                prompt: shot.prompt,
                reference: shot.reference,
                aspectRatio: shot.aspectRatio ?? selectedSize.nativeRatio,
              }
            : s,
        ),
      );

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
      setShots((prev) =>
        prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: undefined } : s)),
      );
      toast.error(e?.message ?? "Regenerate failed");
    }
  }

  async function discard(shot: Shot) {
    setShots((prev) =>
      prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: "delete" } : s)),
    );
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
      setShots((prev) =>
        prev.map((s) => (s.url === shot.url && s.clipUrl === shot.clipUrl ? { ...s, busy: undefined } : s)),
      );
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

  // Focal alignment class for CSS object position preview
  const focalAlignClass =
    focalPoint === "face" ? "object-top" : focalPoint === "bottom" ? "object-bottom" : "object-center";

  return (
    <div className="min-h-dvh pb-28">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <div className="mb-5 flex items-center gap-3">
          <Link to="/admin" className="rounded-full p-2 hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Promo Studio</h1>
            <p className="text-xs text-muted-foreground">
              High-converting promo assets, social formats, and ad banners for funnels.
            </p>
          </div>
        </div>

        {/* Companion / Persona Selector Card */}
        <div className="mb-4 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-md">
          <label className="mb-2 block text-xs font-semibold text-white/80">
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
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-primary/90">
              <Check className="h-3.5 w-3.5" /> Images will be saved to this persona's gallery. Her face is locked as the reference.
            </p>
          )}
          {loadingShots && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading saved images…
            </div>
          )}
        </div>

        {/* Aspect Ratio, Dimensions & Ad Presets System */}
        <div className="mb-4 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-md">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-white/90">
                  Aspect Ratio & Output Size
                </span>
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {selectedSize.dimensions}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-white/55">
                Generates at native proportion and delivers pixel-perfect banner dimensions.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAllSizes(!showAllSizes)}
              className="h-8 rounded-full border-white/10 bg-white/5 text-[11px] text-white/80 hover:bg-white/10"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 text-primary" />
              {showAllSizes ? "Hide Size Catalog" : "Explore All Sizes (18 Formats)"}
            </Button>
          </div>

          {/* Quick Popular Presets Selector Bar */}
          <div className="flex flex-wrap gap-1.5 pb-2">
            {STUDIO_SIZES.filter((s) => s.isPopular).map((size) => {
              const isActive = selectedSizeId === size.id;
              return (
                <button
                  key={size.id}
                  type="button"
                  onClick={() => setSelectedSizeId(size.id)}
                  className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all ${
                    isActive
                      ? "border-primary/70 bg-primary/20 text-white shadow-sm ring-1 ring-primary/40"
                      : "border-white/10 bg-black/30 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      isActive ? "bg-primary" : "bg-white/30 group-hover:bg-white/50"
                    }`}
                  />
                  <span>{size.name.split("(")[0].trim()}</span>
                  <span className="text-[10px] opacity-60">
                    {size.category === "banner" ? size.dimensions.replace(" ", "") : size.ratioLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Expanded Full Dimension Presets Catalog */}
          {showAllSizes && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-3.5 animate-in fade-in slide-in-from-top-2">
              <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSizeTab("social")}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                      sizeTab === "social"
                        ? "bg-white/15 text-white"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    📱 Social & Mobile Formats
                  </button>
                  <button
                    type="button"
                    onClick={() => setSizeTab("banner")}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                      sizeTab === "banner"
                        ? "bg-white/15 text-white"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    📐 Display & Ad Banners (IAB)
                  </button>
                </div>
                <span className="text-[10px] text-white/40">
                  {STUDIO_SIZES.filter((s) => s.category === sizeTab).length} Presets Available
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {STUDIO_SIZES.filter((s) => s.category === sizeTab).map((size) => {
                  const isActive = selectedSizeId === size.id;
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => setSelectedSizeId(size.id)}
                      className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition-all ${
                        isActive
                          ? "border-primary/70 bg-primary/15 text-white ring-1 ring-primary/40"
                          : "border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <span className="font-semibold text-xs text-white">{size.name}</span>
                        {size.badge && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "bg-white/10 text-white/70"
                            }`}
                          >
                            {size.badge}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-white/60">
                        <span className="font-mono text-primary/90">{size.dimensions} px</span>
                        <span>•</span>
                        <span>Ratio {size.ratioLabel}</span>
                      </div>
                      <p className="mt-1 text-[10px] leading-tight text-white/50">
                        {size.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active Size Details & Smart Focal Crop Control */}
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {/* Dynamic Aspect Ratio Wireframe Preview Box */}
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <div
                  className={`border border-primary/70 bg-primary/20 ${selectedSize.aspectClass} max-h-8 max-w-8`}
                  style={{
                    width: selectedSize.w && selectedSize.h && selectedSize.w > selectedSize.h ? "28px" : "18px",
                    height: selectedSize.w && selectedSize.h && selectedSize.h > selectedSize.w ? "28px" : "18px",
                  }}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-white">{selectedSize.name}</h4>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
                    {selectedSize.dimensions} px
                  </span>
                </div>
                <p className="text-[11px] text-white/60">
                  {selectedSize.description} • Native generation ratio:{" "}
                  <span className="font-medium text-primary">{selectedSize.nativeRatio}</span>
                </p>
              </div>
            </div>

            {/* Focal Point Framing Selector */}
            <div className="flex items-center gap-2 border-t border-white/10 pt-2 sm:border-t-0 sm:pt-0">
              <span className="shrink-0 text-[11px] text-white/60">Focal Bias:</span>
              <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5">
                {(
                  [
                    { id: "face", label: "Face / Top" },
                    { id: "center", label: "Center" },
                    { id: "bottom", label: "Bottom" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFocalPoint(f.id)}
                    className={`rounded px-2 py-1 text-[10px] font-medium transition-all ${
                      focalPoint === f.id
                        ? "bg-primary text-primary-foreground"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Prompt Input Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-md">
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
              className="min-h-9 rounded-full border border-white/5 bg-white/10 text-xs hover:bg-white/15"
            >
              {refiningPrompt ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Refining...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-3 w-3 text-primary" /> Refine with AI
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
                className="min-h-10 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/75 hover:bg-white/10"
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
                  <Sparkles className="mr-2 h-4 w-4" /> Generate {count} ({selectedSize.dimensions})
                </>
              )}
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Each image is billed by xAI. Clothed promo assets for marketing funnels and socials.
          </p>
        </div>

        {/* Gallery Section */}
        {shots.length > 0 && (
          <div className="mt-7 space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Media Filter Tabs */}
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
                {(["all", "images", "videos"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setGalleryFilter(filter)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-medium capitalize transition-all ${
                      galleryFilter === filter
                        ? "bg-white/20 text-white shadow-sm"
                        : "text-white/60 hover:text-white/80"
                    }`}
                  >
                    {filter === "all" ? "All Assets" : filter === "images" ? "Still Images" : "Video Clips"}
                  </button>
                ))}
              </div>

              {/* View Mode & Batch Downloads */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Toggle Preview as Cropped vs Original */}
                <button
                  type="button"
                  onClick={() => setPreviewCropped(!previewCropped)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all ${
                    previewCropped
                      ? "border-primary/60 bg-primary/20 text-white"
                      : "border-white/10 bg-black/30 text-white/70 hover:bg-white/10"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5 text-primary" />
                  <span>
                    {previewCropped
                      ? `Cropped: ${selectedSize.dimensions}`
                      : "Preview as Cropped Banner"}
                  </span>
                </button>

                {/* Batch Download Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-9 rounded-full border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving…
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-3.5 w-3.5" /> Download All
                          <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
                        </>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 border-white/10 bg-card text-white">
                    <DropdownMenuLabel className="text-xs text-white/60">Batch Export</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => downloadAll(false)}
                      className="cursor-pointer text-xs focus:bg-white/10"
                    >
                      <Crop className="mr-2 h-3.5 w-3.5 text-primary" />
                      Save as {selectedSize.name} ({selectedSize.dimensions})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => downloadAll(true)}
                      className="cursor-pointer text-xs focus:bg-white/10"
                    >
                      <Download className="mr-2 h-3.5 w-3.5 text-white/70" />
                      Save Uncropped Originals
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Gallery Grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {filteredShots.map((s) => (
                <div
                  key={s.url}
                  className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-card transition-all hover:border-white/20"
                >
                  <div className="relative overflow-hidden bg-black/40">
                    {s.clipUrl ? (
                      <video src={s.clipUrl} controls loop playsInline className="w-full animate-fade-in" />
                    ) : (
                      <div
                        className={`w-full overflow-hidden transition-all ${
                          previewCropped ? selectedSize.aspectClass : "aspect-[2/3]"
                        }`}
                      >
                        <img
                          src={s.url}
                          alt=""
                          className={`h-full w-full object-cover transition-all duration-300 ${
                            previewCropped ? focalAlignClass : "object-center"
                          }`}
                        />
                      </div>
                    )}

                    {/* Overlay badge for preview mode */}
                    {previewCropped && !s.clipUrl && (
                      <div className="absolute top-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-[9px] font-mono text-white/90 backdrop-blur-md">
                        {selectedSize.dimensions}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col">
                    {animatingShotUrl === s.url && (
                      <div className="space-y-2 border-t border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold text-primary">Animate Still Image</p>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleRefineMotion}
                            disabled={refiningMotion || !motionPrompt.trim()}
                            className="h-6 px-1.5 text-[9px] text-primary/85 hover:bg-white/5 hover:text-primary"
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
                            className="h-7 rounded border border-white/10 bg-black/40 px-1 text-[9px] text-white outline-none"
                          >
                            {[3, 4, 5, 6, 7, 8, 9, 10].map((sec) => (
                              <option key={sec} value={sec}>
                                {sec}s
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-1.5 pt-1">
                          <Button
                            size="sm"
                            className="h-8 flex-1 bg-grad-primary text-[10px] text-primary-foreground"
                            disabled={s.clipStatus === "running"}
                            onClick={async () => {
                              const targetShot = s;
                              setAnimatingShotUrl(null);
                              setShots((prev) =>
                                prev.map((item) =>
                                  item.url === targetShot.url ? { ...item, clipStatus: "running" } : item,
                                ),
                              );
                              try {
                                const res: any = await makeClip({
                                  data: {
                                    imageUrl: targetShot.url,
                                    prompt: motionPrompt,
                                    seconds: motionSeconds,
                                  },
                                });
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
                                        item.url === targetShot.url
                                          ? { ...item, clipUrl: j.mediaUrl, clipStatus: undefined }
                                          : item,
                                      ),
                                    );
                                    return;
                                  }
                                  if (j?.status === "failed") break;
                                }
                                throw new Error("Clip failed");
                              } catch (e: any) {
                                setShots((prev) =>
                                  prev.map((item) =>
                                    item.url === targetShot.url ? { ...item, clipStatus: "failed" } : item,
                                  ),
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

                    {/* Action Bar for Shot */}
                    <div className="flex flex-wrap items-center justify-between gap-1 border-t border-white/5 p-2">
                      <div className="flex flex-1 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-9 px-2 text-[11px]"
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
                            className="min-h-9 px-2 text-[11px]"
                            disabled={s.clipStatus === "running"}
                            onClick={() => {
                              if (animatingShotUrl === s.url) {
                                setAnimatingShotUrl(null);
                              } else {
                                setAnimatingShotUrl(s.url);
                                setMotionPrompt(
                                  "she shifts her weight, natural head movement, hair moves slightly, subtle lifelike motion",
                                );
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
                      </div>

                      <div className="flex items-center gap-0.5">
                        {/* Adjust & Fine-tune crop dialog */}
                        {!s.clipUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-9 w-9 p-0 text-[11px]"
                            title="Crop & Fine-Tune Framing"
                            onClick={() => {
                              setAdjustShot(s);
                              setAdjustSizeId(selectedSizeId);
                              setAdjustFocal(focalPoint);
                            }}
                          >
                            <Crop className="h-3.5 w-3.5 text-primary" />
                          </Button>
                        )}

                        {/* Export & Download Menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="min-h-9 w-9 p-0 text-[11px]"
                              title="Download options"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 border-white/10 bg-card text-white">
                            <DropdownMenuLabel className="text-xs text-white/60">
                              Export Dimensions
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => downloadShot(s)}
                              className="cursor-pointer text-xs font-semibold focus:bg-white/10"
                            >
                              <Crop className="mr-2 h-3.5 w-3.5 text-primary" />
                              {selectedSize.name} ({selectedSize.dimensions})
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => downloadOriginal(s)}
                              className="cursor-pointer text-xs focus:bg-white/10"
                            >
                              <Download className="mr-2 h-3.5 w-3.5 text-white/60" />
                              Full Resolution Original
                            </DropdownMenuItem>

                            {!s.clipUrl && (
                              <>
                                <DropdownMenuSeparator className="bg-white/10" />
                                <DropdownMenuItem
                                  onClick={() => exportCoreAdPack(s)}
                                  className="cursor-pointer text-xs text-primary focus:bg-white/10"
                                >
                                  <Package className="mr-2 h-3.5 w-3.5 text-primary" />
                                  1-Click Core Ad Pack (6 Formats)
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-white/10" />
                                <DropdownMenuItem
                                  onClick={() => downloadShot(s, getStudioSizeById("9:16"))}
                                  className="cursor-pointer text-xs focus:bg-white/10"
                                >
                                  📱 Story / Reels (1080 × 1920)
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => downloadShot(s, getStudioSizeById("300x250"))}
                                  className="cursor-pointer text-xs focus:bg-white/10"
                                >
                                  📊 Medium Rectangle (300 × 250)
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => downloadShot(s, getStudioSizeById("970x250"))}
                                  className="cursor-pointer text-xs focus:bg-white/10"
                                >
                                  🏆 Billboard Banner (970 × 250)
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => downloadShot(s, getStudioSizeById("305x99"))}
                                  className="cursor-pointer text-xs focus:bg-white/10"
                                >
                                  🔥 TrafficJunky / Exo (305 × 99)
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Regenerate Button */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-9 w-9 p-0 text-[11px]"
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

                        {/* Delete Button */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-9 w-9 p-0 text-[11px] text-red-400 hover:text-red-300"
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modal: Interactive Crop, Focal Framing, & Export Dialog */}
        <Dialog open={!!adjustShot} onOpenChange={(open) => !open && setAdjustShot(null)}>
          <DialogContent className="max-w-xl border-white/10 bg-card text-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Crop className="h-4 w-4 text-primary" /> Crop & Dimension Calibration
              </DialogTitle>
              <DialogDescription className="text-xs text-white/60">
                Preview exact banner crop framing and adjust the model's focal anchor.
              </DialogDescription>
            </DialogHeader>

            {adjustShot && (
              <div className="space-y-4 pt-2">
                {/* Live Preview Container */}
                {(() => {
                  const targetSize = getStudioSizeById(adjustSizeId);
                  const focalClass =
                    adjustFocal === "face"
                      ? "object-top"
                      : adjustFocal === "bottom"
                        ? "object-bottom"
                        : "object-center";
                  return (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/60 p-4">
                      <div className={`w-full overflow-hidden rounded-lg border border-primary/40 ${targetSize.aspectClass}`}>
                        <img
                          src={adjustShot.url}
                          alt="Crop preview"
                          className={`h-full w-full object-cover transition-all ${focalClass}`}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between w-full text-[11px] text-white/60">
                        <span className="font-semibold text-white">{targetSize.name}</span>
                        <span className="font-mono text-primary">{targetSize.dimensions} px</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Preset Dimension Selector */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/70">
                    Select Target Banner / Format
                  </label>
                  <select
                    value={adjustSizeId}
                    onChange={(e) => setAdjustSizeId(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-primary/50"
                  >
                    <optgroup label="Social & Mobile">
                      {STUDIO_SIZES.filter((s) => s.category === "social").map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.dimensions} px)
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Display & Ad Banners">
                      {STUDIO_SIZES.filter((s) => s.category === "banner").map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.dimensions} px)
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {/* Focal Point Framing */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/70">
                    Focal Anchor (Model Framing)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: "face", label: "Face / Top Focus", desc: "Preserves face in horizontal banners" },
                        { id: "center", label: "Center Focus", desc: "Default balanced vertical crop" },
                        { id: "bottom", label: "Bottom Focus", desc: "Focuses lower half of subject" },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setAdjustFocal(f.id)}
                        className={`flex flex-col items-start rounded-xl border p-2 text-left transition-all ${
                          adjustFocal === f.id
                            ? "border-primary bg-primary/20 text-white"
                            : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                        }`}
                      >
                        <span className="text-xs font-medium">{f.label}</span>
                        <span className="text-[9px] text-white/50">{f.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Modal Footer Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 bg-grad-primary text-primary-foreground shadow-glow"
                    onClick={async () => {
                      const target = getStudioSizeById(adjustSizeId);
                      await downloadShot(adjustShot, target, adjustFocal);
                      setAdjustShot(null);
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" /> Download ({getStudioSizeById(adjustSizeId).dimensions} px)
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/10"
                    onClick={() => setAdjustShot(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
