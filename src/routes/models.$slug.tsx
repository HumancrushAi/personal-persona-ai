import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getCompanionBySlug } from "@/lib/seo.functions";
import { companionImage } from "@/lib/companion-images";
import { SITE_NAME, SITE_URL, absolute, companionKind, jsonLd, pageMeta, type PublicCompanion } from "@/lib/seo";

// One public profile per companion, server-rendered. Before these existed the
// only page for a companion was /companion/$id — the signed-in "customize" step
// — so not one companion could be found from a search engine.
export const Route = createFileRoute("/models/$slug")({
  loader: async ({ params }) => {
    const res = await getCompanionBySlug({ data: { slug: params.slug } });
    if (!res.companion) throw notFound();
    return res;
  },
  head: ({ loaderData }): Record<string, any> => {
    const c = loaderData?.companion;
    if (!c) return { meta: [{ title: `Companion not found | ${SITE_NAME}` }] };
    const kind = companionKind(c);
    const image = absolute(companionImage(c.image_url) || "/hero-banner.png");
    const base = pageMeta({
      title: `${c.name}, ${c.age} — ${c.ethnicity} ${kind} | ${SITE_NAME}`,
      description: `Meet ${c.name}, a ${c.age}-year-old ${c.ethnicity} ${kind}. ${c.short_bio} Chat, get selfies and voice notes, and watch her live. 25 free messages.`.slice(0, 300),
      path: `/models/${c.slug}`,
      image,
      type: "profile",
    });
    return {
      ...base,
      scripts: [
        jsonLd({
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          url: `${SITE_URL}/models/${c.slug}`,
          mainEntity: {
            "@type": "Person",
            name: c.name,
            description: `${c.short_bio} ${c.name} is a fictional, AI-generated character on ${SITE_NAME}.`,
            image,
          },
        }),
        jsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
            { "@type": "ListItem", position: 2, name: "AI companions", item: `${SITE_URL}/models` },
            { "@type": "ListItem", position: 3, name: c.name, item: `${SITE_URL}/models/${c.slug}` },
          ],
        }),
        jsonLd({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqFor(c).map(([q, a]) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }),
      ],
    };
  },
  component: ModelPage,
});

type C = PublicCompanion;

function faqFor(c: C): [string, string][] {
  const she = c.gender === "male" || c.gender === "trans-male" ? "he" : "she";
  const her = she === "he" ? "his" : "her";
  return [
    [
      `Is ${c.name} a real person?`,
      `No. ${c.name} is a fictional, AI-generated ${companionKind(c)}. ${c.name} does not depict or represent any real person.`,
    ],
    [
      `Can ${c.name} send photos and voice notes?`,
      `Yes. Ask ${c.name} for a selfie or a voice note in chat and ${she} sends one, always with ${her} own face and voice.`,
    ],
    [
      `How much does it cost to chat with ${c.name}?`,
      `Your first 25 messages are free with no credit card. After that you can buy credits or subscribe to a monthly plan.`,
    ],
  ];
}

function ModelPage() {
  const { companion: c, related } = Route.useLoaderData();
  if (!c) return null;
  const kind = companionKind(c);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 md:px-6 md:pt-10">
      <nav aria-label="Breadcrumb" className="text-xs text-white/50">
        <Link to="/" className="hover:text-white">
          {SITE_NAME}
        </Link>{" "}
        /{" "}
        <Link to="/models" className="hover:text-white">
          AI companions
        </Link>{" "}
        / <span className="text-white/80">{c.name}</span>
      </nav>

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <img
          src={companionImage(c.image_url) || "/hero-banner.png"}
          alt={`${c.name}, ${c.age}-year-old ${c.ethnicity} ${kind}`}
          className="aspect-[3/4] w-full rounded-3xl border border-white/10 object-cover object-top"
        />
        <div>
          <h1 className="font-display text-3xl font-bold text-white md:text-5xl">
            {c.name}, {c.age}
          </h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-pink-300">
            {c.ethnicity} {kind}
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/85">{c.short_bio}</p>
          {c.base_personality && c.base_personality !== c.short_bio && (
            <p className="mt-3 text-sm leading-relaxed text-white/65">{c.base_personality}</p>
          )}

          <Link
            to="/companion/$id"
            params={{ id: c.id }}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-grad-primary px-7 py-3 text-sm font-bold text-primary-foreground shadow-glow"
          >
            Chat with {c.name} — 25 free messages
          </Link>

          <h2 className="mt-8 font-display text-xl font-semibold text-white">
            What you can do with {c.name}
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-white/75">
            <li>Chat any time — {c.name} remembers what you talk about.</li>
            <li>Ask for selfies and photos, always with {c.name}&apos;s own face.</li>
            <li>Get voice notes in {c.name}&apos;s own voice.</li>
            <li>Watch {c.name} live and request personal videos.</li>
          </ul>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold text-white">Questions about {c.name}</h2>
        <dl className="mt-4 space-y-4">
          {faqFor(c).map(([q, a]) => (
            <div key={q} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <dt className="font-semibold text-white">{q}</dt>
              <dd className="mt-1 text-sm text-white/70">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-white">You might also like</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {related.map((r: PublicCompanion) => (
              <li key={r.id}>
                <Link
                  to="/models/$slug"
                  params={{ slug: r.slug }}
                  className="block overflow-hidden rounded-2xl border border-white/10 hover:border-pink-500/50"
                >
                  <img
                    src={companionImage(r.image_url) || "/hero-banner.png"}
                    alt={`${r.name}, ${r.age}-year-old ${r.ethnicity} ${companionKind(r)}`}
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover object-top"
                  />
                  <p className="p-2 text-sm font-semibold text-white">
                    {r.name}, {r.age}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12 text-xs text-white/40">
        {c.name} is a fictional, AI-generated character. No companion on {SITE_NAME} is, depicts or
        is based on a real person.
      </p>
    </main>
  );
}
