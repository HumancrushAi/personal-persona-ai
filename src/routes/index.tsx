import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, MessageCircle, Lock } from "lucide-react";
import { companionImage } from "@/lib/companion-images";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aurelia — Your AI Companion, Designed by You" },
      { name: "description", content: "Build the AI girlfriend you've always wanted. Customize her personality, looks, interests, and story. 25 free messages on us." },
      { property: "og:title", content: "Aurelia — Your AI Companion, Designed by You" },
      { property: "og:description", content: "Build the AI girlfriend you've always wanted. 25 free messages on us." },
    ],
  }),
  component: Landing,
});

const featured = ["01-aria.jpg", "04-amara.jpg", "06-yuki.jpg", "12-camila.jpg", "17-hana.jpg", "19-aaliyah.jpg"];

function Landing() {
  return (
    <div className="min-h-screen">
      <Nav />
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 md:pt-28 md:pb-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              <Sparkles className="h-3.5 w-3.5" /> 25 free messages on us
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-tight md:text-6xl">
              The companion you've <span className="text-primary italic">always</span> imagined.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              Choose from 25 stunning AI companions across every ethnicity. Then shape her personality,
              interests, style, and story — until she's exactly the woman you want to talk to.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full px-7">
                <Link to="/browse">Meet your match</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-7">
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2"><Heart className="h-4 w-4 text-primary" /> Custom personality</span>
              <span className="inline-flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /> Saved chats</span>
              <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> Private &amp; secure</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {featured.map((f, i) => (
              <img
                key={f}
                src={companionImage(f)}
                alt="AI companion portrait"
                width={1024} height={1024}
                loading={i === 0 ? undefined : "lazy"}
                className={`aspect-[3/4] w-full rounded-2xl object-cover shadow-lg ${i % 2 ? "translate-y-6" : ""}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-3xl font-semibold md:text-4xl">How it works</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            { n: "01", t: "Pick her face", d: "Browse 25 hand-crafted AI companions across every ethnicity." },
            { n: "02", t: "Build her soul", d: "Define identity, traits, interests, and the backstory you want." },
            { n: "03", t: "Talk forever", d: "25 free messages, then tiny credit packs from $5. No subscriptions." },
          ].map(s => (
            <div key={s.n} className="rounded-3xl border bg-card p-6 shadow-sm">
              <div className="text-sm font-medium text-primary">{s.n}</div>
              <h3 className="mt-3 text-xl font-semibold">{s.t}</h3>
              <p className="mt-2 text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t bg-card/50 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Aurelia. For ages 18+. Be kind to your companion.
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <Link to="/" className="flex items-center gap-2">
        <Heart className="h-6 w-6 fill-primary text-primary" />
        <span className="font-display text-2xl font-semibold">Aurelia</span>
      </Link>
      <nav className="flex items-center gap-2">
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/browse">Browse</Link>
        </Button>
        <Button asChild className="rounded-full">
          <Link to="/auth">Sign in</Link>
        </Button>
      </nav>
    </header>
  );
}
