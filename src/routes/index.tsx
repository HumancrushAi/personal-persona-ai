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
  Wand2,
  Video,
  Lock,
  Compass,
  Film,
  Home,
  MessageSquare,
  FolderHeart,
  UserPlus,
} from "lucide-react";
import { companionImage } from "@/lib/companion-images";
import { LanguageSelect } from "@/components/LanguageSelect";
import { openSupport } from "@/components/SupportWidget";
import { useSystemStatus } from "@/hooks/use-app-setting";
import {
  companionForReel,
  companionReelUrl,
  getCompanionReel,
  getEffectiveCompanionReel,
} from "@/lib/reels";
import { useCloseOnBack } from "@/hooks/use-close-on-back";
import { FAQSection } from "@/components/FAQSection";

// Hero reels live in the Supabase Storage public `reels` bucket — a mix of guys
// and girls. gender = who's in the clip, so the CTA opens a gender-matched model.
const REEL_BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/reels`;
const reelUrlHelper = (name: string) => `${REEL_BASE}/${name}.mp4`;
const BANNERS: { id: string; name: string; title: string; sub: string; gender: "m" | "f" }[] = [
  {
    id: "2c252785-fe75-4c84-a803-af9c484f6c96",
    name: "Aria",
    title: "Silk & Night lights",
    sub: "seductive crimson slip dress · penthouse luxury vibes 💋",
    gender: "f",
  },
  {
    id: "9a173fea-67ea-45d3-996a-9084dc3c98d0",
    name: "Sofia",
    title: "After hours",
    sub: "skimpy halter top · thinking about you 😏",
    gender: "f",
  },
  {
    id: "f668101d-486e-45e2-9e87-69e70e272401",
    name: "Raven",
    title: "Dark poetry",
    sub: "lace corset & leather skirt · alt goth babe 🖤",
    gender: "f",
  },
  {
    id: "5eaaf212-055d-44f8-841e-94967f4a674c",
    name: "Vesper",
    title: "Neon nights",
    sub: "sheer mesh & leather harness · goth queen 💋",
    gender: "f",
  },
  {
    id: "eae18174-2e5e-4bc5-8c3f-16e1b5265e50",
    name: "Ruby",
    title: "Curvy perfection",
    sub: "voluptuous blonde · soft curves & warm smile ✨",
    gender: "f",
  },
  {
    id: "948f3ac7-a60c-4342-93fb-0f3ae3578101",
    name: "Zara",
    title: "Golden glow",
    sub: "curvy golden-hour goddess · radiant charm & seductive warmth 💋",
    gender: "f",
  },
  {
    id: "78e5f6af-2c52-4dde-b710-09512d28f9aa",
    name: "Dante",
    title: "Salsa & fitness",
    sub: "open linen shirt & abs · golden hour vibes 🌊",
    gender: "m",
  },
  {
    id: "667ae29d-7e55-4588-b9c8-7bfad68f455e",
    name: "Jade",
    title: "Midnight vibes",
    sub: "alt goth babe · vinyl & midnight chats 🖤",
    gender: "f",
  },
  {
    id: "ab334fc9-fe99-4f60-bd63-1a969aece70c",
    name: "Skye",
    title: "Sun-kissed skies",
    sub: "blue-haired baddie · swimsuit & tropical sunshine vibes 🩵",
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
  art_style: string;
  created_by?: string | null;
};

const CATEGORIES = [
  "For you",
  "Goth",
  "New",
  "Trending",
  "Women",
  "Men",
  "Anime",
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
        /\b(goth|alt|dark|punk)\b/i.test(c.short_bio) ||
        /\b(goth|alt|dark|punk)\b/i.test(c.ethnicity) ||
        ["raven", "vesper", "jade", "nyx", "lilith", "morticia"].includes(c.name.toLowerCase())
      );
    case "Women":
      return (c.gender === "female" || c.gender === "trans-female") && c.art_style !== "anime";
    case "Men":
      return (c.gender === "male" || c.gender === "trans-male") && c.art_style !== "anime";
    case "Anime":
      return c.art_style === "anime" || (c.image_url || "").includes("anime");
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
        .select(
          "id, name, age, ethnicity, short_bio, image_url, gender, orientation, art_style, created_by",
        )
        .order("sort_order");
      if (error) throw error;
      return data as Companion[];
    },
  });

  const [activeCat, setActiveCat] = useState<Cat>("For you");
  const [topTab, setTopTab] = useState<"girls" | "guys">("girls");
  const [tease, setTease] = useState<Companion | null>(null);
  const [storyView, setStoryView] = useState<Companion | null>(null);
  const [query, setQuery] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);

  // getSession reads the token already on this device; getUser is a network
  // round trip to validate it, and the header, the prompt and this page were
  // each making one before anything rendered. Real actions still validate on
  // the server, so the only thing a stale session buys here is a "Chats"
  // button that leads to the sign-in page.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
  }, []);

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

  // Which companions the Girls / Guys toggle means. The toggle used to change
  // only the grid at the bottom of the page — the banner and the "Live now"
  // row, which are what a phone actually shows, ignored it, so tapping Guys
  // visibly did nothing.
  const inTab = useCallback(
    (c: Companion) =>
      topTab === "guys"
        ? c.gender === "male" || c.gender === "trans-male"
        : c.gender === "female" || c.gender === "trans-female",
    [topTab],
  );

  const bannerSlides = useMemo(() => {
    if (!companions || companions.length === 0) return [];
    const wantGender = topTab === "guys" ? "m" : "f";
    const toSlide = (comp: Companion, sub: string) => ({
      reel: getEffectiveCompanionReel(comp) || "",
      title: `${comp.name}, ${comp.age}`,
      sub: comp.short_bio || sub,
      gender: wantGender as "m" | "f",
      companion: comp,
    });
    const curated = BANNERS.filter((b) => b.gender === wantGender)
      .map((b) => {
        const comp =
          companions.find((c) => c.id === b.id) ||
          companions.find((c) => c.name.toLowerCase() === b.name.toLowerCase());
        return comp && inTab(comp) ? toSlide(comp, b.sub) : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    if (curated.length) return curated;
    // No curated banner for this tab: the first few of that gender still make
    // a slider, which is better than a tab that empties the top of the page.
    return companions
      .filter(inTab)
      .slice(0, 5)
      .map((c) => toSlide(c, c.ethnicity));
  }, [companions, topTab, inTab]);

  const liveNow = useMemo(() => (companions ?? []).filter(inTab).slice(0, 14), [companions, inTab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = companions ?? [];

    // Filter by topTab (Girls, Guys)
    if (topTab === "girls") {
      if (activeCat === "Anime" || q.includes("anime")) {
        list = list.filter((c) => c.gender === "female" || c.gender === "trans-female");
      } else {
        list = list.filter(
          (c) => (c.gender === "female" || c.gender === "trans-female") && c.art_style !== "anime",
        );
      }
    } else if (topTab === "guys") {
      if (activeCat === "Anime" || q.includes("anime")) {
        list = list.filter((c) => c.gender === "male" || c.gender === "trans-male");
      } else {
        list = list.filter(
          (c) => (c.gender === "male" || c.gender === "trans-male") && c.art_style !== "anime",
        );
      }
    }

    // Filter by search query or category pill
    return list.filter((c) => {
      if (q) {
        const hay = `${c.name} ${c.ethnicity} ${c.short_bio}`.toLowerCase();
        return hay.includes(q);
      }
      return matchesCategory(c, activeCat);
    });
  }, [companions, activeCat, query, topTab]);

  // Only offer categories that actually have someone in them
  const visibleCategories = useMemo(() => {
    let list = companions ?? [];
    if (topTab === "girls") {
      list = list.filter((c) => c.gender === "female" || c.gender === "trans-female");
    } else if (topTab === "guys") {
      list = list.filter((c) => c.gender === "male" || c.gender === "trans-male");
    }
    if (!list.length) return CATEGORIES;
    return CATEGORIES.filter((cat) => list.some((c) => matchesCategory(c, cat)));
  }, [companions, topTab]);

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
    <div className="min-h-screen bg-[#07050a] text-white flex flex-col lg:flex-row relative">
      {/* LEFT SIDEBAR (desktop only) */}
      <aside className="hidden lg:flex flex-col w-64 h-screen fixed left-0 top-0 border-r border-white/10 bg-[#0f0d15] p-5 z-30 justify-between">
        <div className="flex flex-col gap-8">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 px-2">
            <Heart className="h-6 w-6 fill-primary text-primary" />
            <span className="font-display text-xl font-bold tracking-tight bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
              HumanCrush<span className="text-white">.com</span>
            </span>
          </Link>

          {/* Navigation Items */}
          <nav className="flex flex-col gap-1.5">
            {[
              { label: "Home", icon: <Home className="h-5 w-5" />, to: "/" },
              { label: "Discover", icon: <Compass className="h-5 w-5" />, to: "/cams" },
              { label: "Shorts", icon: <Film className="h-5 w-5" />, to: "/gallery" },
              { label: "Chat", icon: <MessageSquare className="h-5 w-5" />, to: "/me" },
              { label: "Collection", icon: <FolderHeart className="h-5 w-5" />, to: "/gallery" },
              { label: "Create Character", icon: <UserPlus className="h-5 w-5" />, to: "/create" },
              { label: "My AI", icon: <Heart className="h-5 w-5" />, to: "/me" },
            ].map((item, idx) => {
              const active = item.to === "/";
              return (
                <Link
                  key={idx}
                  to={item.to}
                  className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl text-sm font-medium transition ${
                    active
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-white/70 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Sidebar Links. Discord is gone until there is a server to
            link to — a dead link is worse than none. */}
        <div className="flex flex-col gap-4 border-t border-white/5 pt-4">
          <LanguageSelect />
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-3 text-[11px] text-white/40">
            <Link to="/faq" className="hover:text-white hover:underline">
              Help Center
            </Link>
            <button
              type="button"
              onClick={openSupport}
              className="tap-exempt min-h-0 min-w-0 hover:text-white hover:underline"
            >
              Contact
            </button>
            <Link to="/affiliate" className="hover:text-white hover:underline">
              Affiliate
            </Link>
          </div>
          <SystemStatusNote />
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 lg:pl-64 min-h-screen pb-24 overflow-x-hidden relative">
        {/* Background Ambient Glows */}
        {/* Desktop only. Three screen-sized Gaussian blurs re-composited on
            every scroll frame is most of what made the page feel slow on a
            phone, for a glow nobody can see behind the content there. */}
        <div className="hidden lg:block absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-pink-500/5 blur-[120px] pointer-events-none z-0" />
        <div className="hidden lg:block absolute top-1/3 left-0 w-[600px] h-[600px] rounded-full bg-purple-500/5 blur-[150px] pointer-events-none z-0" />
        <div className="hidden lg:block absolute bottom-0 right-1/4 w-[700px] h-[700px] rounded-full bg-indigo-500/5 blur-[180px] pointer-events-none z-0" />
        {/* TOP HEADER */}
        <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#0d0a12]/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-1.5 px-2.5 py-2.5 sm:px-6 md:px-8">
            {/* Mobile Logo */}
            <Link to="/" className="flex items-center gap-1 sm:gap-1.5 shrink min-w-0">
              <Heart className="h-5 w-5 fill-primary text-primary animate-pulse shrink-0" />
              <span className="font-display text-xs sm:text-base font-bold tracking-tight bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent truncate">
                HumanCrush<span className="hidden sm:inline text-white">.com</span>
              </span>
            </Link>

            {/* Top Tabs (Girls, Guys) */}
            <div className="flex items-center gap-0.5 bg-white/5 p-0.5 rounded-full border border-white/10 shrink-0">
              {[
                { id: "girls", label: "♀ Girls" },
                { id: "guys", label: "♂ Guys" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTopTab(tab.id as any)}
                  className={`tap-exempt px-2.5 py-1 sm:px-4 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold tracking-wide uppercase transition ${
                    topTab === tab.id
                      ? "bg-grad-primary text-primary-foreground shadow-glow font-bold"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Right side buttons */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {authed ? (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="tap-exempt h-8 rounded-full px-2 text-[11px] sm:text-sm sm:h-9 sm:px-3 min-w-0"
                  >
                    <Link to="/me">Chats</Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    className="tap-exempt h-8 rounded-full bg-grad-primary px-2.5 text-[11px] text-primary-foreground sm:text-sm sm:h-9 sm:px-4 shadow-glow min-w-0"
                  >
                    <Link to="/browse">
                      <Sparkles className="mr-1 h-3 w-3 sm:mr-1.5 sm:h-3.5 sm:w-3.5" /> Enter
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="tap-exempt h-8 rounded-full px-2 text-[11px] sm:text-sm text-white/80 sm:h-9 sm:px-3 min-w-0"
                  >
                    <Link to="/auth" search={{ mode: "signin" } as any}>
                      Login
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    className="tap-exempt hidden min-[360px]:inline-flex h-8 rounded-full bg-grad-primary px-2.5 text-[11px] text-primary-foreground sm:text-sm sm:h-9 sm:px-4 shadow-glow min-w-0"
                  >
                    <Link to="/auth">Sign Up</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        {bannerText ? (
          <div className="bg-primary/15 px-4 py-2 text-center text-sm font-medium text-primary">
            {bannerText}
          </div>
        ) : null}

        {/* TOP PROMOTIONAL BANNER — Premium, Modern, Custom Glassmorphic design */}
        <section className="mx-auto mt-4 max-w-7xl px-4 md:px-6">
          <Link
            to="/auth"
            className="group relative flex flex-col sm:flex-row items-center justify-between gap-4 overflow-hidden rounded-3xl border border-pink-500/20 bg-gradient-to-r from-[#170a25] via-[#2f0f35] to-[#120822] px-6 py-4 text-white shadow-glow transition hover:border-pink-500/40 hover:shadow-[0_0_25px_rgba(244,63,94,0.15)]"
          >
            {/* Background glowing blobs */}
            <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-pink-500/10 blur-3xl group-hover:bg-pink-500/20 transition-all duration-700" />
            <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-purple-500/10 blur-3xl group-hover:bg-purple-500/20 transition-all duration-700" />

            <div className="flex items-center gap-4 z-10">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-400 text-2xl shadow-glow">
                ✨
              </span>
              <div>
                <p className="font-display text-base font-extrabold tracking-wide uppercase text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-rose-300 to-purple-400 drop-shadow">
                  EXCLUSIVE SPECIAL OFFER
                </p>
                <p className="text-xs text-white/70 mt-0.5 font-light">
                  Get <strong className="text-white font-semibold">25 Free Messages</strong>{" "}
                  instantly on registration · No credit card required.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 z-10">
              <span className="rounded-full bg-white text-black px-5 py-2 text-xs font-extrabold tracking-wider uppercase shadow-lg group-hover:bg-pink-500 group-hover:text-white transition-all duration-300">
                Claim Free Chats
              </span>
            </div>
          </Link>
        </section>

        {/* BANNER SLIDER */}
        <section className="mx-auto mt-3 max-w-7xl px-4 md:px-6">
          <BannerSlider slides={bannerSlides} onPick={(c) => setTease(c)} />
        </section>

        {/* NEW EXPERIENCES — Candy.ai Style Cards */}
        <section className="mx-auto mt-6 max-w-7xl px-4 md:px-6">
          <SectionTitle
            title="🔥 New Experiences"
            subtitle="explore exclusive features & create your companion"
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Card 1: Create Your Own Character */}
            <Link
              to="/create"
              className="group relative flex h-44 flex-col justify-between overflow-hidden rounded-3xl border border-pink-500/20 bg-gradient-to-br from-[#240b36] via-[#c31432]/10 to-[#050308] p-5 text-white shadow-lg transition duration-300 hover:scale-[1.02] hover:border-pink-500/60 hover:shadow-[0_0_25px_rgba(236,72,153,0.15)]"
            >
              <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-pink-500/10 blur-2xl group-hover:bg-pink-500/20 transition duration-500" />
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pink-400 border border-pink-500/30">
                  <Sparkles className="h-3 w-3" /> Custom AI
                </span>
                <h3 className="mt-2.5 font-display text-lg font-extrabold text-white tracking-wide">
                  CREATE YOUR OWN MODEL
                </h3>
                <p className="mt-1 text-xs text-white/70 line-clamp-2 font-light">
                  Build your dream AI companion. Pick face, body type, personality & style.
                </p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-bold text-white shadow-glow group-hover:brightness-110 transition">
                  <Wand2 className="h-3.5 w-3.5" /> Create Model
                </span>
              </div>
            </Link>

            {/* Card 2: Build Your Video */}
            <Link
              to="/cams"
              className="group relative flex h-44 flex-col justify-between overflow-hidden rounded-3xl border border-rose-500/20 bg-gradient-to-br from-[#3a0d18] via-[#e52d27]/10 to-[#050308] p-5 text-white shadow-lg transition duration-300 hover:scale-[1.02] hover:border-rose-500/60 hover:shadow-[0_0_25px_rgba(244,63,94,0.15)]"
            >
              <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-rose-500/10 blur-2xl group-hover:bg-rose-500/20 transition duration-500" />
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-400 border border-rose-500/30">
                  <Circle className="h-2 w-2 fill-rose-500 animate-pulse" /> Live Cams
                </span>
                <h3 className="mt-2.5 font-display text-lg font-extrabold text-white tracking-wide">
                  BUILD YOUR VIDEO
                </h3>
                <p className="mt-1 text-xs text-white/70 line-clamp-2 font-light">
                  Super hot models in motion. Real video loops, live interaction & camera scenes.
                </p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-1.5 text-xs font-bold text-white border border-white/10 backdrop-blur group-hover:bg-white/10 group-hover:border-white/20 transition">
                  <Video className="h-3.5 w-3.5 text-rose-400" /> Watch Live Loops
                </span>
              </div>
            </Link>

            {/* Card 3: Private Content */}
            <Link
              to="/gallery"
              className="group relative flex h-44 flex-col justify-between overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-[#0f172a] via-[#1e1b4b]/20 to-[#050308] p-5 text-white shadow-lg transition duration-300 hover:scale-[1.02] hover:border-indigo-500/60 hover:shadow-[0_0_25px_rgba(99,102,241,0.15)]"
            >
              <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-indigo-500/10 blur-2xl group-hover:bg-indigo-500/20 transition duration-500" />
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-400 border border-indigo-500/30">
                  <Lock className="h-3 w-3" /> Exclusive
                </span>
                <h3 className="mt-2.5 font-display text-lg font-extrabold text-white tracking-wide">
                  PRIVATE CONTENT
                </h3>
                <p className="mt-1 text-xs text-white/70 line-clamp-2 font-light">
                  Unlock exclusive secret photos, voice notes, and private album collections.
                </p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-1.5 text-xs font-bold text-white border border-white/10 backdrop-blur group-hover:bg-white/10 group-hover:border-white/20 transition">
                  <Lock className="h-3.5 w-3.5 text-indigo-400" /> Unlock Gallery
                </span>
              </div>
            </Link>
          </div>
        </section>

        {/* LIVE NOW */}
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
          <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {liveNow.map((c) => {
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
                    <p className="line-clamp-1 text-[11px] text-white/80">
                      {c.short_bio || c.ethnicity}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* EXPLORE FEATURED CHARACTERS SECTION (Candy.ai style filter & grid) */}
        <section className="mx-auto mt-10 max-w-7xl px-4 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-white/5 pb-4">
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl text-white">
                Explore Featured Characters
              </h2>
              <p className="text-xs text-white/50 mt-0.5">tap anyone — they message you first</p>
            </div>

            {/* Search + Category Filter Strip */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* Search Bar */}
              <div className="relative flex-1 sm:w-60 min-w-[200px]">
                <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  placeholder="Search characters..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-xs text-white placeholder-white/30 hover:border-white/20 focus:border-pink-500/50 focus:outline-none focus:ring-1 focus:ring-pink-500/30 transition duration-300"
                />
              </div>

              {/* Category Pills Slider */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {visibleCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCat(cat)}
                    className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold border transition duration-300 ${
                      activeCat === cat
                        ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white border-transparent shadow-[0_0_15px_rgba(244,63,94,0.25)]"
                        : "border-white/10 bg-white/5 text-white/50 hover:text-white hover:border-white/20"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Grid of character cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((c, index) => {
              const reel = getEffectiveCompanionReel(c);
              const isNew = index === 0; // Highlight the first one as NEW
              return (
                <button
                  key={c.id}
                  onClick={() => setTease(c)}
                  className="group relative overflow-hidden rounded-3xl border border-white/5 bg-[#0a070e]/80 text-left shadow-lg transition duration-300 hover:shadow-[0_0_25px_rgba(244,63,94,0.15)] hover:border-pink-500/30"
                >
                  <div className="relative w-full aspect-[2/3] overflow-hidden">
                    <img
                      src={companionImage(c.image_url)}
                      alt={c.name}
                      loading="lazy"
                      className="h-full w-full object-cover object-top transition duration-700 ease-out group-hover:scale-[1.05]"
                    />

                    {/* Badge: NEW */}
                    {isNew && (
                      <div className="absolute left-3 top-3 z-10 rounded-md bg-grad-primary px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-primary-foreground shadow-glow animate-pulse">
                        New
                      </div>
                    )}

                    {/* Online status indicator */}
                    <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[9px] backdrop-blur border border-white/10">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />{" "}
                      online
                    </div>

                    {/* Quick action buttons / icons overlay (lock, video) */}
                    <div className="absolute right-3 top-10 flex flex-col gap-1.5">
                      {reel && (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/80 shadow-md">
                          <Video className="h-3 w-3 text-red-400" />
                        </div>
                      )}
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/80 shadow-md">
                        <Lock className="h-3 w-3 text-indigo-400" />
                      </div>
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-t from-[#0a070e] via-transparent to-transparent pointer-events-none" />

                    <div className="absolute inset-x-0 bottom-0 p-3.5 pt-6 z-10">
                      <div className="flex items-baseline justify-between">
                        <h3 className="font-display text-base font-bold text-white md:text-lg drop-shadow">
                          {c.name}, {c.age}
                        </h3>
                      </div>
                      <p className="text-[10px] uppercase tracking-wider text-pink-400 font-bold">
                        {c.ethnicity}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-white/70 leading-relaxed font-light">
                        {c.short_bio}
                      </p>

                      <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-3.5 py-1.5 text-[10px] font-bold text-white shadow-md transition-all duration-300 group-hover:scale-105 group-hover:brightness-110">
                        <MessageCircle className="h-3.5 w-3.5" /> Chat now
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ANIME COMPANIONS SECTION (Bottom of homepage) */}
        {(() => {
          const animeComps = (companions ?? []).filter(
            (c) => c.art_style === "anime" || (c.image_url || "").includes("anime"),
          );
          if (!animeComps.length) return null;
          return (
            <section className="mx-auto mt-14 max-w-7xl px-4 lg:px-6">
              <SectionTitle
                title="🌀 Anime Companions"
                subtitle="highly flirty & sexy 2D crushes"
              />
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {animeComps.map((c) => {
                  const reel = getEffectiveCompanionReel(c);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setTease(c)}
                      className="group relative overflow-hidden rounded-3xl border border-purple-500/20 bg-[#0a070e]/80 text-left shadow-lg transition duration-300 hover:shadow-[0_0_25px_rgba(168,85,247,0.2)] hover:border-purple-500/50"
                    >
                      <div className="relative w-full aspect-[2/3] overflow-hidden">
                        <img
                          src={companionImage(c.image_url)}
                          alt={c.name}
                          loading="lazy"
                          className="h-full w-full object-cover object-top transition duration-700 ease-out group-hover:scale-[1.05]"
                        />

                        {/* Quick action buttons / icons overlay (lock, video) */}
                        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
                          {reel && (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/80 shadow-md">
                              <Video className="h-3 w-3 text-red-400" />
                            </div>
                          )}
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/80 shadow-md">
                            <Lock className="h-3 w-3 text-indigo-400" />
                          </div>
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-[#0a070e] via-transparent to-transparent pointer-events-none" />

                        <div className="absolute inset-x-0 bottom-0 p-3.5 pt-6 z-10">
                          <h3 className="font-display text-sm font-bold text-white drop-shadow">
                            {c.name}, {c.age}
                          </h3>
                          <p className="text-[9px] uppercase tracking-wider text-purple-400 font-bold">
                            {c.ethnicity} · Anime
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-[10px] text-white/70 leading-relaxed font-light">
                            {c.short_bio}
                          </p>

                          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1 text-[9px] font-bold text-white shadow-md transition-all duration-300 group-hover:scale-105 group-hover:brightness-110">
                            <MessageCircle className="h-3 w-3" /> Chat now
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })()}

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
    <div className="flex items-end justify-between gap-3 border-l-4 border-pink-500 pl-3 py-0.5">
      <div>
        <h2 className="font-display text-base font-extrabold tracking-wider uppercase text-white md:text-lg drop-shadow-sm">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[11px] text-white/50 mt-0.5 font-light tracking-wide">{subtitle}</p>
        )}
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
              <Link to="/auth" search={{ mode: "signin" } as any}>
                Sign in
              </Link>
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
          <div
            className="h-full bg-white transition-all duration-75"
            style={{ width: `${progress}%` }}
          />
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
              <span className="text-sm font-bold text-white leading-tight">
                {companion.name}, {companion.age}
              </span>
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

  const reel = !reelFailed ? getEffectiveCompanionReel(companion) : null;

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
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Smiling at
                  you 💋
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
  // The clip is not even requested until the card is near the screen. Fourteen
  // "Live now" cards each preloading a 1-2MB reel was the single biggest
  // download on the page, most of it for cards nobody had scrolled to.
  const [near, setNear] = useState(false);

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

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setNear(true);
            playVideo();
          } else if (!video.paused) {
            // Off screen it stops decoding, which on a phone is the difference
            // between a smooth scroll and a stutter.
            video.pause();
          }
        });
      },
      { threshold: 0.01, rootMargin: "200px" },
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={near ? src : undefined}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload={near ? "auto" : "none"}
      onError={onError}
      onLoadedData={(e) => e.currentTarget.play().catch(() => {})}
      onCanPlay={(e) => e.currentTarget.play().catch(() => {})}
      className={className}
    />
  );
}

// The admin's "System status" line (Platform Content tab), under the sidebar
// links. It was saved and shown nowhere.
function SystemStatusNote() {
  const status = useSystemStatus();
  if (!status) return null;
  return (
    <p className="px-3 text-[10px] leading-snug text-white/35">
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
      {status}
    </p>
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
    // 7s rather than 5: the clip for a slide only starts loading when that
    // slide is on screen, and the storage it comes from is not fast.
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 7000);
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
      className="relative overflow-hidden rounded-3xl border border-white/10 shadow-[0_0_35px_rgba(168,85,247,0.1)] select-none bg-[#0a0710]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex w-full h-[520px] sm:h-[600px] md:h-[650px] transition-transform duration-700 ease-out"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => s.companion && onPick(s.companion)}
            className="group relative flex flex-col md:flex-row h-full w-full shrink-0 overflow-hidden text-left bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950"
            aria-label={s.companion ? `Chat with ${s.companion.name}` : s.title}
          >
            {/* Ambient blurred backdrop */}
            {s.companion ? (
              <img
                src={companionImage(s.companion.image_url)}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-3xl opacity-20 scale-125 z-0"
              />
            ) : null}

            {/* Mobile-only background video/image (takes full screen on mobile).
                Only the slide on screen gets a <video>: every slide used to
                mount one with preload="auto", so the page downloaded every
                reel at once — on a phone, tens of megabytes before anything
                below the fold could load. */}
            {s.reel && i === idx ? (
              <video
                key={s.reel + "-mobile"}
                src={s.reel}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                poster={s.companion ? companionImage(s.companion.image_url) : undefined}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover md:hidden z-0 opacity-60"
              />
            ) : s.companion ? (
              <img
                src={companionImage(s.companion.image_url)}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover md:hidden z-0 opacity-60"
              />
            ) : null}

            {/* Content panel */}
            <div className="relative z-10 flex flex-col justify-end md:justify-center w-full md:w-1/2 h-full p-6 sm:p-8 md:p-12 md:pr-4 bg-gradient-to-t from-black via-black/40 to-transparent md:from-transparent md:to-transparent">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                  <Circle className="h-1.5 w-1.5 fill-white text-white animate-pulse" /> Live
                </span>
                {s.companion?.gender === "trans-female" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300 border border-indigo-500/25">
                    TS
                  </span>
                )}
              </div>

              <div className="mt-3 flex items-center gap-3 md:gap-4">
                {s.companion && (
                  <img
                    src={companionImage(s.companion.image_url)}
                    alt={s.companion.name}
                    className="h-12 w-12 shrink-0 rounded-full object-cover object-top ring-2 ring-primary/80 shadow-lg md:h-16 md:w-16"
                  />
                )}
                <div>
                  <h2 className="font-display text-2xl font-bold text-white drop-shadow md:text-4xl">
                    {s.companion ? `${s.companion.name}, ${s.companion.age}` : s.title}
                  </h2>
                  <p className="text-[10px] md:text-xs uppercase tracking-widest text-primary font-bold mt-0.5">
                    {s.companion?.ethnicity || "Companion"}
                  </p>
                </div>
              </div>

              <p className="mt-4 max-w-md text-xs text-white/85 line-clamp-3 md:text-base md:line-clamp-4 leading-relaxed font-light">
                {s.companion?.short_bio ?? s.sub}
              </p>

              {s.companion && (
                <div className="mt-6">
                  <span className="inline-flex items-center gap-2 rounded-full bg-grad-primary px-6 py-2.5 text-xs md:text-sm font-bold text-primary-foreground shadow-glow group-hover:scale-[1.03] transition-transform duration-300">
                    Chat with {s.companion.name} <MessageCircle className="h-4 w-4" />
                  </span>
                </div>
              )}
            </div>

            {/* Desktop-only Video player panel */}
            <div className="relative z-10 hidden md:flex w-1/2 h-full items-center justify-center p-3 lg:p-4">
              <div className="relative h-[94%] w-auto aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl transition duration-500 group-hover:border-primary/30 group-hover:shadow-glow">
                {s.reel && i === idx ? (
                  <video
                    key={s.reel + "-desktop"}
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
                    className="pointer-events-none h-full w-full object-cover object-center scale-[1.18] transition duration-500"
                  />
                ) : s.companion ? (
                  <img
                    src={companionImage(s.companion.image_url)}
                    alt={s.companion.name}
                    className="pointer-events-none h-full w-full object-cover object-center animate-live scale-[1.18] transition duration-500"
                  />
                ) : (
                  <div className="h-full w-full bg-neutral-950" />
                )}
                {/* Visual shadow overlay inside the video frame */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
              </div>
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
