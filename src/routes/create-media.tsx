import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Bolt, Check, ChevronRight, Clapperboard, Compass, Copy, Flame, Globe, Image as ImageIcon, Menu, MessageCircle, Sparkles, SquarePlus, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { confirmAge, getPricing } from "@/lib/payments.functions";
import { totalCredits } from "@/lib/credits";
import { toast } from "sonner";
import { LogoLink } from "@/components/Logo";
import { CreatorSheet } from "@/components/creator/CreatorSheet";
import { ReelMedia } from "@/components/creator/ReelMedia";
import { resizedImage } from "@/lib/companion-images";
import { hasSocialExplicitTerms } from "@/lib/social-safety";
import { AuthModal } from "@/components/auth/AuthModal";
import { creatorBilling, creatorPlans, creatorPlansFromTiers, estimatedPlanMedia, formatCredits, formatPlanPrice, yearlySavingsLabel, type BillingPeriod, type CreatorPlan } from "@/config/plans";
import { getNextGate } from "@/lib/creator-gates";
import { showcaseConfig } from "@/config/showcase";
import { orderModelsForDisplay } from "@/lib/display-models";
import { getEffectiveCompanionReel } from "@/lib/reels";
import { goBackOrExplore } from "@/lib/back-navigation";

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
/** How many models the picker opens with; the banner features the ones after. */
const PICKER_LEAD = 6;
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

type Preset = { name: string; tag: string; kind: "image" | "video"; prompt: string };
const PRESETS: readonly Preset[] = [
  { name: "Golden-hour rooftop", tag: "Lifestyle", kind: "image", prompt: "A warm rooftop portrait at golden hour, relaxed smile, cream linen shirt." },
  { name: "City night walk", tag: "Reel", kind: "video", prompt: "A slow cinematic walk past glowing city lights at night, tailored black outfit, glancing back at the camera." },
  { name: "Mirror selfie", tag: "Social", kind: "image", prompt: "A casual mirror selfie in a bright modern bedroom, oversized knit sweater, phone in hand, natural light." },
  { name: "Beach breeze", tag: "Reel", kind: "video", prompt: "Hair moving in a warm sea breeze on a sunny beach, linen sundress, smiling at the camera." },
  { name: "Coffee run", tag: "Street", kind: "image", prompt: "A candid street-style photo outside a coffee shop, denim jacket and natural light." },
  { name: "Studio editorial", tag: "Fashion", kind: "image", prompt: "A clean fashion editorial against a warm studio backdrop, confident posture." },
  { name: "Poolside afternoon", tag: "Summer", kind: "image", prompt: "A polished poolside portrait in an opaque one-piece swimsuit, bright summer light." },
  { name: "Gym check-in", tag: "Fitness", kind: "image", prompt: "A bright gym mirror photo in a matching athletic set, confident pose, clean modern gym." },
  { name: "Night out", tag: "Lifestyle", kind: "video", prompt: "Getting ready for a night out, fixing her hair in a warm-lit mirror, satin slip dress, playful smile." },
  { name: "Cozy café", tag: "Social", kind: "image", prompt: "A cozy café window seat on a rainy afternoon, holding a latte, soft knit cardigan, warm tones." },
  { name: "Road trip", tag: "Reel", kind: "video", prompt: "Wind in her hair in the passenger seat of a convertible on a coastal road, sunglasses, laughing." },
  { name: "Red carpet", tag: "Fashion", kind: "image", prompt: "A glamorous red-carpet portrait in a floor-length evening gown, camera flashes, confident pose." },
];
const PRESET_TAGS = ["All", ...Array.from(new Set(PRESETS.map((preset) => preset.tag)))];

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

function CreatorNav({ credits, onSignIn }: { credits: number | null; onSignIn: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#101012]/95 backdrop-blur-xl lg:border-b-0 lg:bg-transparent lg:px-6 lg:pt-3 lg:backdrop-blur-none">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:max-w-[1400px] lg:rounded-full lg:border lg:border-white/[0.1] lg:bg-[#18181B]/85 lg:px-5 lg:shadow-[0_12px_40px_rgba(0,0,0,.35)] lg:backdrop-blur-xl">
        <button type="button" aria-label="Back" onClick={() => goBackOrExplore()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[0.12] text-white transition hover:bg-white/[0.08] lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <LogoLink className="h-8 shrink-0" />
        <nav aria-label="Primary" className="ml-2 hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
          <Link to="/browse" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><Compass className="h-4 w-4" /> Explore</Link>
          <Link to="/me" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><MessageCircle className="h-4 w-4" /> Chat</Link>
          <Link to="/create" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><SquarePlus className="h-4 w-4" /> Create</Link>
          <Link to="/create-media" className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-2 text-sm font-semibold text-white"><Sparkles className="h-4 w-4" /> Generate</Link>
          <Link to="/library" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-[#B3A9B0] transition hover:bg-white/[0.06] hover:text-white"><Copy className="h-4 w-4" /> My AI</Link>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {credits === null ? <button type="button" onClick={onSignIn} className="inline-flex min-h-11 items-center rounded-full border border-white/[0.12] px-3 text-xs font-semibold text-white sm:text-sm">Sign in</button> : <Link to="/credits" className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/[0.12] px-2.5 text-xs font-semibold text-white sm:min-h-10 sm:gap-1.5 sm:px-4 sm:text-sm">
            <Bolt className="h-4 w-4 text-white" />
            <span>{credits === null ? "--" : credits}</span><span className="hidden text-[#B3A9B0] sm:inline">credits</span>
          </Link>}
          {credits !== null && <Link to="/me" aria-label="Open account" className="grid h-9 w-9 place-items-center rounded-full bg-[#2E2730] text-sm font-bold text-white sm:h-10 sm:w-10">G</Link>}
          <button type="button" aria-label="Open creator menu" onClick={() => setMenuOpen(true)} className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] text-white sm:hidden"><Menu className="h-5 w-5" /></button>
        </div>
      </div>
      <CreatorSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu"><nav className="grid gap-2" aria-label="Creator menu"><Link onClick={() => setMenuOpen(false)} to="/browse" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Explore</Link><Link onClick={() => setMenuOpen(false)} to="/me" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Chat</Link><Link onClick={() => setMenuOpen(false)} to="/create" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Create</Link><Link onClick={() => setMenuOpen(false)} to="/create-media" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Generate</Link><Link onClick={() => setMenuOpen(false)} to="/library" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">My AI</Link><a onClick={() => setMenuOpen(false)} href="#plans" className="flex min-h-12 items-center rounded-xl border border-white/[0.1] px-4 font-semibold">Plans</a>{credits === null && <button type="button" onClick={() => { setMenuOpen(false); onSignIn(); }} className="flex min-h-12 items-center rounded-xl bg-white px-4 font-semibold text-[#101012]">Sign in</button>}</nav></CreatorSheet>
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

const HERO_WORDS = ["yours.", "iconic.", "bold.", "real."];

/** The hero's last word, cycling. Static under reduced motion (CSS). */
function RotatingWord() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % HERO_WORDS.length), 2600);
    return () => window.clearInterval(timer);
  }, []);
  return <span key={index} className="hc-word bg-gradient-to-r from-white to-[#A1A1AA] bg-clip-text text-transparent">{HERO_WORDS[index]}</span>;
}

function ShowcaseCard({ item, index, onOpen }: { item: ShowcaseItem; index: number; onOpen: (index: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
      className="hc-rise group relative aspect-[3/4] w-[130px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/[0.1] text-left shadow-[0_10px_25px_rgba(0,0,0,.25)] transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-[145px]"
      aria-label={`Open ${item.label} in the gallery`}
    >
      <ReelMedia reel={item.type === "video" ? item.src : null} poster={item.poster} alt={item.alt} eager={index < 3} className="h-full w-full transition duration-500 group-hover:scale-[1.04]" />
      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm"><span className="h-1.5 w-1.5 rounded-full bg-[#7FE0B0] motion-safe:animate-pulse" />In motion</span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-3 pb-3 pt-10 text-xs font-semibold text-white">{item.label}</span>
    </button>
  );
}

function PlanCard({ plan, currentPlan, isAdmin, onChoose, savings }: {
  plan: CreatorPlan;
  savings: string | null;
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
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">{plan.billingMonths === 12 ? "Best value" : "Flexible start"}</p><p className="mt-2 font-display text-2xl font-extrabold">{plan.name}</p><p className="mt-3 font-display text-3xl font-extrabold">{formatPlanPrice(plan)}<span className="ml-1 text-sm font-medium text-[#A1A1AA]">/{plan.billingMonths === 12 ? "year" : "month"}</span></p></div>{plan.featured && savings && <span className="rounded-full border border-[#E5484D]/60 bg-[#E5484D]/15 px-2.5 py-1 text-[11px] font-bold text-[#FFB3BD]">{savings}</span>}</div>
      <p className="mt-2 text-sm text-[#A1A1AA]">{formatCredits(plan.credits)} included</p>
      <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#232327] p-3"><p className="text-[11px] text-[#A1A1AA]">Photos</p><p className="mt-1 text-lg font-bold">Up to {imageCount.toLocaleString()}</p><p className="text-[11px] text-[#A1A1AA]">8 credits each</p></div><div className="rounded-xl bg-[#232327] p-3"><p className="text-[11px] text-[#A1A1AA]">Videos</p><p className="mt-1 text-lg font-bold">Up to {videoCount.toLocaleString()}</p><p className="text-[11px] text-[#A1A1AA]">3s clips, {creatorBilling.creditCosts.video} credits each</p></div></div>
      <div className="mt-4 flex-1 rounded-xl bg-[#232327] p-4"><p className="text-xs font-semibold text-[#A1A1AA]">Included</p><ul className="mt-3 space-y-2 text-xs leading-relaxed text-[#D4D4D8]">{plan.features.map((feature) => <li key={feature} className="flex gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#7FE0B0]" />{feature}</li>)}</ul></div>
      <p className="mt-3 text-[11px] leading-relaxed text-[#A1A1AA]">A video costs {creatorBilling.creditCosts.videoPerSecond} credits per second, {creatorBilling.creditCosts.video} minimum. Mix photos and videos however you like.</p>
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
  const savings = yearlySavingsLabel(plans);
  return <section id="plans" className="mt-14 scroll-mt-24"><div className="rounded-2xl border border-white/[0.1] bg-[#151519] p-5 sm:p-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold text-[#A1A1AA]">Plans & credits</p><h2 className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">Pay for the renders you can use.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#A1A1AA]">These prices and credit balances come directly from the checkout tiers. Social and 18+ creator modes use the same render wallet; 18+ also requires age confirmation and an eligible plan.</p></div><div className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#19191C] p-1 text-xs font-semibold"><button type="button" onClick={() => setPeriod("monthly")} className={`min-h-10 rounded-full px-3 ${period === "monthly" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Monthly</button><button type="button" onClick={() => setPeriod("yearly")} className={`min-h-10 rounded-full px-3 ${period === "yearly" ? "bg-white text-[#101012]" : "text-[#A1A1AA]"}`}>Yearly</button><span className="rounded-full border border-[#7FE0B0]/30 bg-[#7FE0B0]/10 px-2 py-1 text-[10px] font-bold text-[#B9F5D4]">{savings}</span></div></div><div className="mt-6 grid gap-4 md:grid-cols-2">{visiblePlans.map((plan) => <PlanCard key={plan.tierId} plan={plan} currentPlan={currentPlan} isAdmin={isAdmin} onChoose={onChoose} savings={savings} />)}</div>{visiblePlans.length === 0 && <p className="mt-5 rounded-xl border border-dashed border-white/[0.14] p-5 text-center text-sm text-[#A1A1AA]">Pricing is loading from checkout.</p>}</div></section>;
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
  // The sticky Generate bar waits for the first scroll so the banner and
  // model picker own the first screen on short phones.
  const [scrolledPastTop, setScrolledPastTop] = useState(false);
  useEffect(() => {
    const sync = () => setScrolledPastTop(window.scrollY > 120);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  const restoreScrollRef = useRef<number | null>(null);

  // Every signed-out gate saves the draft first, so the user comes back to
  // the same model, mode, prompt and scroll position after signing in.
  function openAuthGate() {
    try { sessionStorage.setItem("hc_creator_intent", JSON.stringify({ model, contentMode, prompt, kind, seconds, size, scrollY: window.scrollY })); } catch { /* Private mode: sign-in still works, the draft is just not kept. */ }
    setSheet("auth");
  }

  // The auth sheet and /auth route both return here. Restore only the local
  // draft that was already captured before the gate; credit and adult checks
  // still run again when the user presses Generate.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("hc_creator_intent");
      if (!stored) return;
      const intent = JSON.parse(stored) as Partial<{ model: string; contentMode: "social" | "adult"; prompt: string; kind: "image" | "video"; seconds: number; size: keyof typeof sizes; scrollY: number }>;
      if (typeof intent.model === "string") setModel(intent.model);
      if (intent.contentMode === "social" || intent.contentMode === "adult") setContentMode(intent.contentMode);
      if (typeof intent.prompt === "string") setPrompt(intent.prompt);
      if (intent.kind === "image" || intent.kind === "video") setKind(intent.kind);
      if (typeof intent.seconds === "number" && [3, 5, 8, 10].includes(intent.seconds)) setSeconds(intent.seconds);
      if (intent.size && intent.size in sizes) setSize(intent.size);
      if (typeof intent.scrollY === "number") restoreScrollRef.current = intent.scrollY;
      sessionStorage.removeItem("hc_creator_intent");
    } catch {
      sessionStorage.removeItem("hc_creator_intent");
    }
  }, []);

  const readyForRender = (item: CreatorModel) => isAdmin || models[0]?.id === item.id || unlocked.includes(item.id);
  const selectedIdentity = models.find((item) => item.id === model) ?? null;
  const selectedName = model === RANDOM_IDENTITY ? "Random identity" : selectedIdentity?.name ?? "Random identity";
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  const displayModels = useMemo(() => orderModelsForDisplay(models), [models]);
  // The banner shows different women from the ones the picker leads with, and
  // shows them moving: every catalog model has a reel cut from her portrait.
  // The first few in display order are the picker's opening cards, so the
  // banner starts after them and only tops up from the front if it runs short.
  const showcaseModels = useMemo(() => {
    const seen = new Set<string>();
    const unique = displayModels.filter((item) => {
      const image = item.image_url?.trim();
      if (!image || seen.has(image) || !getEffectiveCompanionReel(item)) return false;
      seen.add(image);
      return true;
    });
    const fresh = unique.slice(PICKER_LEAD);
    return [...fresh, ...unique.slice(0, PICKER_LEAD)].slice(0, showcaseConfig.length);
  }, [displayModels]);
  const showcaseItems = useMemo<ShowcaseItem[]>(() => showcaseModels.map((model, index) => ({
    ...(showcaseConfig[index] ?? showcaseConfig[0]),
    id: model.id,
    type: "video" as const,
    src: getEffectiveCompanionReel(model) ?? model.image_url,
    poster: model.image_url,
    alt: `${model.name} creator reference`,
    label: model.name,
  })), [showcaseModels]);
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const presetModels = useMemo(() => {
    const used = new Set(showcaseModels.map((item) => item.id));
    const withReel = displayModels.filter((item) => getEffectiveCompanionReel(item));
    const pool = withReel.slice(PICKER_LEAD).filter((item) => !used.has(item.id));
    const source = pool.length >= 4 ? pool : withReel;
    return source.length ? PRESETS.map((_, index) => source[index % source.length]) : [];
  }, [displayModels, showcaseModels]);
  const studioRef = useRef<HTMLElement>(null);
  const presetsRef = useRef<HTMLElement>(null);
  const [presetTag, setPresetTag] = useState("All");
  const usePreset = (preset: Preset) => {
    setPrompt(preset.prompt);
    setKind(preset.kind);
    studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const showcaseRailRef = useRef<HTMLDivElement>(null);
  const showcasePauseTimerRef = useRef<number | null>(null);
  const modelsRailRef = useRef<HTMLDivElement>(null);
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
      // A model restored from the pre-auth draft is already in state; keep it
      // unless the URL names one explicitly.
      if (visualFirst) setModel((current) => requested && companionRows.some((item) => item.id === requested) ? requested : current === RANDOM_IDENTITY || companionRows.some((item) => item.id === current) ? current : visualFirst.id);
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
    if (loading || restoreScrollRef.current === null) return;
    const top = restoreScrollRef.current;
    restoreScrollRef.current = null;
    requestAnimationFrame(() => window.scrollTo({ top }));
  }, [loading]);

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
    if (credits === null) { setPreviewModel(null); openAuthGate(); return; }
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

  /**
   * A nude request in Social: entitled users are told to switch to 18+, the
   * rest also get the Creator plan sheet that includes it.
   */
  function refuseNudeInSocial(canSwitch: boolean) {
    if (canSwitch) {
      toast.error("Nudity isn't available in Social mode. Switch to 18+ to render this.", { action: { label: "Switch to 18+", onClick: () => selectMode("adult") } });
      return;
    }
    toast.error("Nudity needs 18+ mode, which comes with the Creator plan.");
    setSheet("plan");
  }

  async function submit() {
    const gate = getNextGate({ signedIn: credits !== null, isAdmin, ageConfirmed: ageAgreed, hasAdultPlan: creatorSubscription, hasActivePlan: creatorSubscription, credits }, "generate", cost);
    if (contentMode === "adult" && !ageAgreed) { setSheet("age"); return; }
    if (gate.kind === "auth") { openAuthGate(); return; }
    // Social never renders nudity. Checked here so nothing is sent or charged;
    // the server refuses the same prompt with the same two outcomes.
    if (contentMode === "social" && hasSocialExplicitTerms(prompt)) { refuseNudeInSocial(isAdmin || creatorSubscription); return; }
    if (gate.kind !== "allow") {
      sessionStorage.setItem("hc_creator_intent", JSON.stringify({ model, contentMode, prompt, kind, seconds, size }));
      if (gate.kind === "age") setSheet("age");
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
      if (message.includes("SOCIAL_EXPLICIT_SWITCH")) refuseNudeInSocial(true);
      else if (message.includes("SOCIAL_EXPLICIT_PLAN")) refuseNudeInSocial(false);
      else if (message.includes("AGE_CONFIRMATION_REQUIRED")) toast.error("Confirm your age before using adult mode.");
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
    else if (gate.kind === "auth") openAuthGate();
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
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-white/[0.24] bg-white/[0.035] px-4 py-3 text-sm">
      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${activeJob.status === "completed" ? "bg-[#7FE0B0]" : activeJob.status === "failed" ? "bg-[#FF8C8C]" : "animate-pulse bg-white"}`} />{activeJob.status === "completed" ? "Render complete." : activeJob.status === "failed" ? "Render failed." : `Rendering your ${activeJob.kind}...`}</span>
      <Link to="/library" className="font-semibold text-white hover:text-[#D4D4D8]">Open library <ChevronRight className="inline h-4 w-4" /></Link>
    </div>
  );

  return (
    <div className="relative isolate min-h-screen bg-[#101012] text-[#F4F4F5]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] overflow-hidden">
        {selectedIdentity && <img key={selectedIdentity.id} src={resizedImage(selectedIdentity.image_url, 160, 50)} alt="" decoding="async" className="hc-fade h-full w-full scale-125 object-cover object-top opacity-[.28] blur-3xl" />}
        <div className="absolute inset-0 bg-[radial-gradient(120%_60%_at_50%_0%,transparent,#101012_75%)]" />
      </div>
      <CreatorNav credits={credits} onSignIn={openAuthGate} />
      <main className="mx-auto max-w-[1200px] px-4 pb-36 sm:px-6 lg:max-w-[1400px] lg:pb-16">
        <section id="showcase" className="scroll-mt-24 pt-3 sm:pt-8 lg:pt-6">
          <div className="hidden gap-4 lg:grid lg:grid-cols-3">{([
            { title: "Photo shoot", line: "Your model. Any scene.", face: showcaseModels[0], go: () => { setKind("image"); studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } },
            { title: "Short reels", line: "Bring her to life in 3 to 10 seconds.", face: showcaseModels[1], go: () => { setKind("video"); studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } },
            { title: "Presets", line: "One tap, ready to post.", face: showcaseModels[2], go: () => presetsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }) },
          ]).map((tile, index) => <button key={tile.title} type="button" onClick={tile.go} style={{ animationDelay: `${index * 80}ms` }} className="hc-rise group relative h-[230px] overflow-hidden rounded-2xl border border-white/[0.08] text-left shadow-[0_18px_50px_rgba(0,0,0,.35)]">
            {tile.face && <ReelMedia reel={getEffectiveCompanionReel(tile.face)} poster={tile.face.image_url} posterWidth={900} alt="" eager className="absolute inset-0 h-full w-full transition duration-700 group-hover:scale-[1.05]" />}
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <span className="absolute inset-x-0 bottom-7 text-center"><span className="block font-display text-[28px] font-extrabold tracking-[-0.02em] text-white drop-shadow">{tile.title}</span><span className="mt-1 block text-sm text-white/80">{tile.line}</span></span>
          </button>)}</div>
          <div className="lg:hidden sm:rounded-2xl sm:border sm:border-white/[0.1] sm:bg-[#18181B] sm:px-6 sm:py-5 sm:shadow-[0_18px_55px_rgba(0,0,0,.18)]">
            <div className="mb-2 flex items-center justify-between gap-3 sm:mb-3 sm:gap-4">
              <h1 className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.03em] text-white min-[400px]:text-[22px] sm:text-3xl">Make the scene <RotatingWord /></h1>
              <button type="button" onClick={() => { setGalleryStartIndex(0); setSheet("gallery"); }} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/[0.16] px-3.5 text-sm font-semibold text-white transition hover:bg-white/[0.08] sm:px-4">View gallery</button>
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
            
          </div>
        </section>

        <section id="models" className="scroll-mt-24 pt-4 sm:pt-7"><div className="flex items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Choose your model</h2><p className="mt-1 hidden text-sm sm:block text-[#A1A1AA]">Select a face to keep consistent in your render.</p></div><Link to="/models" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">Browse all</Link></div><div className="relative mt-3 sm:mt-4"><button type="button" aria-label="Scroll models left" onClick={() => scrollRail(modelsRailRef, -1)} className="absolute left-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.18] bg-[#101012]/90 text-white shadow-lg"><ArrowLeft className="h-4 w-4" /></button><div ref={modelsRailRef} className="flex items-start snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => { if (credits === null) openAuthGate(); else navigate({ to: "/create" }); }} className="hc-rise group relative flex aspect-[3/4] w-[148px] shrink-0 snap-start flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-white/[0.22] bg-[radial-gradient(circle_at_50%_35%,#2A2A30,#16161A_70%)] p-4 text-center transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.4] sm:w-[200px]"><span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.08] transition duration-300 group-hover:scale-110 group-hover:bg-white/[0.14]"><Sparkles className="h-6 w-6 text-white" /></span><span className="text-sm font-bold">Create your own</span><span className="text-xs text-[#A1A1AA]">Build a new character</span></button>
          {[...ownedModels, ...lockedModels].map((item, index) => {
            const selected = model === item.id;
            const ready = readyForRender(item);
            return (
              <article
                key={item.id}
                onMouseEnter={() => setHoveredModel(item.id)}
                onMouseLeave={() => setHoveredModel((current) => (current === item.id ? null : current))}
                style={{ animationDelay: `${Math.min(index + 1, 8) * 50}ms` }}
                className={`hc-rise group relative aspect-[3/4] w-[148px] shrink-0 snap-start overflow-hidden rounded-2xl border transition duration-300 sm:w-[200px] ${selected ? "border-white ring-2 ring-white/40" : "border-white/[0.1] hover:-translate-y-0.5 hover:border-white/[0.3]"}`}
              >
                <button type="button" aria-pressed={selected} aria-label={`${item.name}${selected ? ", selected" : ready ? "" : ", locked"}`} onClick={() => { if (ready) setModel(item.id); setPreviewModel(item); }} className="absolute inset-0 block text-left">
                  <ReelMedia reel={getEffectiveCompanionReel(item)} poster={item.image_url} alt={item.name} active={selected || hoveredModel === item.id} eager={index < 3} className={`h-full w-full transition duration-500 ${selected ? "" : "group-hover:scale-[1.04]"} ${ready ? "" : "saturate-[.85]"}`} />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-3 pb-3 pt-12">
                    <span className="block truncate text-sm font-bold text-white">{item.name}</span>
                    <span className="mt-0.5 block text-[11px] text-white/70">{selected ? "Selected" : ready ? "Owned" : `${creatorBilling.creditCosts.modelUnlock} credits`}</span>
                  </span>
                </button>
                {selected && <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white text-[#101012] shadow-lg motion-safe:animate-[hc-pop_.3s_ease-out]"><Check className="h-4 w-4" /></span>}
                {!ready && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(item)} className="absolute bottom-3 right-2 min-h-8 rounded-full bg-white px-3 text-[11px] font-bold text-[#101012] shadow-lg transition hover:bg-[#E4E4E7] disabled:opacity-50">{unlockingModel ? "…" : "Unlock"}</button>}
              </article>
            );
          })}
        </div><button type="button" aria-label="Scroll models right" onClick={() => scrollRail(modelsRailRef, 1)} className="absolute right-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.18] bg-[#101012]/90 text-white shadow-lg"><ArrowRight className="h-4 w-4" /></button></div></section>

        <section id="create" className="mt-8 scroll-mt-24"><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Describe the scene</h2>
          <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start">
          <section ref={studioRef} className="scroll-mt-24 overflow-hidden rounded-3xl lg:sticky lg:top-24 border border-white/[0.1] bg-[linear-gradient(180deg,#1C1C21,#141417)] shadow-[0_30px_80px_rgba(0,0,0,.35)]">
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-6">
              <ReelMedia reel={selectedIdentity ? getEffectiveCompanionReel(selectedIdentity) : null} poster={selectedIdentity?.image_url ?? ""} posterWidth={96} alt="" active className="h-11 w-11 shrink-0 rounded-full ring-2 ring-white/20" />
              <div className="min-w-0 flex-1"><p className="text-[11px] text-[#A1A1AA]">Rendering as</p><p className="truncate text-sm font-bold">{selectedName}</p></div>
              <a href="#models" className="inline-flex min-h-10 items-center rounded-full border border-white/[0.14] px-3 text-xs font-semibold transition hover:bg-white/[0.06]">Change</a>
            </div>
            <div className="p-4 sm:p-6">
              <div role="radiogroup" aria-label="Content mode" className="mb-3 grid grid-cols-2 gap-2">{([
                { value: "social", title: "Social", line: "Public feeds", Icon: Globe },
                { value: "adult", title: "18+", line: "Age check + plan", Icon: Flame },
              ] as const).map(({ value, title, line, Icon }) => {
                const on = contentMode === value;
                return <button key={value} type="button" role="radio" aria-checked={on} onClick={() => selectMode(value)} className={`flex min-h-[52px] items-center gap-2.5 rounded-xl border px-3 text-left transition ${on ? "border-white/70 bg-white/[0.08]" : "border-white/[0.1] hover:border-white/[0.25]"}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${on ? (value === "adult" ? "bg-[#E5484D] text-white" : "bg-white text-[#101012]") : "bg-white/[0.08] text-white"}`}><Icon className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-sm font-bold leading-tight">{title}</span><span className="block truncate text-[11px] text-[#A1A1AA]">{line}</span></span></button>;
              })}</div>
              <div className="flex rounded-xl border border-white/[0.1] bg-black/30 p-1" role="tablist" aria-label="Output type">{(["image", "video"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition ${kind === value ? "bg-white text-[#101012] shadow" : "text-[#A1A1AA] hover:text-white"}`}>{value === "image" ? <ImageIcon className="h-4 w-4" /> : <Clapperboard className="h-4 w-4" />}{value === "image" ? "Photo" : "Video"}</button>)}</div>
              <label htmlFor="creator-prompt" className="sr-only">Describe your scene</label>
              <textarea id="creator-prompt" value={prompt} maxLength={2000} onFocus={() => setPromptFocused(true)} onBlur={() => setPromptFocused(false)} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the pose, outfit, setting, lighting, and action..." className="mt-4 min-h-[120px] w-full resize-y rounded-2xl border border-white/[0.1] bg-black/35 p-4 text-base leading-relaxed text-white outline-none transition placeholder:text-[#71717A] focus:border-white/60 focus:bg-black/45 focus:ring-4 focus:ring-white/[0.06] sm:min-h-[170px]" />
              {contentMode === "social" && hasSocialExplicitTerms(prompt) && <p role="status" className="mt-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-[#D4D4D8]">Nudity isn't available in Social mode. <button type="button" onClick={() => (isAdmin || creatorSubscription ? selectMode("adult") : setSheet("plan"))} className="font-semibold text-white underline">{isAdmin || creatorSubscription ? "Switch to 18+" : "See the plan with 18+"}</button></p>}
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#71717A]"><span>{prompt.length} / 2000</span><button type="button" onClick={surpriseMe} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/[0.14] px-3 font-semibold text-white transition hover:bg-white/[0.08]"><Wand2 className="h-3.5 w-3.5" />Surprise me</button></div>
              <div className={`mt-5 grid gap-5 border-t border-white/[0.07] pt-5 ${kind === "video" ? "sm:grid-cols-2" : ""}`}>
                <div><p className="text-xs font-semibold text-[#A1A1AA]">Frame</p><div className="mt-2 grid grid-cols-3 gap-2">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key as keyof typeof sizes)} aria-pressed={size === key} className={`flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border text-[11px] font-semibold capitalize transition ${size === key ? "border-white bg-white/[0.08] text-white" : "border-white/[0.1] text-[#A1A1AA] hover:text-white"}`}><span className="rounded-[4px] border-2 border-current" style={{ width: Math.round((width / 1024) * 22), height: Math.round((height / 1024) * 22) }} />{key}</button>)}</div></div>
                {kind === "video" && <div><p className="text-xs font-semibold text-[#A1A1AA]">Duration</p><div className="mt-2 grid grid-cols-4 gap-2">{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} aria-pressed={seconds === value} className={`min-h-[64px] rounded-xl border text-sm font-bold transition ${seconds === value ? "border-white bg-white/[0.08] text-white" : "border-white/[0.1] text-[#A1A1AA] hover:text-white"}`}>{value}s</button>)}</div></div>}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-5">
                <p className="text-sm text-[#A1A1AA]">Estimated cost <span className="font-bold text-white">{cost} credits</span>{contentMode === "adult" && <span className="ml-2 text-xs text-[#E5484D]">18+ rate</span>}</p>
                <button type="button" aria-disabled={busy || prompt.trim().length < 3} disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="hc-shine inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-[#101012] shadow-[0_10px_30px_rgba(255,255,255,.08)] transition hover:bg-[#E4E4E7] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"><Sparkles className="h-4 w-4" />{busy ? "Queuing…" : `Generate · ${cost} credits`}</button>
              </div>
              {renderStatus}{loadError && <p className="mt-3 text-sm text-[#FF8C8C]">{loadError}</p>}
            </div>
          </section>
          <section ref={presetsRef} aria-labelledby="presets-title" className="min-w-0 scroll-mt-24">
            <div className="flex items-end justify-between gap-3"><div><h3 id="presets-title" className="font-display text-xl font-extrabold">Presets</h3><p className="mt-1 text-sm text-[#A1A1AA]">One tap fills the scene. Your model stays the same.</p></div><button type="button" onClick={() => { setGalleryStartIndex(0); setSheet("gallery"); }} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/[0.16] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.08]">View gallery</button></div>
            <div role="tablist" aria-label="Preset categories" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">{PRESET_TAGS.map((tag) => <button key={tag} type="button" role="tab" aria-selected={presetTag === tag} onClick={() => setPresetTag(tag)} className={`min-h-9 shrink-0 rounded-full px-3.5 text-xs font-semibold transition ${presetTag === tag ? "bg-white text-[#101012]" : "text-[#A1A1AA] hover:bg-white/[0.06] hover:text-white"}`}>{tag}</button>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">{PRESETS.map((preset, index) => {
              if (presetTag !== "All" && preset.tag !== presetTag) return null;
              const face = presetModels[index];
              const on = prompt === preset.prompt;
              return <button key={preset.name} type="button" onClick={() => usePreset(preset)} aria-pressed={on} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }} className={`hc-rise group relative aspect-[3/4] overflow-hidden rounded-xl border text-left transition duration-300 ${on ? "border-white ring-2 ring-white/40" : "border-white/[0.1] hover:-translate-y-0.5 hover:border-white/[0.3]"}`}>
                {face && <ReelMedia reel={getEffectiveCompanionReel(face)} poster={face.image_url} alt={`${preset.name} preset`} className="absolute inset-0 h-full w-full transition duration-500 group-hover:scale-[1.04]" />}
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">{preset.kind === "video" ? <Clapperboard className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}{preset.tag}</span>
                {on && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-[#101012]"><Check className="h-3.5 w-3.5" /></span>}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-3 pb-3 pt-12"><span className="block text-sm font-bold leading-tight text-white">{preset.name}</span><span className="mt-0.5 block text-[11px] text-white/70">{on ? "In your prompt" : "Use preset"}</span></span>
              </button>;
            })}</div>
          </section>
          </div>
        </section>

        <PlansSection plans={plans} currentPlan={subscriptionTier} isAdmin={isAdmin} onChoose={choosePlan} />

        <section id="book-call" className="mt-12 scroll-mt-24 rounded-2xl border border-white/[0.1] bg-[#19191C] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7"><div><p className="text-xs font-semibold text-[#A1A1AA]">Done-for-you</p><h2 className="mt-1 font-display text-2xl font-extrabold">Want the whole AI creator business built for you?</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A1A1AA]">One model identity, a launch-ready library, and a handoff you can operate. We’ll reply with next steps.</p></div><a href={BOOK_CALL_SMS} className="mt-5 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-bold text-[#101012] sm:mt-0">Book a call</a></section>

        {credits !== null && <section id="renders" className="mt-12 scroll-mt-24"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Your renders</p><h2 className="mt-1 font-display text-2xl font-extrabold">Recent work</h2></div><Link to="/library" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">See more <ChevronRight className="inline h-4 w-4" /></Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{activeJob && activeJob.status !== "completed" && <div className="flex aspect-[4/5] animate-pulse items-end rounded-xl border border-dashed border-white/[0.18] bg-[#19191C] p-3 text-xs font-semibold">Rendering…</div>}{library.slice(0, activeJob && activeJob.status !== "completed" ? 5 : 6).map((item) => <Link to="/library" search={{ item: item.id } as never} key={item.id} className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.1] bg-[#19191C] text-left">{item.kind === "video" ? <video muted preload="metadata" className="pointer-events-none h-full w-full object-cover" src={item.media_url ?? undefined} /> : <img src={item.media_url ?? ""} alt="Saved render" loading="lazy" draggable={false} className="pointer-events-none h-full w-full object-cover transition group-hover:scale-105" />}<span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold">{item.kind === "video" ? "Video" : "Photo"}</span></Link>)}</div>{library.length === 0 && !activeJob && <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] p-8 text-center text-sm text-[#A1A1AA]">Your completed renders will appear here.</p>}</section>}
      </main>
      {!promptFocused && scrolledPastTop && <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 border-t border-white/[0.12] bg-[#101012]/95 px-4 py-2 backdrop-blur-xl lg:hidden"><button type="button" disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="hc-shine min-h-12 w-full rounded-xl bg-white px-5 text-sm font-bold text-[#101012] disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Queuing…" : `Generate · ${cost} credits`}</button></div>}
      <CreatorFooter />
      <style>{`@media (max-width:639px){button[aria-label^="Scroll models"]{display:none!important}}`}</style>
      {previewModel && <CreatorSheet open onClose={() => setPreviewModel(null)} title={`${previewModel.name} preview`}><ReelMedia reel={getEffectiveCompanionReel(previewModel)} poster={previewModel.image_url} alt={previewModel.name} eager className="mx-auto aspect-[3/4] max-h-[60dvh] w-full max-w-sm rounded-xl" /><p className="mt-4 text-sm text-[#A1A1AA]">{readyForRender(previewModel) ? "Owned identity. This face will stay consistent." : "Unlock this identity to keep the face consistent in your renders."}</p>{!readyForRender(previewModel) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(previewModel)} className="mt-4 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-50">{unlockingModel ? "Unlocking…" : `Unlock for ${creatorBilling.creditCosts.modelUnlock} credits`}</button>}</CreatorSheet>}
      <AuthModal open={sheet === "auth"} onClose={() => setSheet(null)} redirectPath="/create-media" onAuthenticated={() => window.location.reload()} />
      <CreatorSheet open={sheet === "age"} onClose={() => setSheet(null)} title="Confirm your age"><label className="flex items-start gap-3 text-sm leading-relaxed text-[#A1A1AA]"><input type="checkbox" checked={ageAgreed} onChange={(event) => setAgeAgreed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#E5484D]" /><span>I confirm that I am 18 or older and agree to the Terms and Privacy Policy.</span></label><button type="button" disabled={!ageAgreed} onClick={() => { void agreeToAdultMode(); setSheet(null); setContentMode("adult"); }} className="mt-5 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-40">Continue to 18+</button></CreatorSheet>
      <CreatorSheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Choose a plan"><p className="text-sm leading-relaxed text-[#A1A1AA]">A creator plan unlocks the render wallet. Social is available for eligible credits; 18+ also requires age confirmation. Checkout uses these exact live tiers.</p><div className="mt-4 grid gap-3">{plans.map((plan) => <button type="button" key={plan.tierId} onClick={() => choosePlan(plan)} className="flex min-h-14 items-center justify-between rounded-xl border border-white/[0.12] px-4 text-left hover:bg-white/[0.08]"><span><span className="block font-semibold">{plan.name}</span><span className="block text-xs text-[#A1A1AA]">{formatPlanPrice(plan)} · {formatCredits(plan.credits)}</span></span><ChevronRight className="h-4 w-4" /></button>)}</div></CreatorSheet>
      <CreatorSheet open={sheet === "gallery"} onClose={() => setSheet(null)} title="Creator gallery"><p className="mb-4 text-sm text-[#A1A1AA]">Viewing {showcaseItems[galleryStartIndex]?.label ?? "the creator showcase"}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{showcaseItems.map((item, index) => <button type="button" key={item.id} onClick={() => setGalleryStartIndex(index)} aria-pressed={index === galleryStartIndex} className={`overflow-hidden rounded-xl border text-left transition ${index === galleryStartIndex ? "border-white ring-2 ring-white/25" : "border-white/[0.1]"}`}><ReelMedia reel={item.type === "video" ? item.src : null} poster={item.poster} alt={item.alt} className="aspect-[3/4] w-full" /><span className="block p-2 text-xs font-semibold text-white">{item.label}</span></button>)}</div><Link to="/gallery" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/[0.14] text-sm font-semibold">View more</Link></CreatorSheet>
    </div>
  );
}
