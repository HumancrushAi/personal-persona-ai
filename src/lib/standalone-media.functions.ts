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
  kind: z.enum(["image", "video"]), seconds: z.number().int().min(3).max(30).optional(),
  width: z.number().int().min(512).max(1536).default(768),
  height: z.number().int().min(512).max(1536).default(1024),
});

export const standaloneGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    const screen = screenUserMessage(data.prompt);
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);
    const { data: c, error } = await context.supabase.from("companions")
      .select("id,name,age,ethnicity,gender,short_bio,image_url,base_personality")
      .eq("id", data.companionId).single();
    if (error || !c) throw new Error("Model not found");
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const cost = admin ? 0 : data.kind === "video" ? Math.max(10, (data.seconds ?? 5) * 3) : 8;
    const balance = await ensureBalance(context.supabase, context.userId, cost);
    const after = await deductCredits(context.supabase, context.userId, cost, `creator_${data.kind}`, balance.free, balance.paid);
    const admin = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { data: p } = await admin.from("user_personalities").insert({ user_id: context.userId, companion_id: c.id, nickname: c.name, style_backstory: c.base_personality }).select("id").single();
    const { data: conv } = await admin.from("conversations").insert({ user_id: context.userId, personality_id: p.id, title: "Creator render" }).select("id").single();
    try {
      const jobId = data.kind === "image"
        ? await startImageJob(context.supabase, context.userId, conv.id, c, data.prompt, c.base_personality, after)
        : await startVideoJob(context.supabase, context.userId, conv.id, c, data.prompt, after, data.seconds ?? 5);
      return { jobId, cost, status: "pending" as const };
    } catch (e) {
      throw e;
    }
  });
