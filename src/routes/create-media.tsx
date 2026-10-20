import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { confirmAge } from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getEffectiveCompanionReel } from "@/lib/reels";

export const Route = createFileRoute("/create-media")({
  head: () => ({
    meta: [
      { title: "AI Creator Studio | HumanCrush" },
      {
        name: "description",
        content:
          "Create consistent AI model photos and short videos for social campaigns, Fanvue, and OnlyFans.",
      },
      { property: "og:title", content: "AI Creator Studio | HumanCrush" },
      {
        property: "og:description",
        content: "Create a consistent AI model, then turn each prompt into a campaign-ready image or video.",
      },
    ],
  }),
  component: Creator,
});

const CREATOR_PLAN_IDS = ["sub-creator", "sub-creator-annual"];
const sizes = {
  portrait: [768, 1024],
  square: [1024, 1024],
  landscape: [1024, 768],
} as const;

function Creator() {
  const navigate = useNavigate();
  const run = useServerFn(standaloneGenerate);
  const checkJob = useServerFn(checkMediaJob);
  const saveAge = useServerFn(confirmAge);
  const [models, setModels] = useState<any[]>([]);
  const [model, setModel] = useState("");
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [size, setSize] = useState<keyof typeof sizes>("portrait");
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<any>(null);
  const [library, setLibrary] = useState<any[]>([]);
  const [previewModel, setPreviewModel] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [creatorSubscription, setCreatorSubscription] = useState(false);
  const [contentMode, setContentMode] = useState<"social" | "adult">("social");
  const [ageAgreed, setAgeAgreed] = useState(false);

  const visibleModels = models.filter((item) =>
    item.name.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  );
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);

  async function loadLibrary() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setLibrary([]);
      return;
    }
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("title", "Creator render");
    const ids = (conversations ?? []).map((row: any) => row.id);
    if (!ids.length) {
      setLibrary([]);
      return;
    }
    const { data } = await supabase
      .from("media_jobs")
      .select("id,kind,status,media_url,prompt,created_at,error")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = data ?? [];
    const pending = rows.find((row: any) => ["pending", "processing"].includes(row.status));
    if (pending) setActiveJob(pending);
    setLibrary(rows.filter((row: any) => row.status === "completed" && row.media_url));
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data, error }, { data: auth }] = await Promise.all([
        supabase.from("companions").select("id,name,image_url,gender").order("sort_order"),
        supabase.auth.getUser(),
      ]);
      if (!active) return;
      if (error) setLoadError("Models could not be loaded. Refresh and try again.");
      setModels(data ?? []);
      const requested = new URLSearchParams(window.location.search).get("model");
      if (data?.[0]) setModel(requested && data.some((item: any) => item.id === requested) ? requested : data[0].id);
      if (auth.user) {
        const [{ data: unlockRows }, { data: role }, { data: profile }] = await Promise.all([
          (supabase as any).from("creator_model_unlocks").select("companion_id").eq("user_id", auth.user.id),
          supabase.rpc("has_role", { _user_id: auth.user.id, _role: "admin" }),
          supabase
            .from("profiles")
            .select("age_confirmed,subscription_tier,subscription_status")
            .eq("id", auth.user.id)
            .maybeSingle(),
        ]);
        if (!active) return;
        setUnlocked((unlockRows ?? []).map((row: any) => row.companion_id));
        setIsAdmin(!!role);
        setAgeAgreed(!!profile?.age_confirmed);
        setCreatorSubscription(
          profile?.subscription_status === "active" && CREATOR_PLAN_IDS.includes(profile.subscription_tier ?? ""),
        );
      }
      setLoading(false);
    })().catch(() => {
      if (active) {
        setLoadError("Models could not be loaded. Refresh and try again.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "adult") setContentMode("adult");
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, []);

  useEffect(() => {
    if (!activeJob || ["completed", "failed"].includes(activeJob.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const result: any = await checkJob({ data: { jobId: activeJob.id } });
        setActiveJob((old: any) => ({ ...old, ...result }));
        if (["completed", "failed"].includes(result.status)) {
          await loadLibrary();
          if (result.status === "completed") toast.success("Your render is ready.");
        }
      } catch {
        // Polling is intentionally retryable; the job itself remains on screen.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  async function submit() {
    if (contentMode === "adult") {
      if (!ageAgreed) {
        toast.error("Confirm that you are 18 or older to use adult mode.");
        return;
      }
      if (!isAdmin && !creatorSubscription) {
        navigate({ to: "/credits", search: { plan: "creator", returnTo: "/create-media" } as never });
        return;
      }
    }
    const selectedModel = model || models[0]?.id;
    if (!selectedModel) return toast.error("Models are still loading.");
    if (prompt.trim().length < 3) return toast.error("Describe the render.");
    setBusy(true);
    try {
      const [width, height] = sizes[size];
      const result = await run({
        data: { companionId: selectedModel, prompt, kind, seconds, width, height, adult: contentMode === "adult" },
      });
      setActiveJob({ id: result.jobId, kind, status: "pending" });
      toast.success(`Generation started (${result.cost} credits)`);
      setPrompt("");
    } catch (error: any) {
      const message = String(error?.message ?? error);
      if (message.includes("AGE_CONFIRMATION_REQUIRED")) {
        toast.error("Confirm your age before using adult mode.");
        return;
      }
      if (message.includes("CREATOR_SUBSCRIPTION_REQUIRED") || message.includes("OUT_OF_CREDITS") || message.includes("Unlock this model")) {
        navigate({ to: "/credits", search: { returnTo: "/create-media" } as never });
        return;
      }
      toast.error(message || "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function agreeToAdultMode() {
    setAgeAgreed(true);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      navigate({ to: "/auth", search: { redirect: "/create-media?mode=adult" } as never });
      return;
    }
    try {
      await saveAge();
    } catch {
      toast.error("Sign in again before enabling adult mode.");
      setAgeAgreed(false);
    }
  }

  async function downloadMedia(item: any) {
    try {
      const response = await fetch(item.media_url);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `humancrush-${item.kind}-${item.id}.${item.kind === "video" ? "mp4" : "png"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(item.media_url, "_blank", "noopener,noreferrer");
    }
  }

  const jobCard = activeJob && (
    <section className="rounded-2xl border border-white/10 bg-[#191919] p-4 shadow-xl sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold">
          {activeJob.status === "completed" ? "Your render is ready" : activeJob.status === "failed" ? "Render failed" : "Creating your media…"}
        </h2>
        <span className="text-xs uppercase tracking-widest text-white/50">{activeJob.kind}</span>
      </div>
      {!['completed', 'failed'].includes(activeJob.status) && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-white/80" />
        </div>
      )}
      {activeJob.error && <p className="mt-2 text-sm text-red-200">{activeJob.error}</p>}
      {activeJob.mediaUrl && (
        activeJob.kind === "video" ? (
          <video controls className="mt-4 max-h-[32rem] w-full rounded-xl bg-black" src={activeJob.mediaUrl} />
        ) : (
          <img className="mt-4 max-h-[32rem] w-full rounded-xl object-contain" src={activeJob.mediaUrl} alt="Generated render" />
        )
      )}
    </section>
  );

  return (
    <main className="creator-page min-h-screen bg-[#0e0e0e] px-4 py-5 text-white sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <button type="button" onClick={() => navigate({ to: "/create" })} className="mb-2 text-xs text-white/50 hover:text-white">
              ← Back to model builder
            </button>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/45">Creator studio</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-5xl">Make the scene yours.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55 sm:text-base">
              Keep one identity consistent while you create campaign-ready photos and short videos for social, Fanvue, or OnlyFans.
            </p>
          </div>
          <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs text-white/65">Pay per render</span>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <div className="rounded-2xl border border-white/10 bg-[#181818] p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/45">Content mode</p>
                <p className="mt-1 text-sm text-white/65">Choose the audience before you generate.</p>
              </div>
              <div className="inline-flex rounded-full border border-white/15 bg-black/30 p-1">
                {(["social", "adult"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setContentMode(value)}
                    className={`rounded-full px-4 py-2 text-xs font-bold transition ${contentMode === value ? "bg-white text-black" : "text-white/55 hover:text-white"}`}
                  >
                    {value === "social" ? "Social" : "18+"}
                  </button>
                ))}
              </div>
            </div>
            {contentMode === "adult" && (
              <div className="mt-4 rounded-xl border border-white/15 bg-black/25 p-4">
                <label className="flex items-start gap-3 text-sm text-white/75">
                  <input type="checkbox" checked={ageAgreed} onChange={(event) => event.target.checked ? void agreeToAdultMode() : setAgeAgreed(false)} className="mt-1 h-4 w-4 accent-white" />
                  <span>I confirm that I am 18 or older and understand adult renders require the Creator plan.</span>
                </label>
                {!creatorSubscription && !isAdmin && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => navigate({ to: "/credits", search: { plan: "creator", returnTo: "/create-media" } as never })} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Creator · $79/month</button><button type="button" onClick={() => navigate({ to: "/credits", search: { plan: "creator-annual", returnTo: "/create-media" } as never })} className="rounded-full border border-white/25 px-4 py-2 text-xs font-bold text-white/80 hover:bg-white/10">Annual · $699/year</button></div>}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#181818] p-4 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/45">Built for creators</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">Create a consistent fictional model, then publish the finished library across your social channels and subscription pages.</p>
            <a href="/done-for-you" className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/85">Need the business built for you?</a>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-white/10 bg-[#181818] p-4 shadow-2xl sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/45">Custom prompt</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">Describe the exact moment.</h2>
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-full border border-white/15 bg-black/30 p-1 text-xs font-bold">
              <button type="button" onClick={() => setKind("image")} className={`rounded-full px-5 py-2 ${kind === "image" ? "bg-white text-black" : "text-white/55"}`}>Photo · 8 credits</button>
              <button type="button" onClick={() => setKind("video")} className={`rounded-full px-5 py-2 ${kind === "video" ? "bg-white text-black" : "text-white/55"}`}>Video · from 10</button>
            </div>
          </div>

          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="e.g. a rooftop portrait at golden hour, wearing a cream linen shirt" className="mt-5 min-h-32 w-full rounded-xl border border-white/15 bg-black/30 p-4 text-sm outline-none placeholder:text-white/30 focus:border-white/50" />

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Frame size</p>
              <div className="mt-2 flex flex-wrap gap-2">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key as keyof typeof sizes)} className={`rounded-full border px-3 py-2 text-xs font-semibold capitalize ${size === key ? "border-white bg-white text-black" : "border-white/15 text-white/55 hover:border-white/40"}`}>{key} · {width}×{height}</button>)}</div>
            </div>
            {kind === "video" && <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Duration</p><div className="mt-2 flex flex-wrap gap-2">{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${seconds === value ? "border-white bg-white text-black" : "border-white/15 text-white/55 hover:border-white/40"}`}>{value}s</button>)}</div></div>}
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Identity lock</p><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" className="w-full rounded-full border border-white/15 bg-black/25 px-3 py-2 text-xs outline-none sm:w-48" /></div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">{visibleModels.map((item) => <button type="button" key={item.id} onClick={() => { setPreviewModel(item); setModel(item.id); }} className={`flex shrink-0 items-center gap-2 rounded-full border px-2 py-1.5 text-left ${model === item.id ? "border-white bg-white/10" : "border-white/15 bg-black/20"}`}><img src={item.image_url} alt="" className="h-8 w-8 rounded-full object-cover" /><span className="text-xs font-semibold">{item.name}</span><small className="text-[10px] text-white/45">{isAdmin || models[0]?.id === item.id || unlocked.includes(item.id) ? "Ready" : "50 credits"}</small></button>)}</div>
            {loadError && <p className="mt-2 text-sm text-red-200">{loadError}</p>}
          </div>
          <Button disabled={busy || loading || !model} onClick={submit} className="mt-5 w-full rounded-full bg-white text-black hover:bg-white/85">{busy ? "Starting render…" : `Generate · ${cost} credits`}</Button>
        </section>

        {jobCard}

        <section className="mt-5 rounded-2xl border border-white/10 bg-[#181818] p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-white/45">Your library</p><h2 className="mt-1 text-xl font-black">Saved renders</h2></div><button type="button" onClick={() => void loadLibrary()} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/65 hover:border-white/40">Refresh</button></div>
          {library.length === 0 ? <p className="mt-5 text-sm text-white/45">Completed creator images and videos will appear here.</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{library.map((item) => <article key={item.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/25">{item.kind === "video" ? <video controls className="aspect-[3/4] w-full object-cover" src={item.media_url} /> : <img className="aspect-[3/4] w-full object-cover" src={item.media_url} alt="Saved render" />}<button type="button" onClick={() => void downloadMedia(item)} className="m-3 w-[calc(100%-1.5rem)] rounded-full border border-white/20 px-3 py-2 text-xs font-bold text-white/80 hover:bg-white hover:text-black">Download {item.kind}</button></article>)}</div>}
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-[#181818] p-5"><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">01 · Build</p><h2 className="mt-2 text-lg font-black">Create one consistent AI model.</h2><p className="mt-2 text-sm leading-relaxed text-white/60">Use the identity lock to keep her face, hair, and visual direction consistent across every render.</p></article>
          <article className="rounded-2xl border border-white/10 bg-[#181818] p-5"><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">02 · Publish</p><h2 className="mt-2 text-lg font-black">Turn renders into a content library.</h2><p className="mt-2 text-sm leading-relaxed text-white/60">Download your assets for Instagram, TikTok, Fanvue, OnlyFans, and paid campaigns.</p></article>
          <article className="rounded-2xl border border-white/10 bg-[#181818] p-5"><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">03 · Done for you</p><h2 className="mt-2 text-lg font-black">CONTACT NOW TO HAVE US CREATE YOUR AI BUSINESS TODAY.</h2><p className="mt-2 text-sm leading-relaxed text-white/60">We can build the model identity, content library, website, and launch guidance around your plan.</p><div className="mt-4 flex flex-wrap gap-2"><a href="/done-for-you" className="inline-flex rounded-full bg-white px-4 py-2 text-xs font-bold text-black">See business setup</a><a href="mailto:lgtopseller@yahoo.com?subject=HumanCrush%20AI%20business%20setup&body=Hi%2C%20I%27d%20like%20to%20talk%20about%20having%20HumanCrush%20build%20my%20AI%20model%20business." className="inline-flex rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white/80 hover:bg-white/10">Contact now</a></div></article>
        </section>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-white/40">HumanCrush characters are fictional adults. 18+ mode requires age confirmation and an eligible plan. Results vary by prompt and generation provider; no request is guaranteed to render.</p>

        {previewModel && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-6" onClick={() => setPreviewModel(null)}><div className="relative w-[min(94vw,34rem)] overflow-hidden rounded-3xl border border-white/20 bg-[#222] shadow-2xl" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setPreviewModel(null)} className="absolute right-3 top-3 z-10 rounded-full bg-black/65 px-3 py-2 text-xs font-semibold shadow-lg">Close</button><img src={previewModel.image_url} alt={previewModel.name} className="block aspect-[4/5] max-h-[76vh] w-full object-cover" style={{ objectPosition: "center 16%" }} /><div className="p-4"><h2 className="text-xl font-bold">{previewModel.name}</h2><p className="mt-1 text-sm text-white/60">{isAdmin || models[0]?.id === previewModel.id || unlocked.includes(previewModel.id) ? "Identity ready" : "Unlock this identity to keep the face consistent."}</p></div></div></div>}
      </div>
    </main>
  );
}
