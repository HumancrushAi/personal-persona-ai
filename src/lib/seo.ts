// Shared SEO helpers: the canonical origin, model slugs and structured data.
//
// Most of the app renders client-side only (ssr: false), so Google saw a header,
// a footer and a <title> on every page. The pages built on these helpers —
// /models, /models/$slug, /faq — render on the server so there is real, linked,
// structured content to index.

export const SITE_URL = "https://www.humancrush.com";
export const SITE_NAME = "HumanCrush";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/hero-banner.png`;

export const absolute = (path: string) =>
  /^https?:/i.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

/** "Esmé" -> "esme", "Chloé" -> "chloe". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type PublicCompanion = {
  id: string;
  slug: string;
  name: string;
  age: number;
  ethnicity: string;
  gender: string;
  art_style: string;
  short_bio: string;
  base_personality: string;
  image_url: string;
};

/** "AI girlfriend" / "AI boyfriend" — the phrase people actually search for. */
export function companionKind(c: Pick<PublicCompanion, "gender">): string {
  if (c.gender === "male") return "AI boyfriend";
  if (c.gender === "trans-female") return "trans AI girlfriend";
  if (c.gender === "trans-male") return "trans AI boyfriend";
  if (c.gender === "non-binary") return "AI companion";
  return "AI girlfriend";
}

/** A <script type="application/ld+json"> entry for TanStack head().scripts. */
export const jsonLd = (data: unknown) => ({
  type: "application/ld+json",
  children: JSON.stringify(data),
});

/** Canonical + Open Graph + Twitter tags for one page. */
export function pageMeta(opts: {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: string;
}) {
  const url = absolute(opts.path);
  const image = opts.image ? absolute(opts.image) : DEFAULT_OG_IMAGE;
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:type", content: opts.type ?? "website" },
      { property: "og:image", content: image },
      { name: "twitter:title", content: opts.title },
      { name: "twitter:description", content: opts.description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
