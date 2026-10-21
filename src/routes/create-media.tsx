import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Bolt, Check, ChevronRight, Download, ImageIcon, LockKeyhole, Sparkles, Video, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { confirmAge } from "@/lib/payments.functions";
import { totalCredits } from "@/lib/credits";
import { toast } from "sonner";

const creatorSearchSchema = z.object({
  model: z.string().optional(),
  mode: z.enum(["social", "adult"]).optional(),
  prompt: z.string().optional(),
});

export const Route = createFileRoute("/create-media")({
  validateSearch: (search) => creatorSearchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Create | HumanCrush" },
      { name: "description", content: "Create consistent fictional adult model photos and short videos with HumanCrush." },
      { property: "og:title", content: "Create | HumanCrush" },
      { property: "og:description", content: "Describe the scene. Keep one identity consistent. Render a photo or short video." },
    ],
  }),
  component: Creator,
});

const CREATOR_PLAN_IDS = ["sub-creator", "sub-creator-annual"];
const RANDOM_IDENTITY = "__random_identity__";
const sizes = {
  portrait: [768, 1024],
  square: [1024, 1024],
  landscape: [1024, 768],
} as const;
const BOOK_CALL_SMS = "sms:7082537082?&body=Hi%2C%20I%27m%20interested%20in%20your%20done-for-you%20content%20creator%20program.%20Please%20tell%20me%20more%20and%20let%20me%20know%20how%20to%20schedule%20a%20call.";

type CreatorModel = { id: string; name: string; image_url: string; gender?: string | null };
type CreatorJob = {
  id: string;
  kind: "image" | "video" | "voice";
  status: "pending" | "processing" | "completed" | "failed";
  media_url: string | null;
  prompt: string;
  created_at: string;
  error: string | null;
};

const sceneIdeas = [
  { name: "Golden-hour rooftop", prompt: "A warm rooftop portrait at golden hour, relaxed smile, cream linen shirt." },
  { name: "Quiet bedroom", prompt: "A natural editorial portrait in a softly lit modern bedroom, morning light." },
  { name: "Coffee run", prompt: "A candid street-style photo outside a coffee shop, denim jacket and natural light." },
  { name: "Poolside afternoon", prompt: "A polished poolside portrait in an opaque one-piece swimsuit, bright summer light." },
  { name: "City night", prompt: "A cinematic evening portrait beside city lights, tailored black outfit, shallow depth of field." },
  { name: "Studio editorial", prompt: "A clean fashion editorial against a warm studio backdrop, confident posture." },
] as const;

function CreatorNav({ credits }: { credits: number | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#121014]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
        <Link to="/create-media" className="flex shrink-0 items-center gap-2 text-[#F5EFF2]" aria-label="HumanCrush creator studio">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#FF4D6A] text-[#1A0A0F]"><Sparkles className="h-4 w-4" /></span>
          <span className="hidden font-display text-lg font-extrabold tracking-tight sm:inline">HumanCrush</span>
        </Link>
        <nav aria-label="Creator studio" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link to="/create-media" className="rounded-full bg-white/[0.08] px-3 py-2 text-xs font-semibold text-white sm:px-4 sm:text-sm">Create</Link>
          <Link to="/library" className="rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white sm:px-4 sm:text-sm">Library</Link>
          <Link to="/models" className="rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white sm:px-4 sm:text-sm">Models</Link>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link to="/credits" className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/[0.12] px-3 text-xs font-semibold text-white sm:px-4 sm:text-sm">
            <Bolt className="h-4 w-4 text-[#FF4D6A]" />
            <span>{credits === null ? "--" : credits}</span><span className="hidden text-[#B3A9B0] sm:inline">credits</span>
          </Link>
          <Link to="/me" aria-label="Open account" className="grid h-10 w-10 place-items-center rounded-full bg-[#2E2730] text-sm font-bold text-white">G</Link>
        </div>
      </div>
    </header>
  );
}

function CreatorFooter() {
  return (
    <footer className="mx-auto mt-16 flex max-w-[1240px] flex-col gap-3 border-t border-white/[0.08] px-4 py-8 text-xs text-[#8E858C] sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p>All characters are fictional, AI-generated adults. Results vary by prompt and provider.</p>
      <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Policies">
        <Link to="/legal/$slug" params={{ slug: "terms" }} className="transition hover:text-white">Terms</Link>
        <Link to="/legal/$slug" params={{ slug: "privacy" }} className="transition hover:text-white">Privacy</Link>
        <Link to="/legal/$slug" params={{ slug: "content-policy" }} className="transition hover:text-white">Content policy</Link>
        <Link to="/legal" className="transition hover:text-white">All policies</Link>
      </nav>
    </footer>
  );
}

function Creator() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const run = useServerFn(standaloneGenerate);
  const unlock = useServerFn(unlockCreatorModel);
  const checkJob = useServerFn(checkMediaJob);
  const saveAge = useServerFn(confirmAge);
  const [models, setModels] = useState<CreatorModel[]>([]);
  const [model, setModel] = useState("");
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState(search.prompt ?? "");
  const [seconds, setSeconds] = useState(5);
  const [size, setSize] = useState<keyof typeof sizes>("portrait");
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<CreatorJob | null>(null);
  const [library, setLibrary] = useState<CreatorJob[]>([]);
  const [previewModel, setPreviewModel] = useState<CreatorModel | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [creatorSubscription, setCreatorSubscription] = useState(false);
  const [contentMode, setContentMode] = useState<"social" | "adult">(search.mode ?? "social");
  const [ageAgreed, setAgeAgreed] = useState(false);
  const [unlockingModel, setUnlockingModel] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  const readyForRender = (item: CreatorModel) => isAdmin || models[0]?.id === item.id || unlocked.includes(item.id);
  const selectedIdentity = models.find((item) => item.id === model) ?? null;
  const selectedName = model === RANDOM_IDENTITY ? "Random identity" : selectedIdentity?.name ?? "Random identity";
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  const cast = useMemo(() => [...models].sort((a, b) => Number(readyForRender(b)) - Number(readyForRender(a))), [models, isAdmin, unlocked]);
  const scenes = useMemo(() => sceneIdeas.map((scene, index) => ({ ...scene, image: models[index]?.image_url ?? "" })).filter((scene) => scene.image), [models]);

  async function loadLibrary() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLibrary([]); return; }
    const { data: conversations } = await supabase.from("conversations").select("id").eq("user_id", auth.user.id).eq("title", "Creator render");
    const ids = (conversations ?? []).map((row) => row.id);
    if (!ids.length) { setLibrary([]); return; }
    const { data } = await supabase.from("media_jobs").select("id,kind,status,media_url,prompt,created_at,error").in("conversation_id", ids).order("created_at", { ascending: false }).limit(30);
    const rows = (data ?? []) as CreatorJob[];
    const pending = rows.find((row) => row.status === "pending" || row.status === "processing");
    if (pending) setActiveJob(pending);
    setLibrary(rows.filter((row) => row.status === "completed" && row.media_url));
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
      const companionRows = (data ?? []) as CreatorModel[];
      setModels(companionRows);
      const requested = search.model;
      if (companionRows[0]) setModel(requested && companionRows.some((item) => item.id === requested) ? requested : companionRows[0].id);
      if (auth.user) {
        const [{ data: unlockRows }, { data: role }, { data: profile }, { data: balance }] = await Promise.all([
          (supabase as any).from("creator_model_unlocks").select("companion_id").eq("user_id", auth.user.id),
          supabase.rpc("has_role", { _user_id: auth.user.id, _role: "admin" }),
          supabase.from("profiles").select("age_confirmed,subscription_tier,subscription_status").eq("id", auth.user.id).maybeSingle(),
          supabase.from("credit_balances").select("free_messages_remaining,paid_credits").eq("user_id", auth.user.id).maybeSingle(),
        ]);
        if (!active) return;
        setUnlocked((unlockRows ?? []).map((row: { companion_id: string }) => row.companion_id));
        setIsAdmin(!!role);
        setAgeAgreed(!!profile?.age_confirmed);
        setCreatorSubscription(profile?.subscription_status === "active" && CREATOR_PLAN_IDS.includes(profile?.subscription_tier ?? ""));
        setCredits(totalCredits(balance));
      }
      setLoading(false);
    })().catch(() => { if (active) { setLoadError("Models could not be loaded. Refresh and try again."); setLoading(false); } });
    return () => { active = false; };
  }, [search.model]);

  useEffect(() => { void loadLibrary(); }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === "completed" || activeJob.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const result = await checkJob({ data: { jobId: activeJob.id } });
        setActiveJob((old) => old ? { ...old, ...result } : old);
        if (result.status === "completed" || result.status === "failed") {
          await loadLibrary();
          if (result.status === "completed") toast.success("Your render is ready.");
        }
      } catch { /* Keep showing the queued state and retry on the next interval. */ }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  async function unlockModel(item: CreatorModel) {
    if (isAdmin) { setUnlocked((current) => current.includes(item.id) ? current : [...current, item.id]); setModel(item.id); setPreviewModel(item); return; }
    setUnlockingModel(true);
    try {
      const result = await unlock({ data: { companionId: item.id } });
      setUnlocked((current) => current.includes(item.id) ? current : [...current, item.id]);
      setModel(item.id); setPreviewModel(item);
      toast.success(result.cost ? `${item.name} unlocked for ${result.cost} credits.` : `${item.name} is ready to use.`);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (/not authenticated|unauthorized|sign in/i.test(message)) navigate({ to: "/auth", search: { redirect: "/create-media" } as never });
      else if (/balance|credit|out_of_credits/i.test(message)) navigate({ to: "/credits", search: { returnTo: "/create-media" } as never });
      else toast.error(message || "Could not unlock this model.");
    } finally { setUnlockingModel(false); }
  }

  async function submit() {
    if (contentMode === "adult") {
      if (!ageAgreed) { toast.error("Confirm that you are 18 or older to use adult mode."); return; }
      if (!isAdmin && !creatorSubscription) { navigate({ to: "/credits", search: { plan: "creator", returnTo: "/create-media" } as never }); return; }
    }
    const selectedModel = model === RANDOM_IDENTITY ? models[Math.floor(Math.random() * models.length)]?.id : model || models[0]?.id;
    if (!selectedModel) { toast.error("Models are still loading."); return; }
    if (prompt.trim().length < 3) { toast.error("Describe the render."); return; }
    setBusy(true);
    try {
      const [width, height] = sizes[size];
      const result = await run({ data: { companionId: selectedModel, prompt, kind, seconds, width, height, adult: contentMode === "adult" } });
      setActiveJob({ id: result.jobId, kind, status: "pending", media_url: null, prompt, created_at: new Date().toISOString(), error: null });
      setCredits((current) => current === null || isAdmin ? current : Math.max(0, current - result.cost));
      toast.success(`Generation queued for ${result.cost} credits.`);
      setPrompt("");
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (message.includes("AGE_CONFIRMATION_REQUIRED")) toast.error("Confirm your age before using adult mode.");
      else if (message.includes("CREATOR_SUBSCRIPTION_REQUIRED") || message.includes("OUT_OF_CREDITS") || message.includes("Unlock this model")) navigate({ to: "/credits", search: { returnTo: "/create-media" } as never });
      else toast.error(message || "Generation failed");
    } finally { setBusy(false); }
  }

  async function agreeToAdultMode() {
    setAgeAgreed(true);
    const { data } = await supabase.auth.getUser();
    if (!data.user) { navigate({ to: "/auth", search: { redirect: "/create-media?mode=adult" } as never }); return; }
    try { await saveAge(); } catch { toast.error("Sign in again before enabling adult mode."); setAgeAgreed(false); }
  }

  async function downloadMedia(item: CreatorJob) {
    if (!item.media_url) return;
    try {
      const response = await fetch(item.media_url);
      if (!response.ok) throw new Error("download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `humancrush-${item.kind}-${item.id}.${item.kind === "video" ? "mp4" : "png"}`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { window.open(item.media_url, "_blank", "noopener,noreferrer"); }
  }

  const surpriseMe = () => setPrompt(sceneIdeas[Math.floor(Math.random() * sceneIdeas.length)].prompt);
  const renderStatus = activeJob && (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-[#FF4D6A]/60 bg-[#FF4D6A]/[0.06] px-4 py-3 text-sm">
      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${activeJob.status === "completed" ? "bg-[#7FE0B0]" : activeJob.status === "failed" ? "bg-[#FF8C8C]" : "animate-pulse bg-[#FF4D6A]"}`} />{activeJob.status === "completed" ? "Render complete." : activeJob.status === "failed" ? "Render failed." : `Rendering your ${activeJob.kind}...`}</span>
      <Link to="/library" className="font-semibold text-[#FF7A90] hover:text-white">Open library <ChevronRight className="inline h-4 w-4" /></Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#121014] text-[#F5EFF2]">
      <CreatorNav credits={credits} />
      <main className="mx-auto max-w-[1240px] px-4 pb-12 sm:px-6">
        <section className="relative py-10 sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-180px] h-[540px] w-[min(900px,100vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,77,106,.28),rgba(255,138,91,.09)_55%,transparent)]" />
          <div className="relative mx-auto max-w-[880px]">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div><p className="mb-2 text-sm font-semibold text-[#FF7A90]">Create</p><h1 className="font-display text-[clamp(2.2rem,6vw,3.6rem)] font-extrabold leading-[1.03] tracking-[-.035em]">What are we shooting today?</h1></div>
              <div role="tablist" aria-label="Output type" className="flex rounded-full border border-white/[0.1] bg-white/[0.06] p-1">
                {(["image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={`min-h-10 rounded-full px-4 text-xs font-semibold sm:px-5 sm:text-sm ${kind === value ? "bg-white text-[#121014]" : "text-[#B3A9B0] hover:text-white"}`}>{value === "image" ? "Photo" : "Video"}</button>)}
              </div>
            </div>
            <section className="rounded-[24px] border border-white/[0.1] bg-[#1C191E] p-4 shadow-[0_24px_70px_rgba(0,0,0,.28)] sm:p-6">
              <button type="button" onClick={() => selectedIdentity && setPreviewModel(selectedIdentity)} className="mb-4 flex min-h-12 items-center gap-3 text-left">
                {selectedIdentity ? <img src={selectedIdentity.image_url} alt="" className="h-12 w-12 rounded-2xl object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#26222A]"><Sparkles className="h-5 w-5 text-[#FF7A90]" /></span>}
                <span><span className="block text-sm font-semibold">{selectedName}, identity locked</span><span className="block text-xs text-[#8E858C]">Tap the identity below to change the face.</span></span>
              </button>
              <label htmlFor="creator-prompt" className="sr-only">Describe your scene</label>
              <textarea id="creator-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the scene, outfit, pose, lighting, and camera..." className="min-h-[180px] w-full resize-y border-0 bg-transparent p-0 text-lg leading-relaxed text-[#F5EFF2] outline-none placeholder:text-[#8E858C] focus:ring-0" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#8E858C]"><span>{prompt.length} / 2000</span><div className="flex flex-wrap gap-2"><button type="button" onClick={surpriseMe} className="min-h-10 rounded-full border border-white/[0.12] px-3 font-semibold text-[#B3A9B0] hover:bg-white/[0.06] hover:text-white">Surprise me</button></div></div>
              <div className="my-5 h-px bg-white/[0.08]" />
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><p className="mb-2 text-xs font-semibold text-[#8E858C]">Audience</p><div className="flex rounded-full bg-[#26222A] p-1"><button type="button" onClick={() => setContentMode("social")} className={`min-h-10 flex-1 rounded-full px-3 text-xs font-semibold ${contentMode === "social" ? "bg-white text-[#121014]" : "text-[#B3A9B0]"}`}>Social</button><button type="button" onClick={() => setContentMode("adult")} className={`min-h-10 flex-1 rounded-full px-3 text-xs font-semibold ${contentMode === "adult" ? "bg-white text-[#121014]" : "text-[#B3A9B0]"}`}>18+</button></div></div>
                  <div><p className="mb-2 text-xs font-semibold text-[#8E858C]">Frame</p><div className="flex flex-wrap gap-1.5">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key as keyof typeof sizes)} className={`min-h-10 rounded-full border px-3 text-[11px] font-semibold capitalize ${size === key ? "border-[#FF4D6A] bg-[#FF4D6A]/15 text-white" : "border-white/[0.12] text-[#B3A9B0] hover:text-white"}`}>{key} {width}x{height}</button>)}</div></div>
                </div>
                <button type="button" disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-[#FF4D6A] px-5 text-sm font-bold text-[#1A0A0F] transition hover:bg-[#FF7A90] disabled:cursor-not-allowed disabled:opacity-35"><span>{busy ? "Queuing..." : "Generate"}</span><span className="h-4 w-px bg-[#1A0A0F]/30" /><Bolt className="h-4 w-4" /><span>{cost}</span></button>
              </div>
              {kind === "video" && <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[#B3A9B0]"><span>Duration</span>{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} className={`min-h-9 rounded-full border px-3 ${seconds === value ? "border-white bg-white text-[#121014]" : "border-white/[0.12]"}`}>{value}s</button>)}</div>}
              {contentMode === "adult" && <div className="mt-4 rounded-2xl border border-white/[0.1] bg-[#26222A] p-4"><label className="flex items-start gap-3 text-sm text-[#B3A9B0]"><input type="checkbox" checked={ageAgreed} onChange={(event) => event.target.checked ? void agreeToAdultMode() : setAgeAgreed(false)} className="mt-1 h-4 w-4 accent-[#FF4D6A]" /><span>I confirm I am 18 or older. Adult renders require age confirmation and an eligible Creator plan.</span></label>{!creatorSubscription && !isAdmin && <Link to="/credits" search={{ plan: "creator", returnTo: "/create-media" } as never} className="mt-3 inline-flex text-sm font-semibold text-[#FF7A90]">View Creator plans <ChevronRight className="h-4 w-4" /></Link>}</div>}
            </section>
            {renderStatus}
            {loadError && <p className="mt-3 text-sm text-[#FF8C8C]">{loadError}</p>}
          </div>
        </section>

        <section aria-labelledby="scene-title" className="mt-2">
          <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-xs font-semibold text-[#FF7A90]">Start from a scene</p><h2 id="scene-title" className="mt-1 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">A strong first frame, ready to remix.</h2></div><span className="hidden text-xs text-[#8E858C] sm:inline">Swipe to explore</span></div>
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{scenes.map((scene) => <article key={scene.name} className="group relative h-[300px] w-[205px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#1C191E] sm:h-[340px] sm:w-[220px]"><img src={scene.image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-[#121014] via-transparent to-transparent" /><div className="absolute inset-x-4 bottom-4"><h3 className="font-display text-lg font-bold">{scene.name}</h3><p className="mt-1 line-clamp-2 text-xs text-white/70">{scene.prompt}</p><button type="button" onClick={() => { setPrompt(scene.prompt); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="mt-3 min-h-10 rounded-full bg-white px-3 text-xs font-bold text-[#121014]">Use this scene</button></div></article>)}</div>
        </section>

        <section className="mt-12" aria-labelledby="ways-title"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-semibold text-[#FF7A90]">More ways to create</p><h2 id="ways-title" className="mt-1 font-display text-2xl font-extrabold">Pick a starting point.</h2></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><button type="button" onClick={() => setKind("video")} className="rounded-[18px] border border-white/[0.08] bg-[#1C191E] p-4 text-left transition hover:bg-[#26222A]"><Video className="h-5 w-5 text-[#FF7A90]" /><h3 className="mt-5 font-semibold">Photo to video</h3><p className="mt-1 text-xs leading-relaxed text-[#8E858C]">Turn the next prompt into a short motion clip.</p></button><button type="button" onClick={() => setKind("image")} className="rounded-[18px] border border-white/[0.08] bg-[#1C191E] p-4 text-left transition hover:bg-[#26222A]"><ImageIcon className="h-5 w-5 text-[#FF7A90]" /><h3 className="mt-5 font-semibold">Create a photo</h3><p className="mt-1 text-xs leading-relaxed text-[#8E858C]">Start with a clean, campaign-ready still.</p></button><Link to="/models" className="rounded-[18px] border border-white/[0.08] bg-[#1C191E] p-4 text-left transition hover:bg-[#26222A]"><Sparkles className="h-5 w-5 text-[#FF7A90]" /><h3 className="mt-5 font-semibold">Browse models</h3><p className="mt-1 text-xs leading-relaxed text-[#8E858C]">Find an identity to lock before you write.</p></Link><Link to="/done-for-you" className="rounded-[18px] border border-white/[0.08] bg-[#1C191E] p-4 text-left transition hover:bg-[#26222A]"><LockKeyhole className="h-5 w-5 text-[#FF7A90]" /><h3 className="mt-5 font-semibold">Build a creator brand</h3><p className="mt-1 text-xs leading-relaxed text-[#8E858C]">Have our team build the launch system.</p></Link></div></section>

        <section className="mt-12" aria-labelledby="recent-title"><div className="mb-4 flex items-center justify-between gap-4"><div><p className="text-xs font-semibold text-[#FF7A90]">Recent renders</p><h2 id="recent-title" className="mt-1 font-display text-2xl font-extrabold">Your latest work.</h2></div><Link to="/library" className="text-sm font-semibold text-[#FF7A90] hover:text-white">See all {library.length} <ChevronRight className="inline h-4 w-4" /></Link></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{activeJob && activeJob.status !== "completed" && <div className="flex aspect-[4/5] animate-pulse items-end rounded-[14px] border border-dashed border-[#FF4D6A]/70 bg-[#1C191E] p-3 text-xs font-semibold">Rendering...</div>}{library.slice(0, activeJob && activeJob.status !== "completed" ? 5 : 6).map((item) => <button type="button" key={item.id} onClick={() => item.media_url && window.open(item.media_url, "_blank", "noopener,noreferrer")} className="group relative aspect-[4/5] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#1C191E] text-left">{item.kind === "video" ? <video muted preload="metadata" className="h-full w-full object-cover" src={item.media_url ?? undefined} /> : <img src={item.media_url ?? ""} alt="Saved render" className="h-full w-full object-cover transition group-hover:scale-105" />}<span className="absolute left-2 top-2 rounded-full bg-[#121014]/80 px-2 py-1 text-[10px] font-semibold">{item.kind === "video" ? "Video" : "Photo"}</span></button>)}</div>{library.length === 0 && !activeJob && <p className="rounded-[18px] border border-dashed border-white/[0.12] p-8 text-center text-sm text-[#8E858C]">Your completed renders will appear here.</p>}</section>

        <section className="mt-12" aria-labelledby="cast-title"><div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-xs font-semibold text-[#FF7A90]">Your cast</p><h2 id="cast-title" className="mt-1 font-display text-2xl font-extrabold">Lock one face, then keep creating.</h2></div><Link to="/models" className="text-sm font-semibold text-[#FF7A90] hover:text-white">Browse all models <ChevronRight className="inline h-4 w-4" /></Link></div><div className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{cast.map((item) => <article key={item.id} className={`w-[168px] shrink-0 overflow-hidden rounded-[18px] border bg-[#1C191E] ${model === item.id ? "border-[#FF4D6A] ring-2 ring-[#FF4D6A]/20" : "border-white/[0.08]"}`}><button type="button" onClick={() => { setModel(item.id); setPreviewModel(item); }} className="block w-full text-left"><img src={item.image_url} alt={item.name} className="aspect-[4/5] w-full object-cover" /><div className="p-3"><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-[#8E858C]">{model === item.id ? "Selected" : readyForRender(item) ? "Ready" : "Locked"}</p></div></button>{!readyForRender(item) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(item)} className="mx-3 mb-3 min-h-9 w-[calc(100%-1.5rem)] rounded-full border border-white/[0.12] px-2 text-[11px] font-semibold text-[#B3A9B0] hover:bg-white/[0.06]">Unlock for 50 credits</button>}</article>)}</div></section>

        <section className="mt-12 flex flex-col items-start justify-between gap-4 rounded-[18px] border border-white/[0.08] bg-[#1C191E] p-5 sm:flex-row sm:items-center sm:p-6"><div><p className="font-display text-xl font-bold">Want the whole AI creator business built for you?</p><p className="mt-1 text-sm text-[#8E858C]">One model identity, a launch-ready library, and a handoff you can operate.</p></div><a href={BOOK_CALL_SMS} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/[0.16] px-5 text-sm font-semibold transition hover:bg-white hover:text-[#121014]">Book a call</a></section>
      </main>
      <CreatorFooter />
      {previewModel && <div role="dialog" aria-modal="true" aria-label={`${previewModel.name} preview`} className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-4" onClick={() => setPreviewModel(null)}><div className="relative w-full max-w-md overflow-hidden rounded-[20px] border border-white/[0.12] bg-[#1C191E]" onClick={(event) => event.stopPropagation()}><button type="button" aria-label="Close preview" onClick={() => setPreviewModel(null)} className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/60"><X className="h-4 w-4" /></button><img src={previewModel.image_url} alt={previewModel.name} className="aspect-[4/5] max-h-[70vh] w-full object-cover object-top" /><div className="p-5"><h2 className="font-display text-2xl font-extrabold">{previewModel.name}</h2><p className="mt-1 text-sm text-[#B3A9B0]">{readyForRender(previewModel) ? "Identity ready. This face will stay consistent." : "Unlock this identity to keep the face consistent."}</p>{!readyForRender(previewModel) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(previewModel)} className="mt-4 min-h-11 w-full rounded-[14px] bg-[#FF4D6A] text-sm font-bold text-[#1A0A0F] disabled:opacity-50">{unlockingModel ? "Unlocking..." : "Unlock for 50 credits"}</button>}</div></div></div>}
    </div>
  );
}
