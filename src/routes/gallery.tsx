import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, MessageCircle } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/gallery")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Gallery — HumanCrush.com" },
      { name: "description", content: "Browse stunning AI-generated portraits from every HumanCrush companion. Tap any image to start chatting." },
      { property: "og:title", content: "HumanCrush.com Gallery" },
      { property: "og:description", content: "Endless AI-generated crushes — women, men, trans, non-binary, every ethnicity." },
    ],
  }),
  component: GalleryPage,
});

type C = {
  id: string; name: string; age: number; ethnicity: string;
  image_url: string; gender: string; art_style: string;
};

const TABS = ["All", "Realistic", "Anime", "Women", "Men", "Trans", "Non-binary"] as const;
type Tab = typeof TABS[number];

function GalleryPage() {
  const [tab, setTab] = useState<Tab>("All");

  const { data, isLoading } = useQuery({
    queryKey: ["gallery"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, age, ethnicity, image_url, gender, art_style")
        .is("created_by", null)
        .order("sort_order");
      if (error) throw error;
      return data as C[];
    },
  });

  const items = (data ?? []).filter((c) => {
    if (tab === "All") return true;
    if (tab === "Realistic") return c.art_style !== "anime";
    if (tab === "Anime") return c.art_style === "anime";
    if (tab === "Women") return c.gender === "female" || c.gender === "trans-female";
    if (tab === "Men") return c.gender === "male" || c.gender === "trans-male";
    if (tab === "Trans") return c.gender === "trans-female" || c.gender === "trans-male";
    if (tab === "Non-binary") return c.gender === "non-binary";
    return true;
  });

  return (
    <div className="min-h-screen pb-20">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6">
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold tracking-tight md:text-2xl">HumanCrush.com</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" className="rounded-full text-sm"><Link to="/browse">Browse</Link></Button>
          <Button asChild className="rounded-full bg-grad-primary text-primary-foreground">
            <Link to="/create"><Sparkles className="mr-1.5 h-4 w-4" /> Create AI</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto max-w-7xl px-4 md:px-6">
        <h1 className="font-display text-3xl font-semibold md:text-5xl">
          The <span className="bg-grad-primary bg-clip-text text-transparent">gallery</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
          Every face on HumanCrush. Tap to meet them — or{" "}
          <Link to="/create" className="text-primary underline">create your own</Link>.
        </p>

        <div className="-mx-2 mt-5 flex gap-2 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition ${
                tab === t
                  ? "border-primary/60 bg-grad-primary text-primary-foreground shadow-glow"
                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-6 max-w-7xl px-4 md:px-6">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((c) => (
              <Link
                key={c.id}
                to="/companion/$id"
                params={{ id: c.id }}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-card shadow-md transition hover:shadow-glow"
              >
                <img
                  src={companionImage(c.image_url)}
                  alt={c.name}
                  loading="lazy"
                  className="aspect-[3/4] w-full object-cover transition group-hover:scale-105"
                />
                {c.art_style === "anime" && (
                  <span className="absolute left-2 top-2 rounded-full bg-fuchsia-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Anime
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
                  <p className="font-display text-sm font-semibold text-white">{c.name}, {c.age}</p>
                  <p className="text-[10px] uppercase tracking-wide text-white/70">{c.ethnicity}</p>
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-grad-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    <MessageCircle className="h-3 w-3" /> Chat
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
