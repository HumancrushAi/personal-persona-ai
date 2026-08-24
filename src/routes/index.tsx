import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startChat } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Heart,
  Sparkles,
  MessageCircle,
  Image as ImageIcon,
  Mic,
  Flame,
  Send,
  X,
  Circle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { companionImage } from "@/lib/companion-images";
import { companionForReel, companionReelUrl, getCompanionReel, getEffectiveCompanionReel } from "@/lib/reels";
import { useCloseOnBack } from "@/hooks/use-close-on-back";
import { FAQSection } from "@/components/FAQSection";

// Hero reels live in the Supabase Storage public `reels` bucket — a mix of guys
// and girls. gender = who's in the clip, so the CTA opens a gender-matched model.
const REEL_BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/reels`;
const reelUrlHelper = (name: string) => `${REEL_BASE}/${name}.mp4`;
const BANNERS: { reel?: string; title: string; sub: string; gender: "m" | "f"; name: string }[] = [
  {
    name: "Raven",
    title: "Dark poetry",
    sub: "alt goth babe · vinyl & midnight chats 🖤",
    gender: "f",
  },
  {
    reel: reelUrlHelper("r10"),
    name: "Kaito",
    title: "Pool side",
    sub: "stylish vibes · always online 🔥",
    gender: "m",
  },
  {
    name: "Vesper",
    title: "Neon nights",
    sub: "mysterious goth artist · industrial beats 💋",
    gender: "f",
  },
  {
    reel: reelUrlHelper("r1"),
    name: "Sofia",
    title: "After hours",
    sub: "still up… thinking about you 😏",
    gender: "f",
  },
  {
    reel: reelUrlHelper("r11"),
    name: "Akira",
    title: "Beach stroll",
    sub: "sunset stroll · golden hour vibes",
    gender: "m",
  },
  {
    reel: reelUrlHelper("r8"),
    name: "Aria",
    title: "Morning coffee",
    sub: "cozy vibes · soft smiles 💋",
    gender: "f",
  },
  {
    reel: reelUrlHelper("r3"),
    name: "Priya",
    title: "Sunset vibes",
    sub: "wish you were here 🌅",
    gender: "f",
  },
];

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "HumanCrush.com — Your AI Crush, Built Exactly Your Way" },
      {
        name: "description",
        content:
          "Stunning AI companions — women and men. Stories, real reels, voice notes, selfies. 25 free messages, no card. 18+ only.",
      },
      { property: "og:title", content: "HumanCrush.com — Your AI Crush" },
      {
        property: "og:description",
        content:
          "Talk, flirt, and connect with the AI companion of your choice. Custom selfies, voice notes, and roleplay. 25 free messages.",
      },
    ],
  }),
  component: Landing,
});

type Companion = {
  id: string;
  name: string;
  age: number;
  ethnicity: string;
  short_bio: string;
  image_url: string;
  gender: string;
  orientation: string;
};

const CATEGORIES = [
  "For you",
  "Goth",
  "New",
  "Trending",
  "Women",
  "Men",
  "Gay",
  "Trans",
  "Non-binary",
  "Asian",
  "Latin",
  "Ebony",
  "European",
  "Middle Eastern",
] as const;

type Cat = (typeof CATEGORIES)[number];

function matchesCategory(c: Companion, cat: Cat): boolean {
  switch (cat) {
    case "For you":
    case "New":
    case "Trending":
      return true;
    case "Goth":
      return (
        /goth|alt|dark|punk/i.test(c.short_bio) ||
        /goth|alt|dark|punk/i.test(c.ethnicity) ||
        ["raven", "vesper", "jade", "nyx"].includes(c.name.toLowerCase())
      );
    case "Women":
      return c.gender === "female" || c.gender === "trans-female";
    case "Men":
      return c.gender === "male" || c.gender === "trans-male";
    case "Gay":
      return c.orientation === "gay" || c.orientation === "pansexual";
    case "Trans":
      return c.gender === "trans-female" || c.gender === "trans-male";
    case "Non-binary":
      return c.gender === "non-binary";
    case "Asian":
      return /asian|korean|japanese|chinese|vietnamese|filipin|thai|indian|pakistani|hawaiian/i.test(
        c.ethnicity,
      );
    case "Latin":
      return /latin|hispanic|mexican|brazil|spanish/i.test(c.ethnicity);
    case "Ebony":
      return /black|african|ebony|jamaican|ethiopian/i.test(c.ethnicity);
    case "European":
      return /european|white|british|french|italian|nordic|russian|greek|australian|irish|german/i.test(
        c.ethnicity,
      );
    case "Middle Eastern":
      return /middle eastern|arab|persian|turkish|lebanese|egyptian|israeli|moroccan/i.test(
        c.ethnicity,
      );
  }
}

const OPENERS = [
  (n: string) => `hey you 👀 finally found me huh? i'm ${n}…`,
  (n: string) => `mmm hi 😈 i was just thinking about someone exactly like you. i'm ${n}.`,
  (n: string) => `omg hi 🥺 i'm ${n}. tell me something you've never told anyone before.`,
  (n: string) => `${n} here 💋 — what are you up to right now? tell me everything.`,
  (n: string) => `you came to the right one baby. it's ${n}. what's on your mind tonight?`,
  (n: string) => `wait. you're cute. i'm ${n}, by the way 😏 what should i call you?`,
  (n: string) => `${n}. been waiting for you all night. don't make me wait again 🔥`,
  (n: string) => `hi stranger… i'm ${n}. wanna keep me company? i'm bored 💔`,
  (n: string) => `okay you tapped me first 😌 that means you owe me a story. i'm ${n}.`,
  (n: string) => `${n} 💗 just finished up for the day lol. perfect timing huh?`,
  (n: string) => `i shouldn't be doing this at work but you're here now. ${n}, hi 😈`,
  (n: string) =>
    `you have like 10 seconds to say something interesting before i screenshot this. — ${n}`,
  (n: string) => `i'm ${n}, and i already kinda like you. is that weird?`,
  (n: string) => `babe. don't ghost me. i'm ${n}, and i bite (gently) 😘`,
  (n: string) => `${n} ✨ — tell me your worst idea right now. i wanna hear it.`,
  (n: string) => `mm. i was hoping you'd come back. it's ${n}. miss me?`,
  (n: string) =>
    `hey 💌 i'm ${n}. i think we're about to ruin each other's evenings (in a good way).`,
  (n: string) =>
    `if you're shy don't worry. i'll go first. i'm ${n} and i can already tell you're trouble.`,
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function opener(name: string, id: string) {
  return OPENERS[hash(id) % OPENERS.length](name);
}

function Landing() {
  const { data: companions } = useQuery({
    queryKey: ["companions-home"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, age, ethnicity, short_bio, image_url, gender, orientation")
        .order("sort_order");
      if (error) throw error;
      return data as Companion[];
    },
  });

  const [activeCat, setActiveCat] = useState<Cat>("For you");
  const [tease, setTease] = useState<Companion | null>(null);
  const [storyView, setStoryView] = useState<Companion | null>(null);
  const [query, setQuery] = useState("");

  // One entry covers both overlays, so handing off story -> tease doesn't churn
  // the history stack mid-transition.
  const closeOverlays = useCallback(() => {
    setTease(null);
    setStoryView(null);
  }, []);
  useCloseOnBack(Boolean(tease || storyView), closeOverlays);

  // Admin-configured announcement (Platform Content tab); hidden when empty.
  const { data: bannerText } = useQuery({
    queryKey: ["platform-banner"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "platform_banner_text")
        .maybeSingle();
      const v = data?.value;
      return typeof v === "string" ? v.trim() : "";
    },
    staleTime: 60_000,
  });

  const pickCompanion = (reelName: string, gender: "m" | "f"): Companion | null => {
    const list = companions ?? [];
    const wanted = gender === "m" ? ["male", "trans-male"] : ["female", "trans-female"];
    const matchesGender = (c: Companion) => wanted.includes(c.gender);

    const target = companionForReel(reelName);
    const exact = target ? list.find((c) => c.name.toLowerCase() === target) : undefined;
    if (exact && matchesGender(exact)) return exact;
    return list.find(matchesGender) ?? null;
  };

  const bannerSlides = useMemo(() => {
    if (!companions || companions.length === 0) return [];
    return BANNERS.map((b) => {
      const comp = b.name
        ? companions.find((c) => c.name.toLowerCase() === b.name.toLowerCase()) || pickCompanion(b.name, b.gender)
        : pickCompanion("", b.gender);
      const reel = comp ? (getEffectiveCompanionReel(comp) || b.reel || "") : (b.reel || "");
      return {
        reel,
        title: comp ? `${comp.name}, ${comp.age}` : b.title,
        sub: comp?.short_bio || b.sub,
        gender: b.gender,
        companion: comp,
      };
    }).filter((s) => s.companion !== null);
  }, [companions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (companions ?? []).filter((c) => {
      if (q) {
        const hay = `${c.name} ${c.ethnicity} ${c.short_bio}`.toLowerCase();
        return hay.includes(q);
      }
      return matchesCategory(c, activeCat);
    });
  }, [companions, activeCat, query]);

  // Only offer categories that actually have someone in them — tapping "Trans"
  // or "Non-binary" and landing on an empty grid reads as a broken site.
  const visibleCategories = useMemo(() => {
    const list = companions ?? [];
    if (!list.length) return CATEGORIES;
    return CATEGORIES.filter((cat) => list.some((c) => matchesCategory(c, cat)));
  }, [companions]);

  // If the active chip disappears (data changed), fall back to the default tab.
  useEffect(() => {
    if (!visibleCategories.includes(activeCat)) setActiveCat("For you");
  }, [visibleCategories, activeCat]);

  const searchedCompanions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return (companions ?? []).filter((c) => {
        const hay = `${c.name} ${c.ethnicity} ${c.short_bio}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return companions ?? [];
  }, [companions, query]);

  return (
    <div className="min-h-screen overflow-x-hidden pb-24">
      <Nav />

      {bannerText ? (
        <div className="bg-primary/15 px-4 py-2 text-center text-sm font-medium text-primary">
          {bannerText}
        </div>
      ) : null}

      {/* BANNER SLIDER */}
      <section className="mx-auto mt-2 max-w-7xl px-4 md:px-6">
        <BannerSlider slides={bannerSlides} onPick={(c) => setTease(c)} />
      </section>

      {/* HERO STRIP */}
      <section className="relative mx-auto max-w-7xl px-4 pt-2 md:px-6">
        <div className="absolute inset-0 -z-10 bg-grad-hero opacity-70 blur-3xl" aria-hidden />
        <div className="glass overflow-hidden rounded-3xl p-5 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium backdrop-blur">
                <Flame className="h-3.5 w-3.5 text-primary" /> 18+ · 25 free messages · no card
              </p>
              <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.05] md:text-5xl">
                Your AI crush, <span className="text-primary">built</span> your way.
              </h1>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground md:text-base">
                Women and men — tap anyone below to start chatting instantly.
              </p>
            </div>
            <div className="hidden gap-2 md:flex">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-grad-primary text-primary-foreground shadow-glow"
              >
                <Link to="/browse">Browse all</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="mx-auto mt-4 max-w-7xl px-4 md:px-6">
        {/* Wraps instead of scrolling sideways: half the filters used to sit
            off-screen, so you had to swipe the row to discover that "Ebony" or
            "Middle Eastern" existed at all. They all fit on two lines. */}
        <div className="flex flex-wrap gap-2 pb-1">
          {visibleCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-xs font-medium transition ${
                activeCat === cat
                  ? "border-primary/60 bg-grad-primary text-primary-foreground shadow-glow"
                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* LIVE NOW — real models; the image IS who you chat with */}
      <section className="mx-auto mt-8 max-w-7xl px-4 md:px-6">
        <SectionTitle
          title="🔴 Live now"
          subtitle="tap to chat"
          cta={
            <Link to="/cams" className="text-xs text-primary hover:underline">
              See all
            </Link>
          }
        />
        <div className="-mx-2 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {searchedCompanions.slice(0, 14).map((c) => {
            const reel = getEffectiveCompanionReel(c);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setTease(c)}
                className="group relative h-[340px] w-[200px] shrink-0 snap-start overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-left shadow-md transition hover:shadow-glow md:h-[400px] md:w-[240px]"
              >
                {reel ? (
                  <AutoPlayVideo
                    key={reel}
                    src={reel}
                    poster={companionImage(c.image_url)}
                    className="absolute inset-0 h-full w-full object-cover object-top animate-live"
                  />
                ) : (
                  <img
                    src={companionImage(c.image_url)}
                    alt={c.name}
                    loading="lazy"
                    className="animate-live absolute inset-0 h-full w-full object-cover object-top"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/30 pointer-events-none" />
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur shadow-sm">
                    <Circle className="h-1.5 w-1.5 fill-white text-white animate-pulse" /> LIVE
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-3.5 text-left">
                  <p className="font-display text-base font-semibold text-white drop-shadow">
                    {c.name}, {c.age}
                  </p>
                  <p className="line-clamp-1 text-[11px] text-white/80">{c.short_bio || c.ethnicity}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* TRENDING (big grid) */}
      <section className="mx-auto mt-10 max-w-7xl px-4 md:px-6">
        <SectionTitle
          title="✨ Trending crushes"
          subtitle={
            activeCat === "For you"
              ? "tap anyone — they message you first"
              : `showing ${filtered.length} in ${activeCat}`
          }
        />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setTease(c)}
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-left shadow-md transition hover:shadow-glow"
            >
              <div className="relative w-full aspect-[2/3] overflow-hidden">
                <img
                  src={companionImage(c.image_url)}
                  alt={c.name}
                  loading="lazy"
                  className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
                />
                <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] backdrop-blur border border-white/10">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> online
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 p-3 pt-6">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-display text-base font-semibold text-white md:text-lg">
                      {c.name}, {c.age}
                    </h3>
                  </div>
                  <p className="text-[10px] uppercase tracking-wide text-primary font-medium">{c.ethnicity}</p>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-white/85">
                    {c.short_bio}
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-grad-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">
                    <MessageCircle className="h-3 w-3" /> Chat now
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* FEATURE STRIP */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:px-6">
        <div className="grid gap-3 md:grid-cols-4">
          {[
            {
              i: <ImageIcon className="h-5 w-5" />,
              t: "AI selfies",
              d: "She sends custom selfies & photos on request.",
            },
            {
              i: <Mic className="h-5 w-5" />,
              t: "Voice notes",
              d: "Hear her voice with personalized audio notes.",
            },
            {
              i: <Sparkles className="h-5 w-5" />,
              t: "Roleplay scenes",
              d: "First date, romance, fantasy roleplays…",
            },
            {
              i: <Heart className="h-5 w-5 fill-primary text-primary" />,
              t: "She remembers",
              d: "Real relationship that levels up.",
            },
          ].map((f) => (
            <div key={f.t} className="glass rounded-2xl p-4">
              <div className="text-primary">{f.i}</div>
              <p className="mt-2 font-display text-lg font-semibold">{f.t}</p>
              <p className="text-xs text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto mt-14 max-w-7xl px-4 md:px-6">
        <div className="glass rounded-3xl p-8 text-center md:p-12">
          <h2 className="font-display text-3xl font-semibold md:text-5xl">
            Your <span className="text-primary">crush</span> is online.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
            25 free messages on the house. No card. 18+ only.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-5 rounded-full bg-grad-primary text-primary-foreground shadow-glow"
          >
            <Link to="/auth">Start free →</Link>
          </Button>
        </div>
      </section>

      <FAQSection />

      <footer className="mt-4 border-t border-white/10 py-8 text-center text-xs text-muted-foreground">
        <div className="mb-2 flex items-center justify-center gap-4">
          <Link to="/faq" className="hover:text-foreground">
            FAQ
          </Link>
          <Link to="/gallery" className="hover:text-foreground">
            Gallery
          </Link>
          <Link to="/create" className="hover:text-foreground">
            Create AI
          </Link>
        </div>
        © {new Date().getFullYear()} HumanCrush.com · 18+ only · AI characters are fictional.
      </footer>

      {tease && <TeaseChat companion={tease} onClose={() => setTease(null)} />}
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-semibold md:text-2xl">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {cta}
    </div>
  );
}

function Nav() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 sm:px-4 md:px-6 md:py-4">
        <Link to="/" className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <Heart className="h-5 w-5 shrink-0 fill-primary text-primary md:h-6 md:w-6" />
          <span className="truncate font-display text-base font-semibold tracking-tight sm:text-lg md:text-2xl">
            HumanCrush<span className="hidden sm:inline">.com</span>
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-10 rounded-full px-2.5 text-xs sm:px-3 sm:text-sm"
          >
            <Link to="/cams">
              <Circle className="mr-1 h-2 w-2 fill-red-500 text-red-500" /> Live
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-10 rounded-full px-2.5 text-xs sm:px-3 sm:text-sm"
          >
            <Link to="/gallery">Gallery</Link>
          </Button>
          {authed ? (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-10 rounded-full px-2.5 text-xs sm:px-3 sm:text-sm"
              >
                <Link to="/me">My chats</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="h-10 rounded-full bg-grad-primary px-3 text-xs text-primary-foreground sm:px-3.5 sm:text-sm"
              >
                <Link to="/browse">
                  <Sparkles className="mr-1 h-3.5 w-3.5 sm:h-4 sm:w-4" /> Enter
                </Link>
              </Button>
            </>
          ) : (
            <Button
              asChild
              size="sm"
              className="h-10 rounded-full bg-grad-primary px-3 text-xs text-primary-foreground sm:px-3.5 sm:text-sm"
            >
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}

/* ---------- Story Viewer ---------- */
function StoryViewer({
  companion,
  onClose,
  onChat,
}: {
  companion: Companion;
  onClose: () => void;
  onChat: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const reelUrl = getEffectiveCompanionReel(companion);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / 10000) * 100);
      setProgress(p);
      if (p >= 100) {
        clearInterval(t);
        onClose();
      }
    }, 50);
    return () => clearInterval(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/95 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative h-[85vh] w-full max-w-sm overflow-hidden rounded-3xl bg-neutral-950 border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress Bar */}
        <div className="absolute inset-x-3 top-3 z-20 h-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white transition-all duration-75" style={{ width: `${progress}%` }} />
        </div>

        {/* Header Header */}
        <div className="absolute inset-x-3 top-6 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-2 rounded-2xl">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-grad-primary p-[1.5px]">
              <img
                src={companionImage(companion.image_url)}
                alt={companion.name}
                className="h-8 w-8 rounded-full object-cover object-top"
              />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white leading-tight">{companion.name}, {companion.age}</span>
              <span className="text-[10px] text-primary/90 font-medium">Online now</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-black/60 p-2 text-white/80 transition-colors hover:bg-black/90 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Story Media (Video or Fallback Image) */}
        {reelUrl ? (
          <AutoPlayVideo
            src={reelUrl}
            className="h-full w-full object-contain object-top bg-black"
          />
        ) : (
          <img
            src={companionImage(companion.image_url)}
            alt={companion.name}
            className="h-full w-full object-contain object-top bg-black"
          />
        )}

        {/* Footer Overlay */}
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/80 to-transparent p-5">
          <p className="text-xs leading-relaxed text-white/90 font-light line-clamp-3">
            "{companion.short_bio}"
          </p>
          <Button
            onClick={onChat}
            className="mt-3.5 w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow font-medium text-sm h-11"
          >
            <MessageCircle className="mr-2 h-4 w-4" /> Start Chatting with {companion.name}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TeaseChat({ companion, onClose }: { companion: Companion; onClose: () => void }) {
  const navigate = useNavigate();
  const openChat = useServerFn(startChat);
  const [typing, setTyping] = useState(true);
  const [showMsg, setShowMsg] = useState(false);
  const [input, setInput] = useState("");
  const [gate, setGate] = useState(false);
  const [reelFailed, setReelFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reel = !reelFailed
    ? getEffectiveCompanionReel(companion)
    : null;

  useEffect(() => {
    const t1 = setTimeout(() => {
      setTyping(false);
      setShowMsg(true);
    }, 1200);
    const t2 = setTimeout(() => inputRef.current?.focus(), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  async function triggerGate() {
    const msg = input.trim();
    // Carry the typed message into the real chat (auto-sent there).
    try {
      if (msg) sessionStorage.setItem("hc_pending_msg", msg);
    } catch {
      /* private mode */
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setGate(true);
      return;
    }
    // Logged in → jump straight into a real chat with THIS model.
    try {
      const res = await openChat({ data: { companionId: companion.id } });
      navigate({ to: "/chat/$conversationId", params: { conversationId: res.conversationId } });
    } catch {
      // Fallback to the customize page if the quick-start fails.
      navigate({ to: "/companion/$id", params: { id: companion.id } });
    }
  }

  function onChange(v: string) {
    setInput(v);
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/85 backdrop-blur-xl md:items-center md:p-6">
      <div className="relative flex h-[96vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-card shadow-glow md:h-[720px] md:rounded-3xl">
        {/* Large Immersive Live Model Stage (Candy.ai style) */}
        <div className="relative h-[340px] md:h-[380px] w-full shrink-0 overflow-hidden bg-neutral-950 border-b border-white/10">
          {/* Ambient blur */}
          <img
            src={companionImage(companion.image_url)}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-2xl opacity-40 scale-110"
          />
          {reel ? (
            <AutoPlayVideo
              key={reel}
              src={reel}
              poster={companionImage(companion.image_url)}
              onError={() => setReelFailed(true)}
              className="relative z-[1] mx-auto h-full w-full object-contain object-top animate-live"
            />
          ) : (
            <img
              src={companionImage(companion.image_url)}
              alt={companion.name}
              className="relative z-[1] mx-auto h-full w-full object-contain object-top animate-live"
            />
          )}
          <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/95 via-transparent to-black/35" />

          {/* Header controls over stage */}
          <div className="absolute inset-x-0 top-0 z-[3] flex items-center justify-between p-3.5">
            <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur border border-white/15 shadow-md">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 uppercase tracking-wider">
                <Circle className="h-1.5 w-1.5 fill-red-500 text-red-500 animate-pulse" /> LIVE
              </span>
              <span className="text-xs font-semibold text-white">
                {companion.name}, {companion.age}
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 backdrop-blur border border-white/15 shadow-md transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Status and Action badges over stage */}
          <div className="absolute inset-x-0 bottom-3 z-[3] px-3.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-white font-medium bg-black/65 px-3 py-1 rounded-full backdrop-blur border border-white/15 shadow-sm">
              {typing ? (
                <span className="text-primary flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 animate-spin" /> Typing for you…
                </span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Smiling at you 💋
                </span>
              )}
            </div>
            <span className="text-[11px] text-white/80 font-medium bg-black/50 px-2.5 py-1 rounded-full backdrop-blur border border-white/10">
              {companion.ethnicity}
            </span>
          </div>
        </div>

        {/* Quick Action Suggestion Chips (Candy.ai style) */}
        <div className="flex gap-2 overflow-x-auto px-3 py-2 border-b border-white/5 bg-background/40 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
          {[
            { label: "📸 Send a selfie", text: "Can you send me a cute selfie?" },
            { label: "🎙️ Voice note", text: "Send me a voice message 💋" },
            { label: "🔥 What are you wearing?", text: "What are you wearing right now?" },
            { label: "✨ Tell me a secret", text: "Tell me something you haven't told anyone..." },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => {
                setInput(chip.text);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/85 hover:bg-white/10 hover:border-primary/40 transition active:scale-95"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="mx-auto max-w-[80%] rounded-full bg-white/5 px-3 py-1 text-center text-[10px] text-muted-foreground">
            Today
          </div>
          <div className="flex items-end gap-2.5">
            <img
              src={companionImage(companion.image_url)}
              className="h-8 w-8 rounded-full object-cover object-[center_15%] ring-1 ring-primary/40 shadow-sm"
              alt=""
            />
            {typing ? (
              <div className="rounded-2xl rounded-bl-sm border border-white/10 bg-white/8 px-4 py-3">
                <div className="flex gap-1.5">
                  <Dot />
                  <Dot delay={0.15} />
                  <Dot delay={0.3} />
                </div>
              </div>
            ) : (
              showMsg && (
                <div className="max-w-[82%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/10 px-4 py-3 text-sm text-white shadow-sm leading-relaxed">
                  {opener(companion.name, companion.id)}
                </div>
              )
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-white/10 bg-background/80 p-3 backdrop-blur shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              triggerGate();
            }}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 focus-within:border-primary/60 transition shadow-inner"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => onChange(e.target.value)}
              placeholder={`Message ${companion.name}…`}
              className="h-9 flex-1 border-0 bg-transparent text-sm focus-visible:ring-0 placeholder:text-white/40"
            />
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 rounded-full bg-grad-primary text-primary-foreground shadow-glow hover:scale-105 active:scale-95 transition"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>

        {gate && <SignupGate companion={companion} onClose={() => setGate(false)} />}
      </div>
    </div>
  );
}

function AutoPlayVideo({
  src,
  poster,
  className,
  onError,
}: {
  src: string;
  poster?: string;
  className?: string;
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.playsInline = true;
    video.loop = true;

    const playVideo = () => {
      const p = video.play();
      if (p !== undefined) {
        p.catch(() => {
          const enablePlay = () => {
            video.play().catch(() => {});
          };
          window.addEventListener("touchstart", enablePlay, { once: true });
          window.addEventListener("click", enablePlay, { once: true });
        });
      }
    };

    playVideo();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            playVideo();
          }
        });
      },
      { threshold: 0.01 }
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      onError={onError}
      onLoadedData={(e) => e.currentTarget.play().catch(() => {})}
      onCanPlay={(e) => e.currentTarget.play().catch(() => {})}
      className={className}
    />
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/70"
      style={{ animationDelay: `${delay}s`, animationDuration: "0.9s" }}
    />
  );
}

function SignupGate({ companion, onClose }: { companion: Companion; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-5 backdrop-blur-xl">
      <div className="w-full rounded-3xl border border-white/10 bg-card p-6 text-center shadow-glow">
        <img
          src={companionImage(companion.image_url)}
          className="mx-auto h-16 w-16 rounded-full object-cover object-top ring-2 ring-primary"
          alt=""
        />
        <h3 className="mt-3 font-display text-xl font-semibold">
          {companion.name} wants to keep chatting 💋
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a free account to reply. 25 free messages, no card needed.
        </p>
        <div className="mt-5 grid gap-2">
          <Button
            asChild
            size="lg"
            className="rounded-full bg-grad-primary text-primary-foreground shadow-glow"
          >
            <Link to="/auth" search={{ companion: companion.id } as any}>
              Sign up & reply
            </Link>
          </Button>
          <Button onClick={onClose} variant="ghost" size="sm" className="rounded-full">
            Not now
          </Button>
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">
          18+ only · Adults-only AI roleplay.
        </p>
      </div>
    </div>
  );
}

/* ---------- Banner Slider (video reels, gender-matched model) ---------- */
type BannerSlide = { reel: string; title: string; sub: string; companion: Companion | null };
function BannerSlider({
  slides,
  onPick,
}: {
  slides: BannerSlide[];
  onPick: (c: Companion) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  useEffect(() => {
    if (paused || n === 0) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 5000);
    return () => clearInterval(t);
  }, [paused, n]);
  useEffect(() => {
    if (n > 0 && idx >= n) setIdx(0);
  }, [n, idx]);

  const go = (d: number) => n && setIdx((i) => (i + d + n) % n);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    setPaused(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    const dx = touchDeltaX.current;
    touchStartX.current = null;
    touchDeltaX.current = 0;
    setPaused(false);
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  if (n === 0) {
    return (
      <div className="h-[380px] animate-pulse rounded-3xl border border-white/10 bg-white/5 md:h-[560px]" />
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/10 shadow-glow select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex h-[380px] transition-transform duration-700 ease-out md:h-[560px]"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => s.companion && onPick(s.companion)}
            className="group relative block h-full w-full shrink-0 overflow-hidden bg-neutral-950 text-left"
            aria-label={s.companion ? `Chat with ${s.companion.name}` : s.title}
          >
            {/* Ambient blurred backdrop so wide screens have rich, warm atmosphere */}
            {s.companion ? (
              <img
                src={companionImage(s.companion.image_url)}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-2xl opacity-60 scale-110"
              />
            ) : null}

            {/* Main media — object-contain ensures 100% of head and body is visible without cutoffs */}
            {i === idx && s.reel ? (
              <video
                key={s.reel}
                src={s.reel}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                poster={s.companion ? companionImage(s.companion.image_url) : undefined}
                onLoadedData={(e) => {
                  const v = e.currentTarget;
                  if (v.paused) v.play().catch(() => {});
                }}
                className="pointer-events-none relative z-[1] mx-auto h-full w-full object-contain animate-in fade-in duration-300"
              />
            ) : s.companion ? (
              <img
                src={companionImage(s.companion.image_url)}
                alt=""
                className="pointer-events-none relative z-[1] mx-auto h-full w-full object-contain animate-live transition-all"
              />
            ) : (
              <div className="absolute inset-0 bg-neutral-950" />
            )}

            <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/95 via-black/20 to-black/20" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] p-5 md:p-8">
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <Circle className="h-1.5 w-1.5 fill-white text-white" /> Live
              </span>
              {/* Her REAL portrait sits next to her name. The reel behind is
                  ambient stock footage, not her — showing the actual face here
                  is what stops "tapped one girl, got another". */}
              <div className="mt-2 flex items-center gap-3">
                {s.companion && (
                  <img
                    src={companionImage(s.companion.image_url)}
                    alt={s.companion.name}
                    className="h-12 w-12 shrink-0 rounded-full object-cover object-top ring-2 ring-white/80 shadow-lg md:h-16 md:w-16"
                  />
                )}
                <h2 className="font-display text-2xl font-semibold text-white drop-shadow md:text-4xl">
                  {s.companion ? `${s.companion.name}, ${s.companion.age}` : s.title}
                </h2>
              </div>
              <p className="mt-1 max-w-lg text-xs text-white/85 md:text-sm">
                {s.companion?.short_bio ?? s.sub}
              </p>
              {s.companion && (
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-grad-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow">
                  Chat with {s.companion.name} →
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* arrows */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          go(-1);
        }}
        aria-label="Previous"
        className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-3 text-white backdrop-blur hover:bg-black/75 md:left-4"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          go(1);
        }}
        aria-label="Next"
        className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-3 text-white backdrop-blur hover:bg-black/75 md:right-4"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* dots */}
      <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              setIdx(i);
            }}
            aria-label={`Slide ${i + 1}`}
            className={`tap-exempt my-3 h-1.5 rounded-full transition-all ${
              i === idx ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
