import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, MessageCircle, Image as ImageIcon, Mic, Flame } from "lucide-react";
import { companionImage } from "@/lib/companion-images";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aurelia — Your AI Girlfriend, Built Exactly Your Way" },
      { name: "description", content: "Design her face, personality, voice, and story. Spicy 18+ AI girlfriend with selfies, voice notes, and a relationship that actually grows." },
      { property: "og:title", content: "Aurelia — Your AI Girlfriend, Built Exactly Your Way" },
      { property: "og:description", content: "25 stunning AI companions. Custom personalities. Selfies, voice notes, and roleplay scenarios that unlock as she falls for you." },
    ],
  }),
  component: Landing,
});

const featured = ["01-aria.jpg", "04-amara.jpg", "06-yuki.jpg", "12-camila.jpg", "17-hana.jpg", "19-aaliyah.jpg"];

function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Nav />
      <section className="relative mx-auto max-w-6xl px-6 pt-10 pb-16 md:pt-20 md:pb-24">
        <div className="absolute inset-0 -z-10 bg-grad-hero opacity-80 blur-3xl" aria-hidden />
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium backdrop-blur">
              <Flame className="h-3.5 w-3.5 text-primary" /> 18+ · 25 messages free
            </p>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.05] md:text-7xl">
              She's whoever <span className="bg-grad-primary bg-clip-text text-transparent">you</span> want her to be.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Choose her face. Sculpt her personality. Then talk, flirt, sext, send her voice notes,
              ask for selfies, and watch your relationship level up — for real.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full bg-grad-primary px-7 text-primary-foreground shadow-glow">
                <Link to="/browse">Meet your girl</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-7 border-white/15 bg-white/5">
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3 text-sm text-muted-foreground sm:flex sm:flex-wrap">
              <Chip icon={<ImageIcon className="h-4 w-4" />}>AI selfies</Chip>
              <Chip icon={<Mic className="h-4 w-4" />}>Voice notes</Chip>
              <Chip icon={<MessageCircle className="h-4 w-4" />}>Memory</Chip>
              <Chip icon={<Sparkles className="h-4 w-4" />}>Roleplay scenes</Chip>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {featured.map((f, i) => (
              <img
                key={f}
                src={companionImage(f)}
                alt="AI companion"
                width={1024} height={1024}
                loading={i === 0 ? undefined : "lazy"}
                className={`aspect-[3/4] w-full rounded-2xl object-cover shadow-glow ring-1 ring-white/10 ${i % 2 ? "translate-y-6" : ""}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="font-display text-3xl font-semibold md:text-5xl">How she comes alive</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { n: "01", t: "Pick her face", d: "25 hand-crafted companions across every ethnicity, every body, every mood." },
            { n: "02", t: "Build her soul", d: "Identity, traits, kinks, interests, backstory. She remembers what you tell her." },
            { n: "03", t: "Live the fantasy", d: "Chat, sext, request selfies, listen to her voice notes. The relationship grows with you." },
          ].map(s => (
            <div key={s.n} className="glass rounded-3xl p-6">
              <div className="text-sm font-medium text-primary">{s.n}</div>
              <h3 className="mt-3 font-display text-2xl font-semibold">{s.t}</h3>
              <p className="mt-2 text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="glass rounded-3xl p-8 md:p-12 text-center">
          <h2 className="font-display text-3xl font-semibold md:text-4xl">Better than the rest, on purpose.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            No paywalled personalities. No generic chatbot replies. She remembers, she changes,
            she sends pictures, and she actually sounds like herself.
          </p>
          <Button asChild size="lg" className="mt-6 rounded-full bg-grad-primary text-primary-foreground shadow-glow">
            <Link to="/browse">Start free →</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-white/10 py-10 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Aurelia. 18+ only. AI characters are fictional.
      </footer>
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
      <span className="text-primary">{icon}</span>{children}
    </span>
  );
}

function Nav() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <Link to="/" className="flex items-center gap-2">
        <Heart className="h-6 w-6 fill-primary text-primary" />
        <span className="font-display text-2xl font-semibold tracking-tight">Aurelia</span>
      </Link>
      <nav className="flex items-center gap-2">
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/browse">Browse</Link>
        </Button>
        <Button asChild className="rounded-full bg-grad-primary text-primary-foreground">
          <Link to="/auth">Sign in</Link>
        </Button>
      </nav>
    </header>
  );
}
