// Who owns which toy. Server only.
//
// A purchase is a credit_ledger row with reason "toy_purchase:<id>", so the
// ledger IS the inventory: no new table, every purchase visible in the admin
// panel beside the credits it cost, and a unique idempotency key per
// user-and-toy so a double-tap cannot buy one twice. Testers and admins own
// everything — the product is tested on those accounts.

import { CHEST_EXTRAS, TOY_PURCHASE_PREFIX, TOYS, resolveToy, type Toy, type ToyResolution } from "./toys";

export type Owned = Set<string> | "all";

const KNOWN_IDS = new Set([...TOYS.map((t) => t.id), ...CHEST_EXTRAS.map((e) => e.id)]);

/** The toys this user has, read with whichever client the caller has. */
export async function ownedToys(
  client: any,
  userId: string,
  email: string | null | undefined,
): Promise<Owned> {
  const { isTesterEmail, isAdminUser } = await import("./tester-accounts.server");
  if (isTesterEmail(email) || (await isAdminUser(userId))) return "all";
  const { data } = await client
    .from("credit_ledger")
    .select("reason")
    .eq("user_id", userId)
    .like("reason", `${TOY_PURCHASE_PREFIX}%`)
    .limit(200);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = String(row.reason ?? "").slice(TOY_PURCHASE_PREFIX.length);
    if (KNOWN_IDS.has(id)) ids.add(id);
  }
  return ids;
}

export function owns(owned: Owned, id: string): boolean {
  return owned === "all" || owned.has(id);
}

/** Ownership for a server path that has only a user id (a retake, a webhook). */
export async function ownedToysAdmin(userId: string): Promise<Owned> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let email: string | null = null;
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  } catch {
    /* the ledger still decides */
  }
  return ownedToys(supabaseAdmin, userId, email);
}

/** The toy a request renders with, for this user. */
export async function toyForRequest(
  client: any,
  userId: string,
  email: string | null | undefined,
  request: string,
): Promise<ToyResolution> {
  if (!request?.trim()) return { toy: null, needed: null };
  return resolveToy(request, await ownedToys(client, userId, email));
}

export type { Toy };
