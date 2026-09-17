import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Refill a tester account on demand.
//
// The refill in tester-accounts.server.ts runs before every credit gate, which
// keeps a tester from ever being refused — but a page that only READS the
// balance never hits a gate, so the account page showed 1 credit until the
// tester sent something. The pages that display a balance call this first.
// For everyone else it is a no-op that answers in a few milliseconds.
export const refreshTesterCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { isTesterEmail, topUpTester } = await import("./tester-accounts.server");
    const { data } = await supabase.auth.getUser();
    const email = data?.user?.email ?? null;
    if (!isTesterEmail(email)) return { tester: false };
    await topUpTester(userId, email);
    return { tester: true };
  });
