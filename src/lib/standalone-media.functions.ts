import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ensureBalance } from "./credit-wallet";
import { deductCredits } from "./credit-wallet";
import { startImageJob, startVideoJob } from "./media.functions";
import { screenUserMessage, BLOCKED_CONTENT } from "./safety";

const input = z.object({
  companionId: z.string().uuid(), prompt: z.string().min(3).max(500),
  // Standalone creator supports multi-scene clips up to 30 seconds. Chat keeps
  // its existing 12-second contract and is not changed by this endpoint.
  kind: z.enum(["image", "video"]), seconds: z.number().int().min(3).max(10).optional(), adult: z.boolean().default(false),
  width: z.number().int().min(512).max(1536).default(768),
  height: z.number().int().min(512).max(1536).default(1024),
});

// Social mode is intentionally wardrobe-safe. Keep the user's pose and scene
// direction, but remove words that make the shared prompt builder switch into
// its explicit anatomy path. The 18+ toggle is the only path that may retain
// those instructions.
const SOCIAL_EXPLICIT_TERMS = /\b(?:nude|nudes|naked|nakie|nekkid|unclothed|undress\w*|strip\w*|topless|bottomless|bare|exposed|full\s*frontal|birthday\s*suit|in\s+the\s+buff|tits?|titties|boobs?|boobies|breasts?|nipples?|areolas?|cleavage|rack|knockers|melons|jugs|pussy|vagina|vulva|clit\w*|labia|cunt|snatch|coochie|slit|genital\w*|crotch|dick|cock|penis|balls|testicles?|ass|asshole|butt|booty|butthole|anus|fuck\w*|sex|penetrat\w*|insert\w*|masturbat\w*|finger\w*|lick\w*|suck\w*|blow\s*job|oral|anal|creampie|cum\w*|orgasm\w*|squirt\w*|spread\w*|open\s+legs?|legs?\s+(?:open|apart|up))\b/gi;

function socialRenderPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(SOCIAL_EXPLICIT_TERMS, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  return `${cleaned || "A natural, confident portrait"}. Wide-legged seated pose if requested, wearing an opaque one-piece swimsuit or opaque bra and panties, fully clothed with no transparent fabric.`;
}

export const unlockCreatorModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ companionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const unlocks = context.supabase as any;
    const { data: existing } = await unlocks.from("creator_model_unlocks").select("companion_id").eq("user_id", context.userId).eq("companion_id", data.companionId).maybeSingle();
    if (existing || admin) return { unlocked: true, cost: 0 };
    const { data: first } = await context.supabase.from("companions").select("id").order("sort_order").limit(1).maybeSingle();
    if (first?.id === data.companionId) return { unlocked: true, cost: 0 };
    const balance = await ensureBalance(context.supabase, context.userId, 50);
    const after = await deductCredits(context.supabase, context.userId, 50, "creator_model_unlock", balance.free, balance.paid);
    const { error } = await unlocks.from("creator_model_unlocks").insert({ user_id: context.userId, companion_id: data.companionId });
    if (error) throw new Error("Could not unlock this model");
    return { unlocked: true, cost: 50, balance: after };
  });

export const standaloneGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    const screen = screenUserMessage(data.prompt);
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);
    const renderPrompt = data.adult ? data.prompt : socialRenderPrompt(data.prompt);
    const { data: c, error } = await context.supabase.from("companions")
      .select("id,name,age,ethnicity,gender,short_bio,image_url,base_personality")
      .eq("id", data.companionId).single();
    if (error || !c) throw new Error("Model not found");
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (data.adult && !admin) {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("age_confirmed,subscription_tier,subscription_status")
        .eq("id", context.userId)
        .maybeSingle();
      if (!profile?.age_confirmed) throw new Error("AGE_CONFIRMATION_REQUIRED");
      if (profile.subscription_status !== "active" || !["sub-creator", "sub-creator-annual"].includes(profile.subscription_tier ?? "")) {
        throw new Error("CREATOR_SUBSCRIPTION_REQUIRED");
      }
    }
    if (!admin) {
      const { data: first } = await context.supabase.from("companions").select("id").order("sort_order").limit(1).maybeSingle();
      const { data: unlocked } = await (context.supabase as any).from("creator_model_unlocks").select("companion_id").eq("user_id", context.userId).eq("companion_id", c.id).maybeSingle();
      if (first?.id !== c.id && !unlocked) throw new Error("Unlock this model for 50 credits before generating.");
    }
    const cost = admin ? 0 : data.kind === "video" ? Math.max(10, (data.seconds ?? 5) * 3) : 8;
    const balance = await ensureBalance(context.supabase, context.userId, cost);
    const after = await deductCredits(context.supabase, context.userId, cost, `creator_${data.kind}`, balance.free, balance.paid);
    const adminClient = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { data: p, error: personalityError } = await adminClient.from("user_personalities").insert({ user_id: context.userId, companion_id: c.id, nickname: c.name, style_backstory: c.base_personality }).select("id").single();
    if (personalityError || !p) throw new Error("Could not prepare the model identity");
    const { data: conv, error: conversationError } = await adminClient.from("conversations").insert({ user_id: context.userId, personality_id: p.id, title: "Creator render" }).select("id").single();
    if (conversationError || !conv) throw new Error("Could not prepare the creator workspace");
    try {
      const jobId = data.kind === "image"
        ? await startImageJob(context.supabase, context.userId, conv.id, c, renderPrompt, c.base_personality, after, null, [], { socialSafe: !data.adult })
        : await startVideoJob(context.supabase, context.userId, conv.id, c, renderPrompt, after, data.seconds ?? 5, null, [], { socialSafe: !data.adult });
      return { jobId, cost, status: "pending" as const };
    } catch (e) {
      throw e;
    }
  });
