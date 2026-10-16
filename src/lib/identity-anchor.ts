type SupabaseQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: unknown; error?: unknown }>;
      };
    };
  };
};

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Resolve the same portrait displayed by the outer chat from the canonical
 * companion row. Callers may hold an old companion object after an admin or a
 * user replaces a custom model's portrait, so generation must not trust that
 * snapshot as its identity source.
 *
 * The authenticated Supabase client applies the conversation RLS policy. If a
 * transient read fails, retaining the already-authorized caller value keeps
 * the existing generation path available without ever selecting a different
 * image.
 */
export async function conversationIdentityAnchor(
  supabase: SupabaseQuery,
  conversationId: string,
  fallback?: string | null,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("user_personalities(companions(image_url))")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) return fallback?.trim() || null;

    const row = data as any;
    const personality = first(row?.user_personalities);
    const companion = first((personality as any)?.companions);
    const canonical = (companion as any)?.image_url;
    return typeof canonical === "string" && canonical.trim()
      ? canonical.trim()
      : fallback?.trim() || null;
  } catch {
    return fallback?.trim() || null;
  }
}
