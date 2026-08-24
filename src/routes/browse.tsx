import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/browse")({
  ssr: false,
  head: () => ({ meta: [{ title: "Browse companions — HumanCrush.com" }] }),
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
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-8 pb-20">
        <h1 className="font-display text-4xl font-semibold md:text-6xl">Pick your crush.</h1>
        {/* Counted from the roster rather than hardcoded — the copy claimed 36
            companions (and trans/non-binary ones, which don't exist) long after
            the real number drifted. */}
        <p className="mt-2 text-muted-foreground">
          {data?.length ?? ""} hand-crafted companions. Customize anyone you tap.
        </p>

        {isLoading && <div className="mt-10 text-muted-foreground">Loading…</div>}

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data?.map((c) => (
            <Link
              key={c.id}
              to="/companion/$id"
              params={{ id: c.id }}
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-card shadow-md transition hover:shadow-glow"
            >
              <img
                src={companionImage(c.image_url)}
                alt={`Portrait of ${c.name}`}
                width={1024}
                height={1024}
                loading="lazy"
                className="aspect-[3/4.2] w-full object-cover object-top transition group-hover:scale-[1.04]"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-lg font-semibold text-white">
                    {c.name}, {c.age}
                  </h3>
                </div>
                <p className="text-[11px] uppercase tracking-wide text-white/70">{c.ethnicity}</p>
                <p className="mt-1 line-clamp-2 text-xs text-white/85">{c.short_bio}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
