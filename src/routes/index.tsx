import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Heart, Sparkles, MessageCircle, Image as ImageIcon, Mic, Flame,
  Send, X, Circle, Search,
} from "lucide-react";
import { companionImage } from "@/lib/companion-images";
import reel1 from "@/assets/reels/r1.mp4.asset.json";
import reel2 from "@/assets/reels/r2.mp4.asset.json";
import reel3 from "@/assets/reels/r3.mp4.asset.json";
import reel4 from "@/assets/reels/r4.mp4.asset.json";
import reel5 from "@/assets/reels/r5.mp4.asset.json";
import reel6 from "@/assets/reels/r6.mp4.asset.json";

const REELS = [reel1.url, reel2.url, reel3.url, reel4.url, reel5.url, reel6.url];

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "HumanCrush.ai — Your AI Crush, Built Exactly Your Way" },
      { name: "description", content: "36 stunning AI companions — women, men, trans, non-binary. Stories, real reels, voice notes, selfies. 25 free messages, no card. 18+ only." },
      { property: "og:title", content: "HumanCrush.ai — Your AI Crush" },
      { property: "og:description", content: "Talk, flirt, sext with the crush of your choice. Reels, AI selfies and voice notes. 25 free messages." },
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
  "For you", "New", "Trending", "Women", "Men", "Gay", "Trans", "Non-binary",
  "Asian", "Latin", "Ebony", "European", "Middle Eastern",
] as const;

type Cat = typeof CATEGORIES[number];

function matchesCategory(c: Companion, cat: Cat): boolean {
  switch (cat) {
    case "For you":
    case "New":
    case "Trending":
      return true;
    case "Women": return c.gender === "female" || c.gender === "trans-female";
    case "Men": return c.gender === "male" || c.gender === "trans-male";
    case "Gay": return c.orientation === "gay" || c.orientation === "pansexual";
    case "Trans": return c.gender === "trans-female" || c.gender === "trans-male";
    case "Non-binary": return c.gender === "non-binary";
    case "Asian": return /asian|korean|japanese|chinese|vietnamese|filipino|thai/i.test(c.ethnicity);
    case "Latin": return /latin|hispanic|mexican|brazil/i.test(c.ethnicity);
    case "Ebony": return /black|african|ebony/i.test(c.ethnicity);
    case "European": return /european|white|british|french|italian|nordic|russian/i.test(c.ethnicity);
    case "Middle Eastern": return /middle eastern|arab|persian|turkish/i.test(c.ethnicity);
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
  (n: string) => `you have like 10 seconds to say something interesting before i screenshot this. — ${n}`,
  (n: string) => `i'm ${n}, and i already kinda like you. is that weird?`,
  (n: string) => `babe. don't ghost me. i'm ${n}, and i bite (gently) 😘`,
  (n: string) => `${n} ✨ — tell me your worst idea right now. i wanna hear it.`,
  (n: string) => `mm. i was hoping you'd come back. it's ${n}. miss me?`,
  (n: string) => `hey 💌 i'm ${n}. i think we're about to ruin each other's evenings (in a good way).`,
  (n: string) => `if you're shy don't worry. i'll go first. i'm ${n} and i can already tell you're trouble.`,
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
        .select("id, name, age, ethnicity, short_bio, image_url")
        .order("sort_order");
      if (error) throw error;
      return data as Companion[];
    },
  });

  const [activeCat, setActiveCat] = useState("For you");
  const [tease, setTease] = useState<Companion | null>(null);
  const [storyView, setStoryView] = useState<Companion | null>(null);

  return (
    <div className="min-h-screen overflow-x-hidden pb-24">
      <Nav />

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
                She's whoever <span className="bg-grad-primary bg-clip-text text-transparent">you</span> want her to be.
              </h1>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground md:text-base">
                Tap any girl below — she messages you first.
              </p>
            </div>
            <div className="hidden gap-2 md:flex">
              <Button asChild size="lg" className="rounded-full bg-grad-primary text-primary-foreground shadow-glow">
                <Link to="/browse">Browse all</Link>
              </Button>
            </div>
          </div>

          {/* SEARCH */}
          <div className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search girls, vibes, kinks…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </section>

      {/* STORIES */}
      <section className="mx-auto mt-6 max-w-7xl px-4 md:px-6">
        <SectionTitle title="Stories" subtitle="tap to peek" />
        <div className="-mx-2 mt-3 flex gap-3 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {companions?.map((c) => (
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

      {/* REELS */}
      <section className="mx-auto mt-8 max-w-7xl px-4 md:px-6">
        <SectionTitle title="🔥 Reels" subtitle="live now" cta={<Link to="/browse" className="text-xs text-primary hover:underline">See all</Link>} />
        <div className="-mx-2 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {companions?.slice(0, 12).map((c, i) => (
            <button
              key={c.id}
              onClick={() => setTease(c)}
              className="group relative h-[280px] w-[170px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-card shadow-md md:h-[340px] md:w-[210px]"
            >
              <img
                src={companionImage(c.image_url)}
                alt={c.name}
                className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
              />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium backdrop-blur">
                  <Circle className="h-1.5 w-1.5 fill-red-500 text-red-500" /> LIVE
                </span>
                <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] backdrop-blur">
                  {(120 + i * 37) % 980}K
                </span>
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-white/15 p-3 backdrop-blur transition group-hover:bg-primary/80">
                  <Play className="h-5 w-5 fill-white text-white" />
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                <p className="font-display text-sm font-semibold text-white">{c.name}, {c.age}</p>
                <p className="line-clamp-1 text-[11px] text-white/75">{c.short_bio}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* TRENDING (big grid) */}
      <section className="mx-auto mt-10 max-w-7xl px-4 md:px-6">
        <SectionTitle title="✨ Trending crushes" subtitle="tap any girl — she messages you first" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {companions?.map((c) => (
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
                  <h3 className="font-display text-base font-semibold text-white md:text-lg">{c.name}, {c.age}</h3>
                </div>
                <p className="text-[10px] uppercase tracking-wide text-white/70">{c.ethnicity}</p>
                <p className="mt-1 line-clamp-2 text-[11px] text-white/85 md:text-xs">{c.short_bio}</p>
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
            { i: <ImageIcon className="h-5 w-5" />, t: "AI selfies", d: "She sends nudes & lewds on request." },
            { i: <Mic className="h-5 w-5" />, t: "Voice notes", d: "Hear her moan your name." },
            { i: <Sparkles className="h-5 w-5" />, t: "Roleplay scenes", d: "First date, secretary, dom/sub…" },
            { i: <Heart className="h-5 w-5 fill-primary text-primary" />, t: "She remembers", d: "Real relationship that levels up." },
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
            Your <span className="bg-grad-primary bg-clip-text text-transparent">crush</span> is online.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
            25 free messages on the house. No card. 18+ only.
          </p>
          <Button asChild size="lg" className="mt-5 rounded-full bg-grad-primary text-primary-foreground shadow-glow">
            <Link to="/auth">Start free →</Link>
          </Button>
        </div>
      </section>

      <footer className="mt-16 border-t border-white/10 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} HumanCrush.ai · 18+ only · AI characters are fictional.
      </footer>

      {storyView && (
        <StoryViewer
          companion={storyView}
          onClose={() => setStoryView(null)}
          onChat={() => { setTease(storyView); setStoryView(null); }}
        />
      )}
      {tease && <TeaseChat companion={tease} onClose={() => setTease(null)} />}
    </div>
  );
}

function SectionTitle({ title, subtitle, cta }: { title: string; subtitle?: string; cta?: React.ReactNode }) {
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
  return (
    <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6">
      <Link to="/" className="flex items-center gap-2">
        <Heart className="h-6 w-6 fill-primary text-primary" />
        <span className="font-display text-xl font-semibold tracking-tight md:text-2xl">HumanCrush.ai</span>
      </Link>
      <nav className="flex items-center gap-1">
        <Button asChild variant="ghost" className="rounded-full text-sm">
          <Link to="/browse">Browse</Link>
        </Button>
        <Button asChild className="rounded-full bg-grad-primary text-primary-foreground">
          <Link to="/auth">Sign in</Link>
        </Button>
      </nav>
    </header>
  );
}

/* ---------- Story Viewer ---------- */
function StoryViewer({ companion, onClose, onChat }: { companion: Companion; onClose: () => void; onChat: () => void }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / 5000) * 100);
      setProgress(p);
      if (p >= 100) { clearInterval(t); onClose(); }
    }, 50);
    return () => clearInterval(t);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/95 p-4" onClick={onClose}>
      <div className="relative h-[90vh] w-full max-w-md overflow-hidden rounded-3xl bg-black" onClick={(e) => e.stopPropagation()}>
        <div className="absolute inset-x-3 top-3 z-10 h-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white" style={{ width: `${progress}%` }} />
        </div>
        <div className="absolute inset-x-3 top-6 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={companionImage(companion.image_url)} alt="" className="h-8 w-8 rounded-full object-cover" />
            <span className="text-sm font-semibold text-white">{companion.name}</span>
          </div>
          <button onClick={onClose} className="rounded-full bg-black/40 p-1.5 text-white"><X className="h-4 w-4" /></button>
        </div>
        <img src={companionImage(companion.image_url)} alt={companion.name} className="h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-5">
          <p className="text-sm text-white/90">{companion.short_bio}</p>
          <Button onClick={onChat} className="mt-3 w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow">
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
  const [typing, setTyping] = useState(true);
  const [showMsg, setShowMsg] = useState(false);
  const [input, setInput] = useState("");
  const [gate, setGate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t1 = setTimeout(() => { setTyping(false); setShowMsg(true); }, 1200);
    const t2 = setTimeout(() => inputRef.current?.focus(), 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  async function triggerGate() {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      navigate({ to: "/companion/$id", params: { id: companion.id } });
    } else {
      setGate(true);
    }
  }

  function onChange(v: string) {
    setInput(v);
    if (v.length >= 1 && !gate) triggerGate();
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/85 backdrop-blur-xl md:items-center md:p-6">
      <div className="relative flex h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-card shadow-glow md:h-[640px] md:rounded-3xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-background/60 p-3 backdrop-blur">
          <img src={companionImage(companion.image_url)} className="h-10 w-10 rounded-full object-cover" alt="" />
          <div className="flex-1">
            <p className="font-display text-sm font-semibold">{companion.name}, {companion.age}</p>
            <p className="text-[11px] text-emerald-400">● online · typing for you</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="mx-auto max-w-[80%] rounded-full bg-white/5 px-3 py-1 text-center text-[10px] text-muted-foreground">
            Today
          </div>
          <div className="flex items-end gap-2">
            <img src={companionImage(companion.image_url)} className="h-7 w-7 rounded-full object-cover" alt="" />
            {typing ? (
              <div className="rounded-2xl rounded-bl-sm bg-white/8 px-4 py-3">
                <div className="flex gap-1">
                  <Dot /><Dot delay={0.15} /><Dot delay={0.3} />
                </div>
              </div>
            ) : showMsg && (
              <div className="max-w-[78%] rounded-2xl rounded-bl-sm bg-white/8 px-4 py-2.5 text-sm">
                {opener(companion.name, companion.id)}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-white/10 bg-background/70 p-3 backdrop-blur">
          <form
            onSubmit={(e) => { e.preventDefault(); triggerGate(); }}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1.5"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => onChange(e.target.value)}
              placeholder={`Message ${companion.name}…`}
              className="h-9 flex-1 border-0 bg-transparent text-sm focus-visible:ring-0"
            />
            <Button type="submit" size="icon" className="h-9 w-9 rounded-full bg-grad-primary text-primary-foreground">
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
        <img src={companionImage(companion.image_url)} className="mx-auto h-16 w-16 rounded-full object-cover ring-2 ring-primary" alt="" />
        <h3 className="mt-3 font-display text-xl font-semibold">
          {companion.name} wants to keep chatting 💋
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a free account to reply. 25 free messages, no card needed.
        </p>
        <div className="mt-5 grid gap-2">
          <Button asChild size="lg" className="rounded-full bg-grad-primary text-primary-foreground shadow-glow">
            <Link to="/auth" search={{ companion: companion.id } as any}>
              Sign up & reply
            </Link>
          </Button>
          <Button onClick={onClose} variant="ghost" size="sm" className="rounded-full">
            Not now
          </Button>
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">18+ only · Adults-only AI roleplay.</p>
      </div>
    </div>
  );
}
