import { createFileRoute } from "@tanstack/react-router";

// /llms.txt — the plain-text summary AI answer engines (ChatGPT, Perplexity,
// Claude, Gemini) read to understand a site: what it is, the facts worth
// quoting, and which pages to fetch. Generated per request so the companion
// list is always current.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        const { SITE_URL, SITE_NAME, companionKind } = await import("@/lib/seo");
        const { loadPublicCompanions } = await import("@/lib/seo.functions");
        const { LEGAL_DOCS } = await import("@/lib/legal-docs");
        const { FAQS } = await import("@/components/FAQSection");
        const companions = await loadPublicCompanions().catch(() => []);

        const text = `# ${SITE_NAME}

> ${SITE_NAME} (${SITE_URL}) is an adults-only (18+) AI companion app. Users chat with fictional, AI-generated AI girlfriends and AI boyfriends, ask them for selfies and voice notes, watch them live, and can design their own companion. The first 25 messages are free with no credit card. No companion is, depicts or is based on a real person.

## Key facts
- Free to start: 25 free messages, no credit card.
- Paid: one-time credit packs, or a monthly subscription that renews until cancelled.
- Every companion has her own face, personality and voice; photos and videos keep her face consistent.
- ${companions.length} companions, including realistic and anime styles, women and men${companions.length ? `, ages ${Math.min(...companions.map((c) => c.age))} to ${Math.max(...companions.map((c) => c.age))}` : ""}.
- Users can create a custom companion: gender, art style, appearance, hair, eyes and outfit.

## Pages
- [All AI companions](${SITE_URL}/models): directory of every companion with profiles.
- [FAQ](${SITE_URL}/faq): pricing, credits, subscriptions, privacy.
- [Create a companion](${SITE_URL}/create)
- [Live](${SITE_URL}/cams)
- [Credits and plans](${SITE_URL}/credits)

## Companions
${companions.map((c) => `- [${c.name}, ${c.age}](${SITE_URL}/models/${c.slug}): ${c.ethnicity} ${companionKind(c)}. ${c.short_bio}`).join("\n")}

## FAQ
${FAQS.map((f: { q: string; a: string }) => `### ${f.q}\n${f.a}`).join("\n\n")}

## Policies
${LEGAL_DOCS.map((d) => `- [${d.title}](${SITE_URL}/legal/${d.slug})`).join("\n")}
`;
        return new Response(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
