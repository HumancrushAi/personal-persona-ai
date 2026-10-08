// Public companion data for the server-rendered /models pages, the sitemap and
// llms.txt. System companions only (created_by null) and active ones only:
// a companion a user made for themselves is never published.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { slugify, type PublicCompanion } from "./seo";

async function loadPublicCompanions(): Promise<PublicCompanion[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("companions")
    .select("id, name, age, ethnicity, gender, art_style, short_bio, base_personality, image_url, status")
    .is("created_by", null)
    .order("sort_order");
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((c: any) => (c.status ?? "active") === "active");
  // Name-based slugs (/models/aria). A name shared by two companions gets an
  // id suffix so neither URL is ambiguous.
  const count = new Map<string, number>();
  for (const c of rows) count.set(slugify(c.name), (count.get(slugify(c.name)) ?? 0) + 1);
  return rows.map((c: any) => {
    const base = slugify(c.name) || c.id.slice(0, 8);
    return {
      id: c.id,
      slug: (count.get(base) ?? 0) > 1 ? `${base}-${c.id.slice(0, 6)}` : base,
      name: c.name,
      age: c.age,
      ethnicity: c.ethnicity ?? "",
      gender: c.gender ?? "female",
      art_style: c.art_style ?? "realistic",
      short_bio: c.short_bio ?? "",
      base_personality: c.base_personality ?? "",
      image_url: c.image_url ?? "",
    };
  });
}

export { loadPublicCompanions };

export const getPublicCompanions = createServerFn({ method: "GET" }).handler(async () =>
  loadPublicCompanions(),
);

export const getCompanionBySlug = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const all = await loadPublicCompanions();
    const c = all.find((x) => x.slug === data.slug.toLowerCase()) ?? null;
    // A few others to link to: internal links are how Google finds the rest.
    const related = c
      ? all.filter((x) => x.id !== c.id && x.gender === c.gender).slice(0, 6)
      : all.slice(0, 6);
    return { companion: c, related };
  });
