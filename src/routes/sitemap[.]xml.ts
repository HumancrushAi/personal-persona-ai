import { createFileRoute } from "@tanstack/react-router";

// /sitemap.xml, generated on each request so a companion added in the admin
// panel is listed without a deploy. Only public pages: chat, credits, the admin
// and every signed-in page stay out (robots.txt disallows them too).
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { SITE_URL, absolute } = await import("@/lib/seo");
        const { loadPublicCompanions } = await import("@/lib/seo.functions");
        const { LEGAL_DOCS } = await import("@/lib/legal-docs");
        const { companionImage } = await import("@/lib/companion-images");

        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const today = new Date().toISOString().slice(0, 10);
        const url = (path: string, priority: string, freq: string, image?: { loc: string; title: string }) =>
          `  <url><loc>${esc(SITE_URL + path)}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority>${
            image ? `<image:image><image:loc>${esc(image.loc)}</image:loc><image:title>${esc(image.title)}</image:title></image:image>` : ""
          }</url>`;

        const companions = await loadPublicCompanions().catch(() => []);
        const urls = [
          url("/", "1.0", "daily"),
          url("/models", "0.9", "daily"),
          url("/browse", "0.7", "daily"),
          url("/cams", "0.7", "daily"),
          url("/faq", "0.6", "monthly"),
          url("/create", "0.6", "monthly"),
          url("/credits", "0.5", "monthly"),
          url("/legal", "0.3", "yearly"),
          ...LEGAL_DOCS.map((d) => url(`/legal/${d.slug}`, "0.3", "yearly")),
          ...companions.map((c) => {
            const img = companionImage(c.image_url);
            return url(
              `/models/${c.slug}`,
              "0.8",
              "weekly",
              img ? { loc: absolute(img), title: `${c.name}, ${c.age} — ${c.ethnicity}` } : undefined,
            );
          }),
        ];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join("\n")}
</urlset>
`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
