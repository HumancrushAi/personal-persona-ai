import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { FAQSection } from "@/components/FAQSection";

// Hero reels live in the Supabase Storage public `reels` bucket — a mix of guys
// and girls. gender = who's in the clip, so the CTA opens a gender-matched model.
const REEL_BASE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/reels`;
const reelUrlHelper = (name: string) => `${REEL_BASE}/${name}.mp4`;
const BANNERS: { reel: string; title: string; sub: string; gender: "m" | "f" }[] = [
  { reel: reelUrlHelper("r10"), title: "Pool boy", sub: "abs, dripping wet, all yours 🔥", gender: "m" },
  {
    reel: reelUrlHelper("r1"),
    title: "After hours",
    sub: "still up… thinking about you 😏",
    gender: "f",
  },
  { reel: reelUrlHelper("r11"), title: "Beach hunk", sub: "sunset stroll · shirt optional", gender: "m" },
  { reel: reelUrlHelper("r8"), title: "Just woke up", sub: "come back to bed 💋", gender: "f" },
  { reel: reelUrlHelper("r3"), title: "Sunset vibes", sub: "wish you were here 🌅", gender: "f" },
];


export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "HumanCrush.com — Your AI Crush, Built Exactly Your Way" },
      {
        name: "description",
        content:
          "36 stunning AI companions — women, men, trans, non-binary. Stories, real reels, voice notes, selfies. 25 free messages, no card. 18+ only.",
      },
      { property: "og:title", content: "HumanCrush.com — Your AI Crush" },
      {
        property: "og:description",
        content:
          "Talk, flirt, sext with the crush of your choice. Reels, AI selfies and voice notes. 25 free messages.",
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
  (n: string) => `${n} here 💋 — what are you wearing right now? don't lie to me.`,
  (n: string) => `you came to the right one baby. it's ${n}. what's on your mind tonight?`,
  (n: string) => `wait. you're cute. i'm ${n}, by the way 😏 what should i call you?`,
  (n: string) => `${n}. been waiting for you all night. don't make me wait again 🔥`,
  (n: string) => `hi stranger… i'm ${n}. wanna keep me company? i'm bored 💔`,
  (n: string) => `okay you tapped me first 😌 that means you owe me a story. i'm ${n}.`,
  (n: string) => `${n} 💗 just got out of the shower lol. perfect timing huh?`,
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

  // Match each hero reel to a gender-correct model to chat with.
  const pickCompanion = (i: number, vid: "m" | "f"): Companion | null => {
    const list = companions ?? [];
    const pool = list.filter((c) =>
      vid === "m"
        ? c.gender === "male" || c.gender === "trans-male"
        : c.gender === "female" || c.gender === "trans-female",
    );
    const from = pool.length ? pool : list;
    return from.length ? from[i % from.length] : null;
  };
  const bannerSlides = BANNERS.map((b, i) => ({ ...b, companion: pickCompanion(i, b.gender) }));

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
                She's whoever <span className="text-primary">you</span> want her to be.
              </h1>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground md:text-base">
                Tap anyone below — they message you first.
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

          {/* SEARCH */}
          <div className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, vibes, kinks…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </section>

      {/* STORIES */}
      <section className="mx-auto mt-6 max-w-7xl px-4 md:px-6">
        <SectionTitle title="Stories" subtitle="tap to peek" />
        <div className="-mx-2 mt-3 flex gap-3 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {searchedCompanions.map((c) => (
            <button
              key={c.id}
              onClick={() => setStoryView(c)}
              className="group flex w-[78px] shrink-0 flex-col items-center gap-1.5"
            >
              <span className="rounded-full bg-grad-primary p-[2px] shadow-glow">
                <span className="block rounded-full bg-background p-[2px]">
                  <img
                    src={companionImage(c.image_url)}
                    alt={c.name}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                </span>
              </span>
              <span className="line-clamp-1 text-[11px] text-white/80">{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="mx-auto mt-4 max-w-7xl px-4 md:px-6">
        <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition ${
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
          {searchedCompanions.slice(0, 14).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setTease(c)}
              className="group relative h-[300px] w-[180px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-card text-left shadow-md md:h-[360px] md:w-[220px]"
            >
              <img
                src={companionImage(c.image_url)}
                alt={c.name}
                loading="lazy"
                className="animate-live absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium backdrop-blur">
                  <Circle className="h-1.5 w-1.5 fill-red-500 text-red-500" /> LIVE
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 text-left">
                <p className="font-display text-sm font-semibold text-white">
                  {c.name}, {c.age}
                </p>
                <p className="line-clamp-1 text-[11px] text-white/75">{c.ethnicity}</p>
              </div>
            </button>
          ))}
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
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-card text-left shadow-md transition hover:shadow-glow"
            >
              <img
                src={companionImage(c.image_url)}
                alt={c.name}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover transition group-hover:scale-[1.05]"
              />
              <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> online
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-base font-semibold text-white md:text-lg">
                    {c.name}, {c.age}
                  </h3>
                </div>
                <p className="text-[10px] uppercase tracking-wide text-white/70">{c.ethnicity}</p>
                <p className="mt-1 line-clamp-2 text-[11px] text-white/85 md:text-xs">
                  {c.short_bio}
                </p>
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-grad-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">
                  <MessageCircle className="h-3 w-3" /> Chat now
                </span>
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
              d: "She sends nudes & lewds on request.",
            },
            { i: <Mic className="h-5 w-5" />, t: "Voice notes", d: "Hear her moan your name." },
            {
              i: <Sparkles className="h-5 w-5" />,
              t: "Roleplay scenes",
              d: "First date, secretary, dom/sub…",
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

      {storyView && (
        <StoryViewer
          companion={storyView}
          onClose={() => setStoryView(null)}
          onChat={() => {
            setTease(storyView);
            setStoryView(null);
          }}
        />
      )}
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
            HumanCrush.com
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
          >
            <Link to="/cams">
              <Circle className="mr-1 h-2 w-2 fill-red-500 text-red-500" /> Live
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
          >
            <Link to="/gallery">Gallery</Link>
          </Button>
          {authed ? (
            <>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
              >
                <Link to="/me">My chats</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="h-8 rounded-full bg-grad-primary px-2.5 text-xs text-primary-foreground sm:h-9 sm:px-3.5 sm:text-sm"
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
              className="h-8 rounded-full bg-grad-primary px-2.5 text-xs text-primary-foreground sm:h-9 sm:px-3.5 sm:text-sm"
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
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / 5000) * 100);
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
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/95 p-4"
      onClick={onClose}
    >
      <div
        className="relative h-[90vh] w-full max-w-md overflow-hidden rounded-3xl bg-black"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-3 top-3 z-10 h-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white" style={{ width: `${progress}%` }} />
        </div>
        <div className="absolute inset-x-3 top-6 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src={companionImage(companion.image_url)}
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
            <span className="text-sm font-semibold text-white">{companion.name}</span>
          </div>
          <button onClick={onClose} className="rounded-full bg-black/40 p-1.5 text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <img
          src={companionImage(companion.image_url)}
          alt={companion.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-5">
          <p className="text-sm text-white/90">{companion.short_bio}</p>
          <Button
            onClick={onChat}
            className="mt-3 w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
          >
            <MessageCircle className="mr-2 h-4 w-4" /> Message {companion.name}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Tease Chat (signup gate) ---------- */
function TeaseChat({ companion, onClose }: { companion: Companion; onClose: () => void }) {
  const navigate = useNavigate();
  const openChat = useServerFn(startChat);
  const [typing, setTyping] = useState(true);
  const [showMsg, setShowMsg] = useState(false);
  const [input, setInput] = useState("");
  const [gate, setGate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="relative flex h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-card shadow-glow md:h-[640px] md:rounded-3xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-background/60 p-3 backdrop-blur">
          <img
            src={companionImage(companion.image_url)}
            className="h-10 w-10 rounded-full object-cover"
            alt=""
          />
          <div className="flex-1">
            <p className="font-display text-sm font-semibold">
              {companion.name}, {companion.age}
            </p>
            <p className="text-[11px] text-emerald-400">● online · typing for you</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="mx-auto max-w-[80%] rounded-full bg-white/5 px-3 py-1 text-center text-[10px] text-muted-foreground">
            Today
          </div>
          <div className="flex items-end gap-2">
            <img
              src={companionImage(companion.image_url)}
              className="h-7 w-7 rounded-full object-cover"
              alt=""
            />
            {typing ? (
              <div className="rounded-2xl rounded-bl-sm bg-white/8 px-4 py-3">
                <div className="flex gap-1">
                  <Dot />
                  <Dot delay={0.15} />
                  <Dot delay={0.3} />
                </div>
              </div>
            ) : (
              showMsg && (
                <div className="max-w-[78%] rounded-2xl rounded-bl-sm bg-white/8 px-4 py-2.5 text-sm">
                  {opener(companion.name, companion.id)}
                </div>
              )
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-white/10 bg-background/70 p-3 backdrop-blur">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              triggerGate();
            }}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1.5"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => onChange(e.target.value)}
              placeholder={`Message ${companion.name}…`}
              className="h-9 flex-1 border-0 bg-transparent text-sm focus-visible:ring-0"
            />
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 rounded-full bg-grad-primary text-primary-foreground"
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
          className="mx-auto h-16 w-16 rounded-full object-cover ring-2 ring-primary"
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
      <div className="h-[260px] animate-pulse rounded-3xl border border-white/10 bg-white/5 md:h-[420px]" />
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
        className="flex h-[260px] transition-transform duration-700 ease-out md:h-[420px]"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => s.companion && onPick(s.companion)}
            className="group relative block h-full w-full shrink-0 overflow-hidden text-left"
            aria-label={s.companion ? `Chat with ${s.companion.name}` : s.title}
          >
            {i === idx ? (
              <video
                src={s.reel}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover animate-in fade-in duration-300"
              />
            ) : s.companion ? (
              <img
                src={companionImage(s.companion.image_url)}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover brightness-[0.35]"
              />
            ) : (
              <div className="absolute inset-0 bg-neutral-950" />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/30" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 md:p-7">
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <Circle className="h-1.5 w-1.5 fill-white text-white" /> Live
              </span>
              <h2 className="mt-2 font-display text-2xl font-semibold text-white drop-shadow md:text-4xl">
                {s.companion ? `${s.companion.name}, ${s.companion.age}` : s.title}
              </h2>
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
        className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white backdrop-blur hover:bg-black/75 md:left-4"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          go(1);
        }}
        aria-label="Next"
        className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white backdrop-blur hover:bg-black/75 md:right-4"
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
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
