import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}

/** The link in the verification email. No session needed: the token is the proof. */
export const confirmEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ u: z.string().uuid(), t: z.string().min(16).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { confirmVerificationToken } = await import("./verify-email.server");
    return { ok: await confirmVerificationToken(await admin(), data.u, data.t) };
  });

/** "Resend email" on the banner. */
export const resendVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if ((context as any).claims?.is_anonymous === true) return { ok: false as const };
    const email = typeof context.claims?.email === "string" ? context.claims.email : null;
    if (!email) return { ok: false as const };
    const { sendVerificationLink } = await import("./verify-email.server");
    await sendVerificationLink(context.userId, email);
    return { ok: true as const };
  });
