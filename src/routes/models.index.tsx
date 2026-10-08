import { createFileRoute, Link } from "@tanstack/react-router";
import { getPublicCompanions } from "@/lib/seo.functions";
import { companionImage } from "@/lib/companion-images";
import { SITE_NAME, SITE_URL, absolute, companionKind, jsonLd, pageMeta, type PublicCompanion } from "@/lib/seo";

// The model directory. Server-rendered (no ssr: false) so search engines and AI
// answer engines get every companion as a real, linked page.
export const Route = createFileRoute("/models/")({
  loader: () => getPublicCompanions(),
  head: ({ loaderData }) => {
    const list = loaderData ?? [];
    const base = pageMeta({
      title: `AI Girlfriends & AI Boyfriends — Meet All ${list.length || ""} Companions | ${SITE_NAME}`,
      description: `Browse every ${SITE_NAME} AI companion: realistic and anime AI girlfriends and boyfriends of every age and background, each with her own personality, photos, voice notes and live video. 25 free messages.`,
      path: "/models",
    });
    return {
      ...base,
      scripts: [
        jsonLd({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "AI companions on HumanCrush",
          url: `${SITE_URL}/models`,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: list.length,
            itemListElement: list.map((c, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${SITE_URL}/models/${c.slug}`,
              name: `${c.name}, ${c.age}`,
            })),
          },
        }),
      ],
    };
  },
  component: ModelsPage,
});

function ModelsPage() {
  const list = Route.useLoaderData() ?? [];
  const women = list.filter((c) => c.gender === "female" || c.gender === "trans-female");
  const men = list.filter((c) => c.gender === "male" || c.gender === "trans-male");
  const others = list.filter((c) => !women.includes(c) && !men.includes(c));

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 md:px-6 md:pt-12">
      <h1 className="font-display text-3xl font-bold text-white md:text-5xl">
        AI girlfriends &amp; AI boyfriends
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70 md:text-base">
        Every companion on {SITE_NAME} is a fictional, AI-generated character with her own look,
        personality and voice. Chat with her, ask for selfies and voice notes, and watch her live.
        Your first 25 messages are free — no card needed.
      </p>

      <Section title="AI girlfriends" items={women} />
      <Section title="AI boyfriends" items={men} />
      {others.length > 0 && <Section title="Non-binary AI companions" items={others} />}
    </main>
  );
}

function Section({ title, items }: { title: string; items: PublicCompanion[] }) {
  if (!items?.length) return null;
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-white md:text-2xl">{title}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((c) => (
          <li key={c.id}>
            <Link
              to="/models/$slug"
              params={{ slug: c.slug }}
              className="group block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-pink-500/50"
            >
              <img
                src={companionImage(c.image_url) || absolute("/hero-banner.png")}
                alt={`${c.name}, ${c.age}-year-old ${c.ethnicity} ${companionKind(c)}`}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
              />
              <div className="p-3">
                <p className="font-semibold text-white">
                  {c.name}, {c.age}
                </p>
                <p className="text-xs uppercase tracking-wider text-pink-300/80">{c.ethnicity}</p>
                <p className="mt-1 line-clamp-2 text-xs text-white/60">{c.short_bio}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
