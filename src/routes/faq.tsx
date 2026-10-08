import { createFileRoute, Link } from "@tanstack/react-router";
import { FAQS } from "@/components/FAQSection";
import { useState } from "react";
import { ChevronDown, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupportContact } from "@/components/SupportContact";
import { jsonLd, pageMeta } from "@/lib/seo";

// Server-rendered: this page is static text, and with ssr: false Google saw
// only the site chrome. The FAQPage data is what answer engines quote.
export const Route = createFileRoute("/faq")({
  head: () => ({
    ...pageMeta({
      title: "FAQ — HumanCrush.com",
      description:
        "Answers about HumanCrush.com — pricing, credits, subscriptions, custom AI companions, privacy, and more.",
      path: "/faq",
    }),
    scripts: [
      jsonLd({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }),
    ],
  }),
  component: FAQPage,
});

function FAQPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="mx-auto max-w-3xl px-4 pt-8 md:pt-14">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back home
        </Link>

        <div className="mt-6 text-center">
          <h1 className="font-display text-4xl font-semibold md:text-6xl">
            Frequently asked questions
          </h1>
          <p className="mt-4 text-muted-foreground md:text-lg">
            Everything you need to know about HumanCrush.com.
          </p>
        </div>

        <div className="mt-10 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition hover:bg-white/[0.03] md:px-6"
                  aria-expanded={isOpen}
                >
                  <span className="font-medium md:text-lg">{item.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-primary transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`grid overflow-hidden px-5 transition-all duration-300 md:px-6 ${
                    isOpen ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="min-h-0">
                    <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12">
          <SupportContact card />
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-gradient-to-br from-primary/15 to-transparent p-8 text-center">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">
            Ready to meet your crush?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">
            25 free messages. No credit card.
          </p>
          <Button asChild size="lg" className="mt-5">
            <Link to="/auth">Start free →</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
