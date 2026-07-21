import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { viewerCount } from "@/lib/reels";
import { companionImage } from "@/lib/companion-images";
import { Button } from "@/components/ui/button";
import { Heart, Circle, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/cams/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Live Cams — HumanCrush.com" },
      {
        name: "description",
        content: "Watch your favorite AI companions live. Tip, chat, go private.",
      },
    ],
  }),
  component: CamsPage,
});

function CamsPage() {
  const { data: models } = useQuery({
    queryKey: ["cams-models"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, age, ethnicity, image_url, gender")
        .is("created_by", null)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Home
          </Link>
        </Button>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold">HumanCrush.com</span>
        </Link>
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/browse">Browse</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="flex items-center gap-2">
          <Circle className="h-3 w-3 fill-red-500 text-red-500" />
          <h1 className="font-display text-4xl font-semibold md:text-5xl">Live now</h1>
        </div>
        <p className="mt-2 text-muted-foreground">
          Tap anyone to watch them live — send a tip or go private.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {models?.map((c) => (
            <Link
              key={c.id}
              to="/cams/$id"
              params={{ id: c.id }}
              className="group relative aspect-[3/4] overflow-hidden rounded-3xl border border-white/10 bg-card shadow-md transition hover:shadow-glow"
            >
              <img
                src={companionImage(c.image_url)}
                alt={c.name}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
              />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">
                  <Circle className="h-1.5 w-1.5 fill-red-500 text-red-500" /> LIVE
                </span>
                <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] backdrop-blur">
                  👁 {viewerCount(c.id)}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                <div className="font-display text-lg font-semibold text-white">
                  {c.name}, {c.age}
                </div>
                <div className="text-[11px] uppercase tracking-wide text-white/70">
                  {c.ethnicity}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
