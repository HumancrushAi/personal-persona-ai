import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { LEGAL_DOCS } from "@/lib/legal-docs";
import { ScrollText } from "lucide-react";

export const Route = createFileRoute("/legal/")({
  head: () => ({ meta: [{ title: "Policies — HumanCrush.com" }] }),
  component: LegalIndex,
});

function LegalIndex() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-8 md:px-6">
        <h1 className="flex items-center gap-2 font-display text-3xl font-semibold md:text-4xl">
          <ScrollText className="h-7 w-7 text-primary" /> Policies
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything the service promises, and everything it refuses to do.
        </p>
        <ul className="mt-8 space-y-3">
          {LEGAL_DOCS.map((d) => (
            <li key={d.slug}>
              <Link
                to="/legal/$slug"
                params={{ slug: d.slug }}
                className="glass block rounded-2xl p-4 transition hover:shadow-glow"
              >
                <p className="font-display text-lg font-semibold">{d.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{d.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
