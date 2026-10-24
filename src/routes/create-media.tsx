import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Bolt, Check, ChevronRight, Clapperboard, Compass, Copy, Flame, Globe, Image as ImageIcon, Lock, Maximize2, Menu, MessageCircle, Sparkles, SquarePlus, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { confirmAge, getPricing } from "@/lib/payments.functions";
import { totalCredits } from "@/lib/credits";
import { toast } from "sonner";
import { LogoLink } from "@/components/Logo";
import { CreatorSheet } from "@/components/creator/CreatorSheet";
import { ReelMedia } from "@/components/creator/ReelMedia";
import { DoneForYouPopup } from "@/components/creator/DoneForYouPopup";
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

// Every studio plan, old and new (content-mode.server.ts ADULT_CREATOR_TIERS).
const CREATOR_PLAN_IDS = ["sub-creator", "sub-creator-annual", "sub-studio-starter", "sub-studio-starter-annual", "sub-studio-creator", "sub-studio-creator-annual", "sub-studio-pro", "sub-studio-pro-annual"];
/** How many models the picker opens with; the banner features the ones after. */
const PICKER_LEAD = 6;
const RANDOM_IDENTITY = "__random_identity__";
const sizes = {
  portrait: [768, 1024],
  square: [1024, 1024],
  landscape: [1024, 768],
} as const;
/** What each frame is, shown on the picker next to its pixel size. */
const FRAME_RATIO: Record<keyof typeof sizes, string> = { portrait: "3:4", square: "1:1", landscape: "4:3" };
const BOOK_CALL_SMS = "sms:7082537082?&body=Hi%2C%20I%27m%20interested%20in%20your%20done-for-you%20content%20creator%20program.%20Please%20tell%20me%20more%20and%20let%20me%20know%20how%20to%20schedule%20a%20call.";

type CreatorModel = { id: string; name: string; image_url: string; gender?: string | null; created_by?: string | null };
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

/** "Surprise me" in 18+: explicit, fully written scenes between consenting adults. */
const adultSceneIdeas = [
  { name: "Morning in bed", prompt: "Fully nude, lying back on rumpled white sheets, one arm above her head, soft morning window light across her bare breasts and hips, relaxed sleepy smile, looking at the camera." },
  { name: "Shower", prompt: "Naked in a glass shower, water running down her bare body, wet hair pushed back, hands on the tiles, steam and warm bathroom light, looking over her shoulder at the camera." },
  { name: "Lingerie off", prompt: "Kneeling on the bed, sliding black lace panties down her thighs, topless, bra tossed beside her, dim bedside lamp light, teasing eye contact with the camera." },
  { name: "Mirror nude", prompt: "Fully nude full-length mirror selfie in a modern bedroom, phone in one hand, other hand on her hip, bare breasts and smooth skin, soft evening light, confident expression." },
  { name: "Spread on the sofa", prompt: "Naked on a leather sofa, legs open, one hand between her thighs, head tilted back, low warm living-room light, explicit and intimate, eyes on the camera." },
  { name: "Bath tub", prompt: "Nude in a deep bathtub, bubbles sliding off her breasts, one leg raised over the rim, candles and warm golden light, sultry half-smile at the camera." },
  { name: "From behind", prompt: "On all fours on the bed, completely nude, arching her back, looking back over her shoulder at the camera, bare ass and hips in soft side light, white sheets." },
  { name: "Poolside topless", prompt: "Topless on a sun lounger by the pool, bikini bottoms only, oiled skin glowing in bright afternoon sun, sunglasses pushed up, playful smile at the camera." },
] as const;

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
    <footer className="mx-auto mt-8 flex max-w-[1240px] flex-col gap-3 border-t border-white/[0.08] px-4 pb-24 pt-6 sm:mt-16 sm:py-8 text-xs text-[#8E858C] sm:flex-row sm:items-center sm:justify-between sm:px-6">
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

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** One plan, laid out like foxy.ai's: price per month, what it creates, real perks only. */
function PlanCard({ plan, currentPlan, isAdmin, onChoose }: {
  plan: CreatorPlan;
  currentPlan: string | null;
  isAdmin: boolean;
  onChoose: (plan: CreatorPlan) => void;
}) {
  const isCurrent = currentPlan === plan.tierId;
  const yearly = plan.period === "yearly";
  const perMonth = yearly ? Math.round(plan.priceCents / plan.billingMonths) : plan.priceCents;
  const buttonLabel = isCurrent ? "Current plan" : isAdmin ? "Admin access" : currentPlan ? `Switch to ${plan.name}` : "Get started";
  return (
    <article className={`relative flex h-full flex-col rounded-3xl border p-6 transition ${plan.featured ? "border-white/60 bg-[linear-gradient(180deg,#26262B,#17171A)] shadow-[0_24px_70px_rgba(0,0,0,.45)]" : "border-white/[0.1] bg-[#17171A]"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-xl font-extrabold">{plan.name}</p>
        {plan.featured && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#101012]">Popular</span>}
      </div>
      <p className="mt-5"><span className="font-display text-5xl font-extrabold tracking-[-0.03em]">{money(perMonth)}</span><span className="ml-1 text-sm text-[#A1A1AA]">/month</span></p>
      <p className="mt-1 text-xs text-[#A1A1AA]">{yearly ? `Billed ${money(plan.priceCents)} yearly` : "Billed monthly"}</p>
      <p className="mt-5 text-sm font-bold">{plan.credits.toLocaleString()} credits {yearly ? "a year, added up front" : "a month"}</p>
      <ul className="mt-4 flex-1 space-y-2.5 text-sm leading-snug text-[#D4D4D8]">
        {plan.features.slice(1).map((feature) => <li key={feature} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-white" />{feature}</li>)}
      </ul>
      <button type="button" disabled={isCurrent || isAdmin} onClick={() => onChoose(plan)} className={`mt-6 min-h-12 rounded-full px-4 text-sm font-bold transition disabled:cursor-default ${isCurrent ? "bg-white/[0.08] text-[#A1A1AA]" : isAdmin ? "border border-[#7FE0B0]/40 bg-[#7FE0B0]/10 text-[#B9F5D4]" : plan.featured ? "hc-shine bg-white text-[#101012] hover:bg-[#E4E4E7]" : "border border-white/[0.18] text-white hover:bg-white/[0.08]"}`}>{buttonLabel}</button>
    </article>
  );
}

function PlansSection({ plans, currentPlan, isAdmin, onChoose }: { plans: readonly CreatorPlan[]; currentPlan: string | null; isAdmin: boolean; onChoose: (plan: CreatorPlan) => void }) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  useEffect(() => {
    if (currentPlan?.endsWith("-annual")) setPeriod("yearly");
  }, [currentPlan]);
  const visiblePlans = plans.filter((plan) => plan.period === period);
  const savings = yearlySavingsLabel(plans);
  return <section id="plans" className="mt-16 scroll-mt-24">
    <div className="text-center">
      <h2 className="font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">Start creating.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#A1A1AA]">A photo is {creatorBilling.creditCosts.image} credits, a video {creatorBilling.creditCosts.videoPerSecond} credits a second ({creatorBilling.creditCosts.video} minimum). Unused credits roll over.</p>
      <div role="radiogroup" aria-label="Billing period" className="mt-6 inline-flex items-center gap-1 rounded-full border border-white/[0.12] bg-[#17171A] p-1 text-sm font-semibold">
        <button type="button" role="radio" aria-checked={period === "monthly"} onClick={() => setPeriod("monthly")} className={`min-h-10 rounded-full px-4 ${period === "monthly" ? "bg-white text-[#101012]" : "text-[#A1A1AA] hover:text-white"}`}>Monthly</button>
        <button type="button" role="radio" aria-checked={period === "yearly"} onClick={() => setPeriod("yearly")} className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 ${period === "yearly" ? "bg-white text-[#101012]" : "text-[#A1A1AA] hover:text-white"}`}>Yearly{savings && <span className="rounded-full bg-[#E5484D] px-2 py-0.5 text-[10px] font-bold text-white">{savings}</span>}</button>
      </div>
    </div>
    <div className="mt-8 grid gap-4 lg:grid-cols-3">{visiblePlans.map((plan) => <PlanCard key={plan.tierId} plan={plan} currentPlan={currentPlan} isAdmin={isAdmin} onChoose={onChoose} />)}</div>
    {visiblePlans.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-white/[0.14] p-5 text-center text-sm text-[#A1A1AA]">Pricing is loading from checkout.</p>}
    {savings && period === "monthly" && <p className="mt-4 text-center text-xs text-[#A1A1AA]">{savings} with a yearly plan.</p>}
  </section>;
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
  // The sticky Generate bar steps aside while the panel's own Generate button
  // is on screen, so a phone never shows two of them at once.
  const inlineGenerateRef = useRef<HTMLButtonElement>(null);
  const [inlineGenerateVisible, setInlineGenerateVisible] = useState(false);
  useEffect(() => {
    const button = inlineGenerateRef.current;
    if (!button || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setInlineGenerateVisible(entry?.isIntersecting ?? false));
    observer.observe(button);
    return () => observer.disconnect();
  }, []);
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
  const cost = kind === "image" ? creatorBilling.creditCosts.image : Math.max(creatorBilling.creditCosts.video, seconds * creatorBilling.creditCosts.videoPerSecond);
  // Everything on this page plays a reel, so it lists only models that have
  // one: user-created models and catalog models without a reel file are left
  // out, except the signed-in user's own creations, which they can still use.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const displayModels = useMemo(
    () => orderModelsForDisplay(models).filter((item) => getEffectiveCompanionReel(item) || (viewerId && item.created_by === viewerId)),
    [models, viewerId],
  );
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
  // The gallery sheet shows every model, not only the banner's twelve.
  const galleryItems = useMemo<ShowcaseItem[]>(() => displayModels.map((item, index) => ({
    ...(showcaseConfig[index % showcaseConfig.length] ?? showcaseConfig[0]),
    id: item.id,
    type: "video" as const,
    src: getEffectiveCompanionReel(item) ?? item.image_url,
    poster: item.image_url,
    alt: `${item.name} creator reference`,
    label: item.name,
  })), [displayModels]);
  // A locked card asks to be unlocked in place instead of opening a sheet.
  const [pendingUnlock, setPendingUnlock] = useState<string | null>(null);
  // The hero collage: every model with a reel, skipping the ones the picker
  // opens with, so its 18 desktop tiles do not repeat faces.
  const heroFaces = useMemo(() => {
    const withReel = displayModels.filter((item) => getEffectiveCompanionReel(item));
    const rest = withReel.slice(PICKER_LEAD);
    return rest.length >= 9 ? rest : withReel;
  }, [displayModels]);
  const studioRef = useRef<HTMLElement>(null);

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
        supabase.from("companions").select("id,name,image_url,gender,created_by").order("sort_order"),
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
        setViewerId(auth.user.id);
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

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!activeJob || activeJob.status === "completed" || activeJob.status === "failed") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  // Once ownership is known, a signed-in user whose selection is locked starts
  // on the first model they can actually render with, in display order.
  useEffect(() => {
    if (loading || credits === null || isAdmin || model === RANDOM_IDENTITY) return;
    const current = models.find((item) => item.id === model);
    if (current && readyForRender(current)) return;
    const firstReady = displayModels.find((item) => readyForRender(item));
    if (firstReady) setModel(firstReady.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, credits, isAdmin, unlocked, displayModels]);

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
    if (isAdmin) { setUnlocked((current) => current.includes(item.id) ? current : [...current, item.id]); setModel(item.id); setPendingUnlock(null); return; }
    if (credits === null) { setPreviewModel(null); openAuthGate(); return; }
    setUnlockingModel(true);
    try {
      const result = await unlock({ data: { companionId: item.id } });
      setUnlocked((current) => current.includes(item.id) ? current : [...current, item.id]);
      setModel(item.id); setPendingUnlock(null);
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
      setCredits((current) => current === null ? current : Math.max(0, current - result.cost));
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

  const surpriseMe = () => {
    const ideas = contentMode === "adult" ? adultSceneIdeas : sceneIdeas;
    setPrompt(ideas[Math.floor(Math.random() * ideas.length)].prompt);
  };
  const renderStatus = activeJob && (() => {
    const rendering = activeJob.status !== "completed" && activeJob.status !== "failed";
    const elapsedMs = Math.max(0, clock - Date.parse(activeJob.created_at));
    const elapsed = `${Math.floor(elapsedMs / 60_000)}:${String(Math.floor((elapsedMs % 60_000) / 1000)).padStart(2, "0")}`;
    const usual = activeJob.kind === "video" ? "Videos usually take 5 to 15 minutes" : "Photos usually take about a minute";
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-white/[0.24] bg-white/[0.035] px-4 py-3 text-sm">
        <span className="flex min-w-0 items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${activeJob.status === "completed" ? "bg-[#7FE0B0]" : activeJob.status === "failed" ? "bg-[#FF8C8C]" : "animate-pulse bg-white"}`} />
          <span>
            <span className="block">{activeJob.status === "completed" ? "Render complete." : activeJob.status === "failed" ? "Render failed. Your credits were refunded." : `Rendering your ${activeJob.kind}… ${elapsed}`}</span>
            {rendering && <span className="mt-0.5 block text-xs text-[#A1A1AA]">{usual}. You can leave this page; it lands in your library.</span>}
          </span>
        </span>
        <Link to="/library" className="font-semibold text-white hover:text-[#D4D4D8]">Open library <ChevronRight className="inline h-4 w-4" /></Link>
      </div>
    );
  })();

  return (
    <div className="relative isolate min-h-screen bg-[#101012] text-[#F4F4F5]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] overflow-hidden">
        {selectedIdentity && <img key={selectedIdentity.id} src={resizedImage(selectedIdentity.image_url, 160, 50)} alt="" decoding="async" className="hc-fade h-full w-full scale-125 object-cover object-top opacity-[.28] blur-3xl" />}
        <div className="absolute inset-0 bg-[radial-gradient(120%_60%_at_50%_0%,transparent,#101012_75%)]" />
      </div>
      <CreatorNav credits={credits} onSignIn={openAuthGate} />
      <main className="mx-auto max-w-[1200px] px-4 pb-4 sm:px-6 lg:max-w-[1400px] lg:pb-16">
        <section id="showcase" aria-label="HumanCrush creator studio" className="scroll-mt-24 pt-3 sm:pt-6">
          <div className="relative h-[200px] overflow-hidden rounded-[28px] bg-[#17171A] sm:h-[280px] lg:h-[320px]">
            <div aria-hidden="true" className="absolute inset-0 grid grid-cols-3 gap-2 p-2 sm:grid-cols-4 lg:grid-cols-6">
              {[0, 1, 2, 3, 4, 5].map((column) => (
                <div key={column} className={`flex flex-col gap-2 ${column % 2 === 1 ? "-translate-y-[38%]" : "-translate-y-[8%]"} ${column >= 4 ? "hidden lg:flex" : column === 3 ? "hidden sm:flex" : ""}`}>
                  {[0, 1, 2].map((row) => {
                    const face = heroFaces[(column * 3 + row) % Math.max(1, heroFaces.length)];
                    if (!face) return null;
                    return <ReelMedia key={row} reel={row === 1 && column < 3 ? getEffectiveCompanionReel(face) : null} poster={face.image_url} posterWidth={320} alt="" eager={row < 2} className="aspect-[3/4] w-full shrink-0 rounded-2xl" />;
                  })}
                </div>
              ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
            <h1 className="absolute inset-x-0 bottom-3 px-4 font-display font-extrabold uppercase leading-[0.86] tracking-[-0.04em] text-white drop-shadow-[0_4px_18px_rgba(0,0,0,.45)] sm:bottom-6 sm:px-8">
              <span className="block text-[46px] sm:text-[72px] lg:text-[88px]"><span className="font-script mr-0.5 align-[-0.08em] text-[64px] normal-case sm:text-[100px] lg:text-[124px]">Y</span>our</span>
              <span className="block text-[40px] sm:text-[64px] lg:text-[80px]">AI content</span>
              <span className="block text-right text-[40px] sm:text-[64px] lg:text-[80px]">studio</span>
            </h1>
          </div>
          <p className="mt-3 hidden text-center text-sm text-[#D4D4D8] sm:block">Make AI photos and short videos of one consistent model, ready to post.</p>
          <div className="mt-3 flex gap-2 sm:mx-auto sm:max-w-md">
            <button type="button" onClick={() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="hc-shine min-h-12 flex-1 rounded-full bg-white text-sm font-extrabold uppercase tracking-[0.02em] text-[#101012]">Get started</button>
            <button type="button" onClick={() => { setGalleryStartIndex(0); setSheet("gallery"); }} className="min-h-12 rounded-full border border-white/[0.2] px-5 text-sm font-semibold text-white">View gallery</button>
          </div>
        </section>

        <section id="models" className="scroll-mt-24 pt-4 sm:pt-7"><div className="flex items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Choose your model</h2><p className="mt-1 hidden text-sm sm:block text-[#A1A1AA]">Select a face to keep consistent in your render.</p></div><Link to="/models" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">Browse all</Link></div><div className="relative mt-3 sm:mt-4"><button type="button" aria-label="Scroll models left" onClick={() => scrollRail(modelsRailRef, -1)} className="absolute left-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.18] bg-[#101012]/90 text-white shadow-lg"><ArrowLeft className="h-4 w-4" /></button><div ref={modelsRailRef} className="flex items-start snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => { if (credits === null) openAuthGate(); else navigate({ to: "/create" }); }} className="hc-rise group relative flex aspect-[3/4] w-[148px] shrink-0 snap-start flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-white/[0.22] bg-[radial-gradient(circle_at_50%_35%,#2A2A30,#16161A_70%)] p-4 text-center transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.4] sm:w-[200px]"><span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.08] transition duration-300 group-hover:scale-110 group-hover:bg-white/[0.14]"><Sparkles className="h-6 w-6 text-white" /></span><span className="text-sm font-bold">Create your own</span><span className="text-xs text-[#A1A1AA]">Build a new character</span></button>
          {/* Display order, not owned-first: the free model (Vanessa) and the other
              big-bust identities trail the rail (display-models.ts); owned ones
              just say so on the card. */}
          {displayModels.map((item, index) => {
            const selected = model === item.id;
            const ready = readyForRender(item);
            const asking = !ready && pendingUnlock === item.id;
            return (
              <article
                key={item.id}
                onMouseEnter={() => setHoveredModel(item.id)}
                onMouseLeave={() => setHoveredModel((current) => (current === item.id ? null : current))}
                style={{ animationDelay: `${Math.min(index + 1, 8) * 50}ms` }}
                className={`hc-rise group relative aspect-[3/4] w-[148px] shrink-0 snap-start overflow-hidden rounded-2xl transition duration-300 sm:w-[200px] ${selected ? "-translate-y-1 border-[3px] border-white shadow-[0_18px_40px_rgba(0,0,0,.55),0_0_0_4px_rgba(255,255,255,.12)]" : "border border-white/[0.1] hover:-translate-y-0.5 hover:border-white/[0.35]"}`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${item.name}${selected ? ", selected" : ready ? ", tap to select" : ", locked, tap to unlock"}`}
                  onClick={() => {
                    if (ready) { setModel(item.id); setPendingUnlock(null); }
                    else setPendingUnlock((current) => (current === item.id ? null : item.id));
                  }}
                  className="absolute inset-0 block text-left"
                >
                  <ReelMedia reel={getEffectiveCompanionReel(item)} poster={item.image_url} alt={item.name} eager={index < 3} className={`h-full w-full transition duration-500 ${selected ? "scale-[1.03]" : "group-hover:scale-[1.04]"} ${ready ? "" : "brightness-[.8] saturate-[.85]"}`} />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-3 pb-3 pt-12">
                    <span className="block truncate text-[15px] font-extrabold text-white">{item.name}</span>
                    {selected
                      ? <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#101012]"><Check className="h-3 w-3" />Selected</span>
                      : <span className="mt-0.5 block text-[11px] text-white/75">{ready ? "Tap to select" : `Unlock · ${creatorBilling.creditCosts.modelUnlock} credits`}</span>}
                  </span>
                </button>
                {selected && <span className="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white text-[#101012] shadow-lg motion-safe:animate-[hc-pop_.3s_ease-out]"><Check className="h-4 w-4" strokeWidth={3} /></span>}
                {!ready && !asking && !selected && <span className="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"><Lock className="h-3.5 w-3.5" /></span>}
                <button type="button" aria-label={`View ${item.name} bigger`} onClick={() => setPreviewModel(item)} className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white opacity-90 backdrop-blur-sm transition hover:bg-black/70"><Maximize2 className="h-3.5 w-3.5" /></button>
                {asking && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 text-center backdrop-blur-[2px] motion-safe:animate-[hc-fade_.2s_ease-out]">
                    <Lock className="h-5 w-5 text-white" />
                    <p className="text-sm font-bold leading-tight text-white">Unlock {item.name}</p>
                    <p className="text-[11px] text-white/75">Keep her face in every render</p>
                    <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(item)} className="mt-1 min-h-10 w-full rounded-full bg-white text-xs font-bold text-[#101012] disabled:opacity-50">{unlockingModel ? "Unlocking…" : `Unlock · ${creatorBilling.creditCosts.modelUnlock} credits`}</button>
                    <button type="button" onClick={() => setPendingUnlock(null)} className="min-h-8 text-[11px] font-semibold text-white/75">Not now</button>
                  </div>
                )}
              </article>
            );
          })}
        </div><button type="button" aria-label="Scroll models right" onClick={() => scrollRail(modelsRailRef, 1)} className="absolute right-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.18] bg-[#101012]/90 text-white shadow-lg"><ArrowRight className="h-4 w-4" /></button></div></section>

        <section id="create" className="mt-8 scroll-mt-24"><h2 className="font-display text-2xl font-extrabold sm:text-3xl">Describe the scene</h2>
          <div className="mx-auto mt-4 max-w-3xl">
          <section ref={studioRef} className="scroll-mt-24 overflow-hidden rounded-3xl border border-white/[0.1] bg-[linear-gradient(180deg,#1C1C21,#141417)] shadow-[0_30px_80px_rgba(0,0,0,.35)]">
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
              <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Scene ideas">{PRESETS.map((preset) => {
                const on = prompt === preset.prompt;
                return <button key={preset.name} type="button" onClick={() => { setPrompt(preset.prompt); setKind(preset.kind); }} aria-pressed={on} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${on ? "border-white bg-white text-[#101012]" : "border-white/[0.12] bg-white/[0.03] text-[#D4D4D8] hover:border-white/[0.3]"}`}>{preset.kind === "video" ? <Clapperboard className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}{preset.name}</button>;
              })}</div>
              <div className={`mt-5 grid gap-5 border-t border-white/[0.07] pt-5 ${kind === "video" ? "sm:grid-cols-2" : ""}`}>
                <div><p className="text-xs font-semibold text-[#A1A1AA]">Frame</p><div className="mt-2 grid grid-cols-3 gap-2">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key as keyof typeof sizes)} aria-pressed={size === key} aria-label={`${key}, ${FRAME_RATIO[key as keyof typeof sizes]}, ${width} by ${height} pixels`} className={`flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1 text-center transition ${size === key ? "border-white bg-white/[0.08] text-white" : "border-white/[0.1] text-[#A1A1AA] hover:text-white"}`}><span className="grid h-9 place-items-center"><span className="rounded-[4px] border-2 border-current" style={{ width: Math.round((width / 1024) * 30), height: Math.round((height / 1024) * 30) }} /></span><span className="text-xs font-bold capitalize leading-none">{key}</span><span className="text-[10px] leading-none opacity-80">{FRAME_RATIO[key as keyof typeof sizes]} · {width}×{height}</span></button>)}</div></div>
                {kind === "video" && <div><p className="text-xs font-semibold text-[#A1A1AA]">Duration</p><div className="mt-2 grid grid-cols-4 gap-2">{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} aria-pressed={seconds === value} className={`min-h-[64px] rounded-xl border text-sm font-bold transition ${seconds === value ? "border-white bg-white/[0.08] text-white" : "border-white/[0.1] text-[#A1A1AA] hover:text-white"}`}>{value}s</button>)}</div></div>}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-5">
                <p className="text-sm text-[#A1A1AA]">Estimated cost <span className="font-bold text-white">{cost} {cost === 1 ? "credit" : "credits"}</span>{contentMode === "adult" && <span className="ml-2 text-xs text-[#E5484D]">18+ rate</span>}</p>
                <button ref={inlineGenerateRef} type="button" aria-disabled={busy || prompt.trim().length < 3} disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="hc-shine inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-[#101012] shadow-[0_10px_30px_rgba(255,255,255,.08)] transition hover:bg-[#E4E4E7] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"><Sparkles className="h-4 w-4" />{busy ? "Queuing…" : `Generate · ${cost} ${cost === 1 ? "credit" : "credits"}`}</button>
              </div>
              {renderStatus}{loadError && <p className="mt-3 text-sm text-[#FF8C8C]">{loadError}</p>}
            </div>
          </section>
          </div>
        </section>

        <PlansSection plans={plans} currentPlan={subscriptionTier} isAdmin={isAdmin} onChoose={choosePlan} />

        <section id="book-call" className="mt-12 scroll-mt-24 rounded-2xl border border-white/[0.1] bg-[#19191C] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7"><div><p className="text-xs font-semibold text-[#A1A1AA]">Done-for-you</p><h2 className="mt-1 font-display text-2xl font-extrabold">Want the whole AI creator business built for you?</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A1A1AA]">One model identity, a launch-ready library, and a handoff you can operate. We’ll reply with next steps.</p></div><a href={BOOK_CALL_SMS} className="mt-5 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-bold text-[#101012] sm:mt-0">Book a call</a></section>

        {credits !== null && <section id="renders" className="mt-12 scroll-mt-24"><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold text-[#A1A1AA]">Your renders</p><h2 className="mt-1 font-display text-2xl font-extrabold">Recent work</h2></div><Link to="/library" className="text-sm font-semibold text-[#A1A1AA] hover:text-white">See more <ChevronRight className="inline h-4 w-4" /></Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{activeJob && activeJob.status !== "completed" && <div className="flex aspect-[4/5] animate-pulse items-end rounded-xl border border-dashed border-white/[0.18] bg-[#19191C] p-3 text-xs font-semibold">Rendering…</div>}{library.slice(0, activeJob && activeJob.status !== "completed" ? 5 : 6).map((item) => <Link to="/library" search={{ item: item.id } as never} key={item.id} className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/[0.1] bg-[#19191C] text-left">{item.kind === "video" ? <video muted preload="metadata" className="pointer-events-none h-full w-full object-cover" src={item.media_url ?? undefined} /> : <img src={item.media_url ?? ""} alt="Saved render" loading="lazy" draggable={false} className="pointer-events-none h-full w-full object-cover transition group-hover:scale-105" />}<span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold">{item.kind === "video" ? "Video" : "Photo"}</span></Link>)}</div>{library.length === 0 && !activeJob && <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] p-8 text-center text-sm text-[#A1A1AA]">Your completed renders will appear here.</p>}</section>}
      </main>
      {!promptFocused && scrolledPastTop && !inlineGenerateVisible && <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 border-t border-white/[0.12] bg-[#101012]/95 px-4 py-2 backdrop-blur-xl lg:hidden"><button type="button" disabled={busy || loading || prompt.trim().length < 3 || !model} onClick={() => void submit()} className="hc-shine min-h-12 w-full rounded-xl bg-white px-5 text-sm font-bold text-[#101012] disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Queuing…" : `Generate · ${cost} ${cost === 1 ? "credit" : "credits"}`}</button></div>}
      <CreatorFooter />
      <DoneForYouPopup
        href={BOOK_CALL_SMS}
        face={heroFaces[0] ? { name: heroFaces[0].name, image_url: heroFaces[0].image_url, reel: getEffectiveCompanionReel(heroFaces[0]) } : null}
        busy={promptFocused || sheet !== null || previewModel !== null}
      />
      <style>{`@media (max-width:639px){button[aria-label^="Scroll models"]{display:none!important}}`}</style>
      {previewModel && <CreatorSheet open onClose={() => setPreviewModel(null)} title={`${previewModel.name} preview`}><ReelMedia reel={getEffectiveCompanionReel(previewModel)} poster={previewModel.image_url} alt={previewModel.name} eager className="mx-auto aspect-[3/4] max-h-[60dvh] w-full max-w-sm rounded-xl" /><p className="mt-4 text-sm text-[#A1A1AA]">{readyForRender(previewModel) ? "Owned identity. This face will stay consistent." : "Unlock this identity to keep the face consistent in your renders."}</p>{!readyForRender(previewModel) && <button type="button" disabled={unlockingModel} onClick={() => void unlockModel(previewModel)} className="mt-4 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-50">{unlockingModel ? "Unlocking…" : `Unlock for ${creatorBilling.creditCosts.modelUnlock} credits`}</button>}</CreatorSheet>}
      <AuthModal open={sheet === "auth"} onClose={() => setSheet(null)} redirectPath="/create-media" onAuthenticated={() => window.location.reload()} />
      <CreatorSheet open={sheet === "age"} onClose={() => setSheet(null)} title="Confirm your age"><label className="flex items-start gap-3 text-sm leading-relaxed text-[#A1A1AA]"><input type="checkbox" checked={ageAgreed} onChange={(event) => setAgeAgreed(event.target.checked)} className="mt-1 h-4 w-4 accent-[#E5484D]" /><span>I confirm that I am 18 or older and agree to the Terms and Privacy Policy.</span></label><button type="button" disabled={!ageAgreed} onClick={() => { void agreeToAdultMode(); setSheet(null); setContentMode("adult"); }} className="mt-5 min-h-11 w-full rounded-xl bg-white text-sm font-bold text-[#101012] disabled:opacity-40">Continue to 18+</button></CreatorSheet>
      <CreatorSheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Choose a plan"><p className="text-sm leading-relaxed text-[#A1A1AA]">A creator plan unlocks the render wallet. Social is available for eligible credits; 18+ also requires age confirmation. Checkout uses these exact live tiers.</p><div className="mt-4 grid gap-3">{plans.map((plan) => <button type="button" key={plan.tierId} onClick={() => choosePlan(plan)} className="flex min-h-14 items-center justify-between rounded-xl border border-white/[0.12] px-4 text-left hover:bg-white/[0.08]"><span><span className="block font-semibold">{plan.name}</span><span className="block text-xs text-[#A1A1AA]">{formatPlanPrice(plan)} · {formatCredits(plan.credits)}</span></span><ChevronRight className="h-4 w-4" /></button>)}</div></CreatorSheet>
      <CreatorSheet open={sheet === "gallery"} onClose={() => setSheet(null)} title="Creator gallery"><p className="mb-4 text-sm text-[#A1A1AA]">Viewing {galleryItems[galleryStartIndex]?.label ?? "the creator showcase"}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{galleryItems.map((item, index) => <button type="button" key={item.id} onClick={() => setGalleryStartIndex(index)} aria-pressed={index === galleryStartIndex} className={`overflow-hidden rounded-xl border text-left transition ${index === galleryStartIndex ? "border-white ring-2 ring-white/25" : "border-white/[0.1]"}`}><ReelMedia reel={item.type === "video" ? item.src : null} poster={item.poster} alt={item.alt} className="aspect-[3/4] w-full" /><span className="block p-2 text-xs font-semibold text-white">{item.label}</span></button>)}</div><Link to="/gallery" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/[0.14] text-sm font-semibold">View more</Link></CreatorSheet>
    </div>
  );
}
