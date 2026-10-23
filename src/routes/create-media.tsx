import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Bolt, Check, ChevronRight, Compass, Copy, Menu, MessageCircle, Sparkles, SquarePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { confirmAge, getPricing } from "@/lib/payments.functions";
import { totalCredits } from "@/lib/credits";
import { toast } from "sonner";
import { LogoLink } from "@/components/Logo";
import { CreatorSheet } from "@/components/creator/CreatorSheet";
import { creatorBilling, creatorPlans, creatorPlansFromTiers, estimatedPlanMedia, formatCredits, formatPlanPrice, type BillingPeriod, type CreatorPlan } from "@/config/plans";
import { getNextGate } from "@/lib/creator-gates";
import { showcaseConfig } from "@/config/showcase";
import { orderModelsForDisplay } from "@/lib/display-models";
import { getEffectiveCompanionReel } from "@/lib/reels";

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
type ShowcaseItem = (typeof showcaseConfig)[number] & {
  id: string;
  src: string;
  poster: string;
};
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
        <nav aria-label="Primary" className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
          <Link to="/browse" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><Compass className="h-4 w-4" /> Explore</Link>
          <Link to="/me" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><MessageCircle className="h-4 w-4" /> Chat</Link>
          <Link to="/create" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><SquarePlus className="h-4 w-4" /> Create</Link>
          <Link to="/create-media" className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-2 text-sm font-semibold text-white"><Sparkles className="h-4 w-4" /> Generate</Link>
          <Link to="/library" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><Copy className="h-4 w-4" /> My AI</Link>
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
      <CreatorSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu"><nav className="grid gap-2" aria-label="Creator menu"><Link onClick={() => setMenuOpen(false)} to="/browse" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Explore</Link><Link onClick={() => setMenuOpen(false)} to="/me" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Chat</Link><Link onClick={() => setMenuOpen(false)} to="/create" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Create</Link><Link onClick={() => setMenuOpen(false)} to="/create-media" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Generate</Link><Link onClick={() => setMenuOpen(false)} to="/library" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">My AI</Link><a onClick={() => setMenuOpen(false)} href="#plans" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Plans</a></nav></CreatorSheet>
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

function ShowcaseCard({ item, index, onOpen }: { item: ShowcaseItem; index: number; onOpen: (index: number) => void }) {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);

  useEffect(() => {
    if (item.type !== "video" || !mediaRef.current) return;
    const video = mediaRef.current;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (connection?.saveData || reducedMotion) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      setShouldPlay(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry?.isIntersecting ?? false;
      setInView(visible);
      if (visible) {
        setShouldPlay(true);
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }, { threshold: 0.55 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [item.type]);

  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      className="group relative aspect-[3/4] w-[130px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/[0.1] bg-[#232327] text-left shadow-[0_10px_25px_rgba(0,0,0,.2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-[145px]"
      aria-label={`Open ${item.label} in the gallery`}
    >
      {item.type === "video" ? (
        <video
          ref={mediaRef}
          muted
          loop
          playsInline
          autoPlay={shouldPlay && inView}
          preload="none"
          poster={item.poster}
          src={shouldPlay && inView ? item.src : undefined}
          className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <img src={item.src} alt={item.alt} loading={index < 3 ? "eager" : "lazy"} className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]" />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-3 pb-3 pt-10 text-xs font-semibold text-white">{item.label}</span>
    </button>
  );
}

function PlanCard({ plan, currentPlan, isAdmin, onChoose }: {
  plan: CreatorPlan;
  currentPlan: string | null;
  isAdmin: boolean;
  onChoose: (plan: CreatorPlan) => void;
}) {
  const isCurrent = currentPlan === plan.tierId;
  const imageCount = estimatedPlanMedia(plan, "image");
  const videoCount = estimatedPlanMedia(plan, "video");
  const buttonLabel = isCurrent ? "Subscribed" : isAdmin ? "Admin access" : currentPlan ? `Switch to ${plan.name}` : `Choose ${plan.name}`;
  return (
    <article className={`flex h-full flex-col rounded-2xl border p-5 shadow-[0_18px_50px_rgba(0,0,0,.18)] ${plan.featured ? "border-[#E5484D]/60 bg-[#21191d]" : "border-white/[0.1] bg-[#19191C]"}`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#A1A1AA]">{plan.billingMonths === 12 ? "Best value" : "Flexible start"}</p><p className="mt-2 font-display text-2xl font-extrabold">{plan.name}</p><p className="mt-3 font-display text-3xl font-extrabold">{formatPlanPrice(plan)}<span className="ml-1 text-sm font-medium text-[#A1A1AA]">/{plan.billingMonths === 12 ? "year" : "month"}</span></p></div>{plan.featured && <span className="rounded-full border border-[#E5484D]/60 bg-[#E5484D]/15 px-2.5 py-1 text-[11px] font-bold text-[#FFB3BD]">Save 26%</span>}</div>
      <p className="mt-2 text-sm text-[#A1A1AA]">{formatCredits(plan.credits)} included</p>
      <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#232327] p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-[#A1A1AA]">Photos</p><p className="mt-1 text-lg font-bold">Up to {imageCount.toLocaleString()}</p><p className="text-[11px] text-[#A1A1AA]">8 credits each</p></div><div className="rounded-xl bg-[#232327] p-3"><p className="text-[11px] uppercase tracking-[0.12em] text-[#A1A1AA]">Videos</p><p className="mt-1 text-lg font-bold">Up to {videoCount.toLocaleString()}</p><p className="text-[11px] text-[#A1A1AA]">10 credits minimum</p></div></div>
      <div className="mt-4 flex-1 rounded-xl bg-[#232327] p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#A1A1AA]">Included</p><ul className="mt-3 space-y-2 text-xs leading-relaxed text-[#D4D4D8]">{plan.features.map((feature) => <li key={feature} className="flex gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#7FE0B0]" />{feature}</li>)}</ul></div>
      <p className="mt-3 text-[11px] leading-relaxed text-[#A1A1AA]">Video debit is max({creatorBilling.creditCosts.video}, {creatorBilling.creditCosts.videoPerSecond} x duration). Credits are not converted into guaranteed output counts.</p>
      <button type="button" disabled={isCurrent || isAdmin} onClick={() => onChoose(plan)} className={`mt-5 min-h-11 rounded-xl px-4 text-sm font-bold transition ${isCurrent ? "bg-[#232327] text-[#A1A1AA]" : isAdmin ? "border border-[#7FE0B0]/40 bg-[#7FE0B0]/10 text-[#B9F5D4]" : plan.featured ? "bg-white text-[#101012] hover:bg-[#E4E4E7]" : "border border-white/[0.16] text-white hover:bg-white/[0.08]"}`}>{buttonLabel}</button>
    </article>
  );
}

function PlansSection({ plans, currentPlan, isAdmin, onChoose }: { plans: readonly CreatorPlan[]; currentPlan: string | null; isAdmin: boolean; onChoose: (plan: CreatorPlan) => void }) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  useEffect(() => {
    if (currentPlan === "sub-creator-annual") setPeriod("yearly");
    else if (currentPlan === "sub-creator") setPeriod("monthly");
  }, [currentPlan]);
  const visiblePlans = plans.filter((plan) => plan.period === period);
  return <section id="plans" className="mt-14 scroll-mt-24"><div className="rounded-2xl border border-white/[0.1] bg-[#151519] p-5 sm:p-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#A1A1AA]">Plans & credits</p><h2 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">Pay for the renders you can use.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#A1A1AA]">These prices and credit balances come directly from the checkout tiers. Social and 18+ creator modes use the same render wallet; 18+ also requires age confirmation and an eligible plan.</p></div><div className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#19191C] p-1 text-xs font-semibold"><button type="button" onClick={() => setPeriod("monthly")} className={`min-h-10 rounded-full px-3 ${period === "monthly" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Monthly</button><button type="button" onClick={() => setPeriod("yearly")} className={`min-h-10 rounded-full px-3 ${period === "yearly" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Yearly</button><span className="rounded-full border border-[#7FE0B0]/30 bg-[#7FE0B0]/10 px-2 py-1 text-[10px] font-bold text-[#B9F5D4]">{creatorBilling.yearlyDiscountLabel}</span></div></div><div className="mt-6 grid gap-4 md:grid-cols-2">{visiblePlans.map((plan) => <PlanCard key={plan.tierId} plan={plan} currentPlan={currentPlan} isAdmin={isAdmin} onChoose={onChoose} />)}</div>{visiblePlans.length === 0 && <p className="mt-5 rounded-xl border border-dashed border-white/[0.14] p-5 text-center text-sm text-[#A1A1AA]">Pricing is loading from checkout.</p>}</div></section>;
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
  const [plans, setPlans] = useState<readonly CreatorPlan[]>(creatorPlans);
  const [sheet, setSheet] = useState<"auth" | "age" | "plan" | "gallery" | null>(null);
  const [galleryStartIndex, setGalleryStartIndex] = useState(0);
  const [showcasePaused, setShowcasePaused] = useState(false);
  const [promptFocused, setPromptFocused] = useState(false);

  const readyForRender = (item: CreatorModel) => isAdmin || models[0]?.id === item.id || unlocked.includes(item.id);
  const selectedIdentity = models.find((item) => item.id === model) ?? null;
  const selectedName = model === RANDOM_IDENTITY ? "Random identity" : selectedIdentity?.name ?? "Random identity";
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  const displayModels = useMemo(() => orderModelsForDisplay(models), [models]);
  const showcaseModels = useMemo(() => {
    const seen = new Set<string>();
    return displayModels.filter((item) => {
      const image = item.image_url?.trim();
      if (!image || seen.has(image)) return false;
      seen.add(image);
      return true;
    }).slice(0, showcaseConfig.length);
  }, [displayModels]);
  const showcaseItems = useMemo<ShowcaseItem[]>(() => showcaseModels.map((model, index) => {
    const configured = showcaseConfig[index] ?? showcaseConfig[0];
    const reel = getEffectiveCompanionReel(model);
    return {
      ...configured,
      id: model.id,
      type: reel && index % 3 === 1 ? "video" : configured.type,
      src: reel && index % 3 === 1 ? reel : model.image_url,
      poster: model.image_url,
      alt: `${model.name} creator reference`,
      label: model.name,
    };
  }), [showcaseModels]);
  const showcaseRailRef = useRef<HTMLDivElement>(null);
  const showcasePauseTimerRef = useRef<number | null>(null);
  const modelsRailRef = useRef<HTMLDivElement>(null);
  const sampleModels = useMemo(() => displayModels.filter((item) => item.id !== selectedIdentity?.id).slice(0, 6), [displayModels, selectedIdentity?.id]);
  const sampleRailRef = useRef<HTMLDivElement>(null);
  const scrollRail = (rail: RefObject<HTMLDivElement | null>, direction: number) => {
    rail.current?.scrollBy({ left: direction * Math.max(260, rail.current.clientWidth * 0.72), behavior: "smooth" });
  };
  const pauseShowcase = () => {
    if (showcasePauseTimerRef.current) window.clearTimeout(showcasePauseTimerRef.current);
    setShowcasePaused(true);
  };
  const resumeShowcase = () => {
    if (showcasePauseTimerRef.current) window.clearTimeout(showcasePauseTimerRef.current);
    showcasePauseTimerRef.current = window.setTimeout(() => setShowcasePaused(false), 2600);
  };
  const ownedModels = useMemo(() => displayModels.filter((item) => readyForRender(item)), [displayModels, unlocked, isAdmin]);
  const lockedModels = useMemo(() => displayModels.filter((item) => !readyForRender(item)), [displayModels, unlocked, isAdmin]);

  useEffect(() => {
    if (showcasePaused || showcaseItems.length < 2) return;
    const timer = window.setInterval(() => {
      const rail = showcaseRailRef.current;
      if (!rail) return;
      const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 20;
      if (atEnd) rail.scrollTo({ left: 0, behavior: "smooth" });
      else scrollRail(showcaseRailRef, 1);
    }, 4600);
    return () => window.clearInterval(timer);
  }, [showcaseItems.length, showcasePaused]);

  useEffect(() => () => {
    if (showcasePauseTimerRef.current) window.clearTimeout(showcasePauseTimerRef.current);
  }, []);

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
      const [{ data, error }, { data: auth }, pricing] = await Promise.all([
        supabase.from("companions").select("id,name,image_url,gender").order("sort_order"),
        supabase.auth.getUser(),
        getPricing().catch(() => null),
      ]);
      if (!active) return;
      if (error) setLoadError("Models could not be loaded. Refresh and try again.");
      const companionRows = (data ?? []) as CreatorModel[];
      setModels(companionRows);
      if (pricing?.tiers?.length) setPlans(creatorPlansFromTiers(pricing.tiers));
      const requested = search.model;
      const visualFirst = orderModelsForDisplay(companionRows)[0];
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
    navigate({ to: "/credits", search: { plan: plan.tierId, returnTo: "/create-media" } as never });
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
      <main className="mx-auto max-w-[1200px] px-4 pb-36 sm:px-6 lg:pb-16">
        <section id="showcase" className="scroll-mt-24 pt-4 sm:pt-8">
          <div className="rounded-2xl border border-white/[0.1] bg-[#18181B] px-4 py-4 shadow-[0_18px_55px_rgba(0,0,0,.18)] sm:px-6 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-3xl">Make the scene yours.</h1>
              <button type="button" onClick={() => { setGalleryStartIndex(0); setSheet("gallery"); }} className="hidden min-h-11 shrink-0 items-center rounded-full border border-white/[0.16] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.08] sm:inline-flex">View gallery</button>
            </div>
            <div
              ref={showcaseRailRef}
              onPointerDown={pauseShowcase}
              onPointerUp={resumeShowcase}
              onPointerCancel={resumeShowcase}
              onPointerLeave={resumeShowcase}
              className="flex max-h-[175px] snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-h-[188px]"
              aria-label="Social-safe creator showcase"
            >
              {showcaseItems.map((item, index) => <ShowcaseCard key={item.id} item={item} index={index} onOpen={(selectedIndex) => { setGalleryStartIndex(selectedIndex); setSheet("gallery"); }} />)}
            </div>
            <div className="mt-3 flex justify-end sm:hidden"><button type="button" onClick={() => { setGalleryStartIndex(0); setSheet("gallery"); }} className="min-h-11 rounded-full border border-white/[0.16] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.08]">View gallery</button></div>
          </div>
        </section>

        <section id="models" className="scroll-mt-24 pt-4 sm:pt-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Choose your model</h2><p className="mt-1 text-sm text-[#A1A1AA]">Select a face to keep consistent in your render.</p></div><Link to="/models" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">Browse all</Link></div><div className="relative mt-4"><button type="button" aria-label="Scroll models left" onClick={() => scrollRail(modelsRailRef, -1)} className="absolute left-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.18] bg-[#101012]/90 text-white shadow-lg"><ArrowLeft className="h-4 w-4" /></button><div ref={modelsRailRef} className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link to="/create" className="relative flex w-[148px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-xl border border-white/[0.1] bg-[#19191C] p-4 text-left transition hover:border-white/[0.25] sm:w-[220px]"><span className="grid aspect-[3/4] place-items-center rounded-lg bg-[#232327]"><Sparkles className="h-8 w-8 text-white" /></span><span className="mt-3 text-sm font-bold">Create your own</span><span className="mt-1 text-xs text-[#A1A1AA]">Build a new character</span></Link>
          {[...ownedModels, ...lockedModels].map((item) => <article key={item.id} className={`w-[148px] shrink-0 snap-start overflow-hidden rounded-xl border bg-[#19191C] sm:w-[220px] ${model === item.id ? "border-[#E5484D] ring-2 ring-[#E5484D]/30" : "border-white/[0.1]"}`}><button type="button" aria-pressed={model === item.id} onClick={() => { if (readyForRender(item)) setModel(item.id); setPreviewModel(item); }} className="block w-full text-left"><img src={item.image_url} alt={item.name} loading="lazy" className="aspect-[3/4] w-full object-cover object-top" /><div className="p-3"><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-[#A1A1AA]">{model === item.id ? "Selected" : readyForRender(item) ? "Owned" : "Unlock for 50 credits"}</p></div></button>{!readyForRender(item) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(item)} className="mx-3 mb-3 min-h-10 w-[calc(100%-1.5rem)] rounded-lg border border-white/[0.14] px-2 text-xs font-semibold text-white hover:bg-white/[0.08]">{unlockingModel ? "Unlocking..." : "Unlock"}</button>}</article>)}
        </div><button type="button" aria-label="Scroll models right" onClick={() => scrollRail(modelsRailRef, 1)} className="absolute right-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.18] bg-[#101012]/90 text-white shadow-lg"><ArrowRight className="h-4 w-4" /></button></div>{selectedIdentity && sampleModels.length > 0 && <div className="mt-5"><div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A1A1AA]">More faces</p><p className="mt-1 text-xs text-[#8E858C]">Different references, no repeats</p></div><div className="flex gap-2"><button type="button" aria-label="Scroll more faces left" onClick={() => scrollRail(sampleRailRef, -1)} className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.15] bg-[#19191C] text-white"><ArrowLeft className="h-3.5 w-3.5" /></button><button type="button" aria-label="Scroll more faces right" onClick={() => scrollRail(sampleRailRef, 1)} className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.15] bg-[#19191C] text-white"><ArrowRight className="h-3.5 w-3.5" /></button></div></div><div ref={sampleRailRef} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={`${selectedIdentity.name} related models`}>{sampleModels.map((item) => <figure key={item.id} className="w-[150px] shrink-0 snap-start"><img src={item.image_url} alt={item.name} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover object-top" /><figcaption className="mt-2 text-xs font-semibold text-[#D4D4D8]">{item.name}</figcaption></figure>)}</div></div>}</section>

        <section id="mode" className="mt-8 scroll-mt-24"><div className="rounded-2xl border border-white/[0.1] bg-[#19191C] p-4 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A1A1AA]">Step 2</p><h2 className="mt-1 text-lg font-bold">Choose your mode</h2><p className="mt-1 text-sm leading-relaxed text-[#A1A1AA]">Social keeps prompts and outputs suitable for public feeds. 18+ requires age confirmation and an eligible creator plan.</p></div><div role="radiogroup" aria-label="Content mode" className="mt-4 flex w-full rounded-xl border border-white/[0.12] bg-[#232327] p-1 sm:mt-0 sm:w-auto"><button type="button" role="radio" aria-checked={contentMode === "social"} onClick={() => selectMode("social")} className={`min-h-11 flex-1 rounded-lg px-5 text-sm font-semibold sm:flex-none ${contentMode === "social" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Social</button><button type="button" role="radio" aria-checked={contentMode === "adult"} onClick={() => selectMode("adult")} className={`min-h-11 flex-1 rounded-lg px-5 text-sm font-semibold sm:flex-none ${contentMode === "adult" ? "bg-[#E5484D] text-white" : "text-[#A1A1AA]"}`}>18+</button></div></div></section>

        <section id="create" className="mt-8 scroll-mt-24"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Step 3</p><h2 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">Describe the scene</h2></div><span className="rounded-full border border-white/[0.12] px-3 py-2 text-xs font-semibold text-[#A1A1AA]">{selectedName}</span></div><section className="mt-4 rounded-2xl border border-white/[0.1] bg-[#19191C] p-4 sm:p-6"><div className="flex rounded-xl border border-white/[0.12] bg-[#232327] p-1" role="tablist" aria-label="Output type">{(["image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${kind === value ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>{value === "image" ? "Photo" : "Video"}</button>)}</div><label htmlFor="creator-prompt" className="sr-only">Describe your scene</label><textarea id="creator-prompt" value={prompt} maxLength={2000} onFocus={() => setPromptFocused(true)} onBlur={() => setPromptFocused(false)} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the pose, outfit, setting, lighting, and action..." className="mt-4 min-h-[120px] w-full resize-y rounded-xl border border-white/[0.12] bg-[#101012] p-4 text-base leading-relaxed text-white outline-none placeholder:text-[#71717A] focus:border-white focus:ring-2 focus:ring-white/20 sm:min-h-[180px]" /><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#A1A1AA]"><span>{prompt.length} / 2000</span><button type="button" onClick={surpriseMe} className="min-h-10 rounded-lg border border-white/[0.14] px-3 font-semibold text-white hover:bg-white/[0.08]">Surprise me</button></div><div className="mt-5 flex flex-col gap-4 border-t border-white/[0.08] pt-5"><div><p className="text-xs font-semibold text-[#A1A1AA]">Frame size</p><div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key as keyof typeof sizes)} className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-semibold capitalize ${size === key ? "border-white bg-white text-[#101012]" : "border-white/[0.14] text-[#A1A1AA] hover:text-white"}`}>{key} · {width}×{height}</button>)}</div></div>{kind === "video" && <div><p className="text-xs font-semibold text-[#A1A1AA]">Duration</p><div className="mt-2 flex gap-2 overflow-x-auto pb-1">{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-semibold ${seconds === value ? "border-white bg-white text-[#101012]" : "border-white/[0.14] text-[#A1A1AA]"}`}>{value}s</button>)}</div></div>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#A1A1AA]">Estimated cost <span className="font-bold text-white">{cost} credits</span>{contentMode === "adult" && <span className="ml-2 text-xs text-[#E5484D]">18+ rate</span>}</p><button type="button" aria-disabled={busy || prompt.trim().length < 3} disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="min-h-12 w-full rounded-xl bg-white px-5 text-sm font-bold text-[#101012] transition hover:bg-[#E4E4E7] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">{busy ? "Queuing…" : `Generate · ${cost} credits`}</button></div></div>{renderStatus}{loadError && <p className="mt-3 text-sm text-[#FF8C8C]">{loadError}</p>}</section></section>

        <PlansSection plans={plans} currentPlan={subscriptionTier} isAdmin={isAdmin} onChoose={choosePlan} />

        <section id="book-call" className="mt-12 scroll-mt-24 rounded-2xl border border-white/[0.1] bg-[#19191C] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7"><div><p className="text-xs font-semibold text-[#A1A1AA]">Done-for-you</p><h2 className="mt-1 font-display text-2xl font-extrabold">Want the whole AI creator business built for you?</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A1A1AA]">One model identity, a launch-ready library, and a handoff you can operate. We’ll reply with next steps.</p></div><a href={BOOK_CALL_SMS} className="mt-5 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-bold text-[#101012] sm:mt-0">Book a call</a></section>

        {credits !== null && <section id="renders" className="mt-12 scroll-mt-24"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Your renders</p><h2 className="mt-1 font-display text-2xl font-extrabold">Recent work</h2></div><Link to="/library" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">See more <ChevronRight className="inline h-4 w-4" /></Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{activeJob && activeJob.status !== "completed" && <div className="flex aspect-[4/5] animate-pulse items-end rounded-xl border border-dashed border-white/[0.18] bg-[#19191C] p-3 text-xs font-semibold">Rendering…</div>}{library.slice(0, activeJob && activeJob.status !== "completed" ? 5 : 6).map((item) => <Link to="/library" search={{ item: item.id } as never} key={item.id} className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.1] bg-[#19191C] text-left">{item.kind === "video" ? <video muted preload="metadata" className="pointer-events-none h-full w-full object-cover" src={item.media_url ?? undefined} /> : <img src={item.media_url ?? ""} alt="Saved render" loading="lazy" draggable={false} className="pointer-events-none h-full w-full object-cover transition group-hover:scale-105" />}<span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold">{item.kind === "video" ? "Video" : "Photo"}</span></Link>)}</div>{library.length === 0 && !activeJob && <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] p-8 text-center text-sm text-[#A1A1AA]">Your completed renders will appear here.</p>}</section>}
      </main>
      {!promptFocused && <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 border-t border-white/[0.12] bg-[#101012]/95 px-4 py-2 backdrop-blur-xl lg:hidden"><button type="button" disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="min-h-12 w-full rounded-xl bg-white px-5 text-sm font-bold text-[#101012] disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Queuing…" : `Generate · ${cost} credits`}</button></div>}
      <CreatorFooter />
      <style>{`@media (max-width:639px){button[aria-label^="Scroll models"]{display:none!important}}`}</style>
      {previewModel && <CreatorSheet open onClose={() => setPreviewModel(null)} title={`${previewModel.name} preview`}><img src={previewModel.image_url} alt={previewModel.name} className="max-h-[60dvh] w-full rounded-xl object-cover object-top" /><p className="mt-4 text-sm text-[#A1A1AA]">{readyForRender(previewModel) ? "Owned identity. This face will stay consistent." : "Unlock this identity to keep the face consistent in your renders."}</p>{!readyForRender(previewModel) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(previewModel)} className="mt-4 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-50">{unlockingModel ? "Unlocking…" : "Unlock for 50 credits"}</button>}</CreatorSheet>}
      <CreatorSheet open={sheet === "auth"} onClose={() => setSheet(null)} title="Sign in to continue"><p className="text-sm leading-relaxed text-[#A1A1AA]">Create an account or sign in to save renders, use your credits, and keep an identity consistent.</p><Link to="/auth" search={{ redirect: "/create-media" } as never} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white text-sm font-bold text-[#101012]">Open sign in</Link></CreatorSheet>
      <CreatorSheet open={sheet === "age"} onClose={() => setSheet(null)} title="Confirm your age"><label className="flex items-start gap-3 text-sm leading-relaxed text-[#A1A1AA]"><input type="checkbox" checked={ageAgreed} onChange={(event) => setAgeAgreed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#E5484D]" /><span>I confirm that I am 18 or older and agree to the Terms and Privacy Policy.</span></label><button type="button" disabled={!ageAgreed} onClick={() => { void agreeToAdultMode(); setSheet(null); setContentMode("adult"); }} className="mt-5 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-40">Continue to 18+</button></CreatorSheet>
      <CreatorSheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Choose a plan"><p className="text-sm leading-relaxed text-[#A1A1AA]">A creator plan unlocks the render wallet. Social is available for eligible credits; 18+ also requires age confirmation. Checkout uses these exact live tiers.</p><div className="mt-4 grid gap-3">{plans.map((plan) => <button type="button" key={plan.tierId} onClick={() => choosePlan(plan)} className="flex min-h-14 items-center justify-between rounded-xl border border-white/[0.12] px-4 text-left hover:bg-white/[0.08]"><span><span className="block font-semibold">{plan.name}</span><span className="block text-xs text-[#A1A1AA]">{formatPlanPrice(plan)} · {formatCredits(plan.credits)}</span></span><ChevronRight className="h-4 w-4" /></button>)}</div></CreatorSheet>
      <CreatorSheet open={sheet === "gallery"} onClose={() => setSheet(null)} title="Creator gallery"><p className="mb-4 text-sm text-[#A1A1AA]">Viewing {showcaseItems[galleryStartIndex]?.label ?? "the creator showcase"}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{showcaseItems.map((item, index) => <button type="button" key={item.id} onClick={() => setGalleryStartIndex(index)} aria-pressed={index === galleryStartIndex} className={`overflow-hidden rounded-xl border text-left transition ${index === galleryStartIndex ? "border-white ring-2 ring-white/25" : "border-white/[0.1]"}`}><img src={item.poster} alt={item.alt} loading="lazy" className="aspect-[3/4] w-full object-cover" /><span className="block p-2 text-xs font-semibold text-white">{item.label}</span></button>)}</div><Link to="/gallery" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/[0.14] text-sm font-semibold">View more</Link></CreatorSheet>
    </div>
  );
}
