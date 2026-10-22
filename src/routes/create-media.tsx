import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Bolt, Check, ChevronRight, Menu, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { confirmAge } from "@/lib/payments.functions";
import { totalCredits } from "@/lib/credits";
import { toast } from "sonner";
import { LogoLink } from "@/components/Logo";
import { CreatorSheet } from "@/components/creator/CreatorSheet";
import { creatorBilling, creatorPlans, estimatedPlanMedia, formatCredits, type BillingPeriod, type CreatorPlan } from "@/config/plans";
import { getNextGate } from "@/lib/creator-gates";
import { showcaseConfig } from "@/config/showcase";

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

// Keep the first impression of the creator studio editorial and varied. The
// database order is still preserved for entitlement checks (the first catalog
// model is the free identity), but the visual rail leads with the slimmer,
// fashion-forward identities and leaves larger-bust and male profiles for the
// end of the rail.
const LEADING_CREATOR_MODELS = ["Lilith", "Putri", "Airi", "Raven", "Esmé", "Mina", "Naomi", "Hana"];
const TRAILING_CREATOR_MODELS = ["Vanessa", "Sabrina", "Bianca", "Scarlett"];
function creatorModelRank(model: CreatorModel) {
  const name = model.name.trim().toLowerCase();
  const preferred = LEADING_CREATOR_MODELS.findIndex((item) => item.toLowerCase() === name);
  if (preferred >= 0) return preferred;
  if (/male|man|boy/i.test(model.gender ?? "")) return 900;
  if (TRAILING_CREATOR_MODELS.some((item) => item.toLowerCase() === name)) return 700;
  return 100 + name.charCodeAt(0);
}

function CreatorNav({ credits }: { credits: number | null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#101012]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <LogoLink className="h-8 shrink-0" />
        <nav aria-label="Creator studio" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-1">
          <Link to="/create-media" className="rounded-full bg-white/[0.08] px-3 py-2 text-xs font-semibold text-white sm:px-4 sm:text-sm">Create</Link>
          <Link to="/library" className="rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white sm:px-4 sm:text-sm">Library</Link>
          <Link to="/models" className="hidden rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white sm:inline-flex sm:px-4 sm:text-sm">Models</Link>
          <a href="#plans" className="hidden rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white sm:inline-flex sm:px-4 sm:text-sm">Plans</a>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {credits === null ? <Link to="/auth" search={{ redirect: "/create-media" } as never} className="hidden min-h-10 items-center rounded-full border border-white/[0.12] px-3 text-xs font-semibold text-white sm:inline-flex">Sign in</Link> : <Link to="/credits" className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/[0.12] px-2.5 text-xs font-semibold text-white sm:min-h-10 sm:gap-1.5 sm:px-4 sm:text-sm">
            <Bolt className="h-4 w-4 text-[#FF4D6A]" />
            <span>{credits === null ? "--" : credits}</span><span className="hidden text-[#B3A9B0] sm:inline">credits</span>
          </Link>}
          <Link to="/me" aria-label="Open account" className="grid h-9 w-9 place-items-center rounded-full bg-[#2E2730] text-sm font-bold text-white sm:h-10 sm:w-10">G</Link>
          <button type="button" aria-label="Open creator menu" onClick={() => setMenuOpen(true)} className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] text-white sm:hidden"><Menu className="h-5 w-5" /></button>
        </div>
      </div>
      <CreatorSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Creator studio"><nav className="grid gap-2" aria-label="Creator menu"><Link onClick={() => setMenuOpen(false)} to="/create-media" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Create</Link><Link onClick={() => setMenuOpen(false)} to="/library" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Library</Link><Link onClick={() => setMenuOpen(false)} to="/models" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Models</Link><a onClick={() => setMenuOpen(false)} href="#plans" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Plans</a><Link onClick={() => setMenuOpen(false)} to="/me" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Account</Link></nav></CreatorSheet>
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

function PlanCard({ plan, period, selectedTier, onTierChange, currentPlan, isAdmin, onChoose }: {
  plan: CreatorPlan;
  period: BillingPeriod;
  selectedTier: number;
  onTierChange: (index: number) => void;
  currentPlan: string | null;
  isAdmin: boolean;
  onChoose: (plan: CreatorPlan) => void;
}) {
  const tier = plan.tiers?.[selectedTier];
  const monthly = tier?.monthly ?? plan.monthly;
  const credits = tier?.credits ?? plan.credits;
  const isCurrent = currentPlan === plan.id;
  const media = plan.id === "pro" ? credits === null ? null : Math.floor(credits / creatorBilling.creditCosts.image) : estimatedPlanMedia(plan, "image");
  const buttonLabel = isCurrent ? "Current plan" : isAdmin ? "Open creator studio" : currentPlan ? `Upgrade to ${plan.name}` : `Get ${plan.name}`;
  return (
    <article className={`flex h-full flex-col rounded-2xl border p-5 ${plan.featured ? "border-[#E5484D] bg-[#19191C]" : "border-white/[0.1] bg-[#19191C]"}`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">{plan.name}</p><p className="mt-2 font-display text-3xl font-extrabold">{monthly === null ? "Custom" : `$${period === "yearly" && plan.yearly !== null ? plan.yearly : monthly}`}<span className="ml-1 text-sm font-medium text-[#A1A1AA]">/{period === "yearly" ? "year" : "month"}</span></p></div>{plan.featured && <span className="rounded-full bg-[#E5484D] px-2.5 py-1 text-[11px] font-bold text-white">18+</span>}</div>
      <p className="mt-1 text-sm text-[#A1A1AA]">{formatCredits(credits)}</p>
      {plan.id === "pro" && plan.tiers && <div className="mt-4 rounded-xl bg-[#232327] p-3"><div className="flex items-center justify-between text-xs font-semibold"><span>Scale your credits</span><span>{formatCredits(credits)}</span></div><input aria-label="Pro credit tier" type="range" min={0} max={plan.tiers.length - 1} value={selectedTier} onChange={(event) => onTierChange(Number(event.target.value))} className="mt-3 h-2 w-full accent-white" /><div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px] text-[#A1A1AA]">{plan.tiers.map((item, index) => <button type="button" key={item.monthly} onClick={() => onTierChange(index)} className={`min-h-9 rounded-lg ${index === selectedTier ? "bg-white font-bold text-[#101012]" : "hover:bg-white/[0.08]"}`}>${item.monthly}</button>)}</div></div>}
      <div className="mt-4 flex-1 rounded-xl bg-[#232327] p-4"><p className="text-sm font-semibold">{media === null ? "Flexible credit balance" : `Create ${media} images or ${Math.floor((credits ?? 0) / creatorBilling.creditCosts.video)} videos`}</p><ul className="mt-3 space-y-2 text-xs text-[#A1A1AA]">{plan.features.map((feature) => <li key={feature} className="flex gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#7FE0B0]" />{feature}</li>)}</ul></div>
      {plan.footnote && <p className="mt-3 text-[11px] leading-relaxed text-[#A1A1AA]">{plan.footnote}</p>}
      <button type="button" disabled={isCurrent} onClick={() => onChoose(plan)} className={`mt-5 min-h-11 rounded-xl px-4 text-sm font-bold ${isCurrent ? "bg-[#232327] text-[#A1A1AA]" : plan.featured ? "bg-white text-[#101012]" : "border border-white/[0.16] text-white hover:bg-white/[0.08]"}`}>{buttonLabel}</button>
    </article>
  );
}

function PlansSection({ currentPlan, isAdmin, onChoose }: { currentPlan: string | null; isAdmin: boolean; onChoose: (plan: CreatorPlan) => void }) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [selectedTier, setSelectedTier] = useState(1);
  const pro = creatorPlans.find((plan) => plan.id === "pro")!;
  const otherPlans = creatorPlans.filter((plan) => plan.id !== "pro");
  return <section id="plans" className="mt-12 scroll-mt-24"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold text-[#A1A1AA]">Plans</p><h2 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">Choose how you create.</h2><p className="mt-2 max-w-xl text-sm text-[#A1A1AA]">Start small, then scale your image and video credits when your library grows.</p></div><div className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#19191C] p-1 text-xs font-semibold"><button type="button" onClick={() => setPeriod("monthly")} className={`min-h-10 rounded-full px-3 ${period === "monthly" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Monthly</button><button type="button" onClick={() => setPeriod("yearly")} className={`min-h-10 rounded-full px-3 ${period === "yearly" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Yearly</button><span className="rounded-full bg-[#E5484D] px-2 py-1 text-[10px] font-bold text-white">{creatorBilling.yearlyDiscountLabel}</span></div></div><div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,.92fr)]"><PlanCard plan={pro} period={period} selectedTier={selectedTier} onTierChange={setSelectedTier} currentPlan={currentPlan} isAdmin={isAdmin} onChoose={onChoose} /><div className="grid gap-4 sm:grid-cols-2">{otherPlans.map((plan) => <PlanCard key={plan.id} plan={plan} period={period} selectedTier={0} onTierChange={() => undefined} currentPlan={currentPlan} isAdmin={isAdmin} onChoose={onChoose} />)}</div></div></section>;
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
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);
  const [contentMode, setContentMode] = useState<"social" | "adult">(search.mode ?? "social");
  const [ageAgreed, setAgeAgreed] = useState(false);
  const [unlockingModel, setUnlockingModel] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"auth" | "age" | "plan" | "gallery" | null>(null);

  const readyForRender = (item: CreatorModel) => isAdmin || models[0]?.id === item.id || unlocked.includes(item.id);
  const selectedIdentity = models.find((item) => item.id === model) ?? null;
  const selectedName = model === RANDOM_IDENTITY ? "Random identity" : selectedIdentity?.name ?? "Random identity";
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  const displayModels = useMemo(() => [...models].sort((a, b) => creatorModelRank(a) - creatorModelRank(b)), [models]);
  const showcaseItems = useMemo(() => showcaseConfig.map((item, index) => ({ ...item, src: displayModels[index % Math.max(displayModels.length, 1)]?.image_url ?? "" })).filter((item) => item.src), [displayModels]);
  const ownedModels = useMemo(() => displayModels.filter((item) => readyForRender(item)), [displayModels, unlocked, isAdmin]);
  const lockedModels = useMemo(() => displayModels.filter((item) => !readyForRender(item)), [displayModels, unlocked, isAdmin]);

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
      const visualFirst = [...companionRows].sort((a, b) => creatorModelRank(a) - creatorModelRank(b))[0];
      if (visualFirst) setModel(requested && companionRows.some((item) => item.id === requested) ? requested : visualFirst.id);
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
        setSubscriptionTier(profile?.subscription_tier ?? null);
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
    const gate = getNextGate({ signedIn: credits !== null, isAdmin, ageConfirmed: ageAgreed, hasAdultPlan: creatorSubscription, hasActivePlan: creatorSubscription, credits }, "generate", cost);
    if (contentMode === "adult" && !ageAgreed) { setSheet("age"); return; }
    if (gate.kind !== "allow") {
      sessionStorage.setItem("hc_creator_intent", JSON.stringify({ model, contentMode, prompt, kind, seconds, size }));
      if (gate.kind === "auth") setSheet("auth");
      else if (gate.kind === "age") setSheet("age");
      else setSheet("plan");
      return;
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

  function selectMode(next: "social" | "adult") {
    if (next === "social") { setContentMode(next); return; }
    const gate = getNextGate({ signedIn: credits !== null, isAdmin, ageConfirmed: ageAgreed, hasAdultPlan: creatorSubscription, hasActivePlan: creatorSubscription, credits }, "select_adult");
    if (gate.kind === "allow") setContentMode("adult");
    else if (gate.kind === "auth") setSheet("auth");
    else if (gate.kind === "age") setSheet("age");
    else setSheet("plan");
  }

  function choosePlan(plan: CreatorPlan) {
    if (isAdmin) { toast.success(`${plan.name} is available to your admin account.`); return; }
    navigate({ to: "/credits", search: { plan: plan.id === "pro" ? "creator" : plan.id, returnTo: "/create-media" } as never });
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
    <div className="min-h-screen bg-[#101012] text-[#F4F4F5]">
      <CreatorNav credits={credits} />
      <main className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6">
        <section id="showcase" className="scroll-mt-24 py-8 sm:py-12">
          <div className="grid gap-6 rounded-2xl border border-white/[0.1] bg-[#19191C] p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center sm:p-8">
            <div><p className="text-xs font-semibold text-[#A1A1AA]">Creator studio</p><h1 className="mt-3 max-w-[18ch] font-display text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-[1.02] tracking-[-.04em]">Bring your next scene to life.</h1><p className="mt-4 max-w-md text-sm leading-relaxed text-[#A1A1AA]">Describe a photo or short video, choose a fictional adult identity when you want consistency, and keep the result in your library.</p><div className="mt-6 flex flex-wrap gap-2"><button type="button" onClick={() => document.getElementById("models")?.scrollIntoView({ behavior: "smooth" })} className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-[#101012]">Choose your model</button><button type="button" onClick={() => setSheet("gallery")} className="min-h-11 rounded-xl border border-white/[0.16] px-4 text-sm font-semibold text-white hover:bg-white/[0.08]">See gallery</button></div></div>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label="Social-safe creator showcase">{showcaseItems.map((item, index) => <article key={`${item.label}-${index}`} className="relative aspect-[3/4] w-[130px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/[0.1] bg-[#232327] sm:w-[170px] lg:w-[200px]"><img src={item.src} alt={item.alt} loading={index < 3 ? "eager" : "lazy"} className="h-full w-full object-cover" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 text-xs font-semibold">{item.label}</div></article>)}</div>
          </div>
        </section>

        <section id="models" className="scroll-mt-24"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Step 1</p><h2 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">Choose your model</h2><p className="mt-2 text-sm text-[#A1A1AA]">Select a face to keep consistent, or start with a random identity.</p></div><Link to="/models" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">Browse all</Link></div><div className="mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
          <button type="button" aria-pressed={model === RANDOM_IDENTITY} onClick={() => { setModel(RANDOM_IDENTITY); setPreviewModel(null); }} className={`relative flex w-[148px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-xl border bg-[#19191C] p-4 text-left sm:w-[220px] ${model === RANDOM_IDENTITY ? "border-white ring-2 ring-white/20" : "border-white/[0.1]"}`}><span className="grid aspect-[3/4] place-items-center rounded-lg bg-[#232327]"><Sparkles className="h-8 w-8 text-white" /></span><span className="mt-3 text-sm font-bold">Create your own model</span><span className="mt-1 text-xs text-[#A1A1AA]">Use a random identity or describe anyone</span></button>
          {[...ownedModels, ...lockedModels].map((item) => <article key={item.id} className={`w-[148px] shrink-0 snap-start overflow-hidden rounded-xl border bg-[#19191C] sm:w-[220px] ${model === item.id ? "border-[#E5484D] ring-2 ring-[#E5484D]/30" : "border-white/[0.1]"}`}><button type="button" aria-pressed={model === item.id} onClick={() => { if (readyForRender(item)) setModel(item.id); setPreviewModel(item); }} className="block w-full text-left"><img src={item.image_url} alt={item.name} loading="lazy" className="aspect-[3/4] w-full object-cover" /><div className="p-3"><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-[#A1A1AA]">{model === item.id ? "Selected" : readyForRender(item) ? "Owned" : "Unlock for 50 credits"}</p></div></button>{!readyForRender(item) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(item)} className="mx-3 mb-3 min-h-10 w-[calc(100%-1.5rem)] rounded-lg border border-white/[0.14] px-2 text-xs font-semibold text-white hover:bg-white/[0.08]">{unlockingModel ? "Unlocking..." : "Unlock"}</button>}</article>)}
        </div>{selectedIdentity && <div className="mt-2 grid grid-cols-3 gap-2" aria-label={`${selectedIdentity.name} sample images`}>{[0, 1, 2].map((offset) => <img key={offset} src={displayModels[(displayModels.findIndex((item) => item.id === selectedIdentity.id) + offset) % Math.max(displayModels.length, 1)]?.image_url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />)}</div>}</section>

        <section id="mode" className="mt-8 scroll-mt-24"><div className="rounded-xl border border-white/[0.1] bg-[#19191C] p-4 sm:flex sm:items-center sm:justify-between sm:gap-6"><div><p className="text-xs font-semibold text-[#A1A1AA]">Step 2</p><h2 className="mt-1 text-lg font-bold">Choose your mode</h2><p className="mt-1 text-sm text-[#A1A1AA]">Social keeps prompts and outputs suitable for public feeds. 18+ requires age confirmation and an eligible Pro plan.</p></div><div role="radiogroup" aria-label="Content mode" className="mt-4 flex w-full rounded-xl border border-white/[0.12] bg-[#232327] p-1 sm:mt-0 sm:w-auto"><button type="button" role="radio" aria-checked={contentMode === "social"} onClick={() => selectMode("social")} className={`min-h-11 flex-1 rounded-lg px-5 text-sm font-semibold sm:flex-none ${contentMode === "social" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Social</button><button type="button" role="radio" aria-checked={contentMode === "adult"} onClick={() => selectMode("adult")} className={`min-h-11 flex-1 rounded-lg px-5 text-sm font-semibold sm:flex-none ${contentMode === "adult" ? "bg-[#E5484D] text-white" : "text-[#A1A1AA]"}`}>18+ <span className="ml-1 text-[10px]">Pro</span></button></div></div></section>

        <section id="create" className="mt-8 scroll-mt-24"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Step 3</p><h2 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">Describe the scene</h2></div><span className="rounded-full border border-white/[0.12] px-3 py-2 text-xs font-semibold text-[#A1A1AA]">{selectedName}</span></div><section className="mt-4 rounded-2xl border border-white/[0.1] bg-[#19191C] p-4 sm:p-6"><div className="flex rounded-xl border border-white/[0.12] bg-[#232327] p-1" role="tablist" aria-label="Output type">{(["image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${kind === value ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>{value === "image" ? "Photo" : "Video"}</button>)}</div><label htmlFor="creator-prompt" className="sr-only">Describe your scene</label><textarea id="creator-prompt" value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the pose, outfit, setting, lighting, and action..." className="mt-4 min-h-[120px] w-full resize-y rounded-xl border border-white/[0.12] bg-[#101012] p-4 text-base leading-relaxed text-white outline-none placeholder:text-[#71717A] focus:border-white focus:ring-2 focus:ring-white/20 sm:min-h-[180px]" /><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#A1A1AA]"><span>{prompt.length} / 2000</span><button type="button" onClick={surpriseMe} className="min-h-10 rounded-lg border border-white/[0.14] px-3 font-semibold text-white hover:bg-white/[0.08]">Surprise me</button></div><div className="mt-5 flex flex-col gap-4 border-t border-white/[0.08] pt-5"><div><p className="text-xs font-semibold text-[#A1A1AA]">Frame size</p><div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key as keyof typeof sizes)} className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-semibold capitalize ${size === key ? "border-white bg-white text-[#101012]" : "border-white/[0.14] text-[#A1A1AA] hover:text-white"}`}>{key} · {width}×{height}</button>)}</div></div>{kind === "video" && <div><p className="text-xs font-semibold text-[#A1A1AA]">Duration</p><div className="mt-2 flex gap-2 overflow-x-auto pb-1">{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-semibold ${seconds === value ? "border-white bg-white text-[#101012]" : "border-white/[0.14] text-[#A1A1AA]"}`}>{value}s</button>)}</div></div>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#A1A1AA]">Estimated cost <span className="font-bold text-white">{cost} credits</span>{contentMode === "adult" && <span className="ml-2 text-xs text-[#E5484D]">18+ rate</span>}</p><button type="button" aria-disabled={busy || prompt.trim().length < 3} disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="min-h-12 w-full rounded-xl bg-white px-5 text-sm font-bold text-[#101012] transition hover:bg-[#E4E4E7] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">{busy ? "Queuing…" : `Generate · ${cost} credits`}</button></div></div>{renderStatus}{loadError && <p className="mt-3 text-sm text-[#FF8C8C]">{loadError}</p>}</section></section>

        <PlansSection currentPlan={subscriptionTier} isAdmin={isAdmin} onChoose={choosePlan} />

        <section id="book-call" className="mt-12 scroll-mt-24 rounded-2xl border border-white/[0.1] bg-[#19191C] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7"><div><p className="text-xs font-semibold text-[#A1A1AA]">Done-for-you</p><h2 className="mt-1 font-display text-2xl font-extrabold">Want the whole AI creator business built for you?</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A1A1AA]">One model identity, a launch-ready library, and a handoff you can operate. We’ll reply with next steps.</p></div><a href={BOOK_CALL_SMS} className="mt-5 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-bold text-[#101012] sm:mt-0">Book a call</a></section>

        {credits !== null && <section id="renders" className="mt-12 scroll-mt-24"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Your renders</p><h2 className="mt-1 font-display text-2xl font-extrabold">Recent work</h2></div><Link to="/library" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">View all <ChevronRight className="inline h-4 w-4" /></Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{activeJob && activeJob.status !== "completed" && <div className="flex aspect-[4/5] animate-pulse items-end rounded-xl border border-dashed border-white/[0.18] bg-[#19191C] p-3 text-xs font-semibold">Rendering…</div>}{library.slice(0, activeJob && activeJob.status !== "completed" ? 5 : 6).map((item) => <button type="button" key={item.id} onClick={() => item.media_url && window.open(item.media_url, "_blank", "noopener,noreferrer")} className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.1] bg-[#19191C] text-left">{item.kind === "video" ? <video muted preload="metadata" className="h-full w-full object-cover" src={item.media_url ?? undefined} /> : <img src={item.media_url ?? ""} alt="Saved render" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />}<span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold">{item.kind === "video" ? "Video" : "Photo"}</span></button>)}</div>{library.length === 0 && !activeJob && <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] p-8 text-center text-sm text-[#A1A1AA]">Your completed renders will appear here.</p>}</section>}
      </main>
      <CreatorFooter />
      {previewModel && <CreatorSheet open onClose={() => setPreviewModel(null)} title={`${previewModel.name} preview`}><img src={previewModel.image_url} alt={previewModel.name} className="max-h-[60dvh] w-full rounded-xl object-cover object-top" /><p className="mt-4 text-sm text-[#A1A1AA]">{readyForRender(previewModel) ? "Owned identity. This face will stay consistent." : "Unlock this identity to keep the face consistent in your renders."}</p>{!readyForRender(previewModel) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(previewModel)} className="mt-4 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-50">{unlockingModel ? "Unlocking…" : "Unlock for 50 credits"}</button>}</CreatorSheet>}
      <CreatorSheet open={sheet === "auth"} onClose={() => setSheet(null)} title="Sign in to continue"><p className="text-sm leading-relaxed text-[#A1A1AA]">Create an account or sign in to save renders, use your credits, and keep an identity consistent.</p><Link to="/auth" search={{ redirect: "/create-media" } as never} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white text-sm font-bold text-[#101012]">Open sign in</Link></CreatorSheet>
      <CreatorSheet open={sheet === "age"} onClose={() => setSheet(null)} title="Confirm your age"><label className="flex items-start gap-3 text-sm leading-relaxed text-[#A1A1AA]"><input type="checkbox" checked={ageAgreed} onChange={(event) => setAgeAgreed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#E5484D]" /><span>I confirm that I am 18 or older and agree to the Terms and Privacy Policy.</span></label><button type="button" disabled={!ageAgreed} onClick={() => { void agreeToAdultMode(); setSheet(null); setContentMode("adult"); }} className="mt-5 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-40">Continue to 18+</button></CreatorSheet>
      <CreatorSheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Choose a plan"><p className="text-sm leading-relaxed text-[#A1A1AA]">A plan is required for creator renders. 18+ mode requires Pro and age confirmation.</p><div className="mt-4 grid gap-3">{creatorPlans.map((plan) => <button type="button" key={plan.id} onClick={() => choosePlan(plan)} className="flex min-h-14 items-center justify-between rounded-xl border border-white/[0.12] px-4 text-left hover:bg-white/[0.08]"><span><span className="block font-semibold">{plan.name}</span><span className="block text-xs text-[#A1A1AA]">{plan.id === "pro" ? "18+ eligible" : "Social creator plan"}</span></span><ChevronRight className="h-4 w-4" /></button>)}</div></CreatorSheet>
      <CreatorSheet open={sheet === "gallery"} onClose={() => setSheet(null)} title="Creator gallery"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{showcaseItems.map((item, index) => <figure key={`${item.label}-${index}`}><img src={item.src} alt={item.alt} loading="lazy" className="aspect-[3/4] w-full rounded-xl object-cover" /><figcaption className="mt-1 text-xs text-[#A1A1AA]">{item.label}</figcaption></figure>)}</div><Link to="/library" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/[0.14] text-sm font-semibold">View library</Link></CreatorSheet>
    </div>
  );
}
