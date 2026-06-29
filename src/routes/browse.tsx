import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/browse")({
  ssr: false,
  head: () => ({ meta: [{ title: "Browse companions — Aurelia" }] }),
  component: Browse,
});

function Browse() {
  const { data, isLoading } = useQuery({
    queryKey: ["companions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, ethnicity, age, image_url, short_bio")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-2xl font-semibold">Aurelia</span>
        </Link>
        <div className="flex gap-2">
          <Button asChild variant="ghost" className="rounded-full"><Link to="/me">My chats</Link></Button>
          <Button asChild variant="ghost" className="rounded-full"><Link to="/credits">Credits</Link></Button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h1 className="text-4xl font-semibold md:text-5xl">Meet your match</h1>
        <p className="mt-2 text-muted-foreground">25 hand-crafted companions. Pick one, then make her yours.</p>

        {isLoading && <div className="mt-10 text-muted-foreground">Loading…</div>}

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data?.map(c => (
            <Link
              key={c.id}
              to="/companion/$id"
              params={{ id: c.id }}
              className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:shadow-md"
            >
              <img
                src={companionImage(c.image_url)}
                alt={`Portrait of ${c.name}`}
                width={1024} height={1024} loading="lazy"
                className="aspect-[3/4] w-full object-cover transition group-hover:scale-[1.02]"
              />
              <div className="p-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-lg font-semibold">{c.name}, {c.age}</h3>
                </div>
                <p className="text-xs text-muted-foreground">{c.ethnicity}</p>
                <p className="mt-1.5 line-clamp-2 text-sm">{c.short_bio}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
