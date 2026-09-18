import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { LEGAL_DOCS, legalDoc } from "@/lib/legal-docs";
import { SupportContact } from "@/components/SupportContact";

// One published policy, with the others down the side.
//
// Rendered from src/lib/legal-docs.ts, which is also what the underwriting
// response reproduces — so this page IS the copy the bank was sent.
export const Route = createFileRoute("/legal/$slug")({
  loader: ({ params }) => {
    const doc = legalDoc(params.slug);
    if (!doc) throw notFound();
    return doc;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Legal"} — HumanCrush.com` },
      { name: "description", content: loaderData?.summary ?? "" },
    ],
  }),
  component: LegalPage,
});

function LegalPage() {
  const doc = Route.useLoaderData();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto grid max-w-5xl gap-8 px-5 pb-24 pt-8 md:grid-cols-[220px_1fr] md:px-6">
        <nav className="md:sticky md:top-20 md:self-start">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            Policies
          </p>
          <ul className="space-y-1">
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug}>
                <Link
                  to="/legal/$slug"
                  params={{ slug: d.slug }}
                  className={`block rounded-lg px-2.5 py-1.5 text-sm transition ${
                    d.slug === doc.slug
                      ? "bg-primary/15 text-primary"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0">
          <h1 className="font-display text-3xl font-semibold md:text-4xl">{doc.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{doc.summary}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Last updated {doc.updated}
          </p>

          <div className="mt-8 space-y-6">
            {doc.blocks.map((b, i) => (
              <section key={i}>
                {b.h && <h2 className="mb-2 font-display text-xl font-semibold">{b.h}</h2>}
                {b.p?.map((p, j) => (
                  <p key={j} className="mb-3 text-sm leading-relaxed text-white/85 md:text-base">
                    {p}
                  </p>
                ))}
                {b.ul && (
                  <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/85 md:text-base">
                    {b.ul.map((li, j) => (
                      <li key={j}>{li}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <div className="mt-12">
            <SupportContact card />
          </div>
        </article>
      </div>
    </div>
  );
}
