import { createHash } from "node:crypto";
import { SOCIAL_BLOCK_MESSAGE, SOCIAL_MODERATION_THRESHOLDS } from "./social-safety";

type ProviderVerdict = "allow" | "block" | null;

export type ModerationDecision = {
  allowed: boolean;
  classifier: string;
  score: number | null;
  reason: string;
};

export class SocialModerationBlockedError extends Error {
  readonly decision: ModerationDecision;

  constructor(decision: ModerationDecision) {
    super(SOCIAL_BLOCK_MESSAGE);
    this.name = "SocialModerationBlockedError";
    this.decision = decision;
  }
}

export function isSocialModerationBlockedError(error: unknown): error is SocialModerationBlockedError {
  return error instanceof SocialModerationBlockedError || (error as any)?.name === "SocialModerationBlockedError";
}

export type ModerationResponse = {
  flagged?: boolean;
  categories?: Record<string, boolean>;
  category_scores?: Record<string, number>;
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
};

function firstResult(payload: ModerationResponse | null | undefined) {
  return payload?.results?.[0] ?? payload ?? {};
}

/** Pure interpretation is exported so it can be tested without an API call. */
export function interpretModerationResult(payload: ModerationResponse): ModerationDecision {
  const result = firstResult(payload);
  const scores = result.category_scores ?? {};
  const sexual = Number(scores.sexual ?? 0);
  const sexualMinors = Number(scores["sexual/minors"] ?? scores.sexual_minors ?? 0);
  const flagged = result.flagged === true || result.categories?.sexual === true || result.categories?.["sexual/minors"] === true;
  const score = Math.max(sexual, sexualMinors);
  const blocked = flagged || sexual >= SOCIAL_MODERATION_THRESHOLDS.sexual || sexualMinors >= SOCIAL_MODERATION_THRESHOLDS.sexualMinors;
  return {
    allowed: !blocked,
    classifier: "openai/omni-moderation-latest",
    score,
    reason: blocked ? (sexualMinors >= SOCIAL_MODERATION_THRESHOLDS.sexualMinors ? "sexual-minors" : "sexual") : "clear",
  };
}

/**
 * Providers do not share a safety response shape. Honour an explicit provider
 * verdict when one is present; otherwise the OpenAI moderation fallback below
 * is required. Unknown fields never grant an allow decision.
 */
export function providerSafetyVerdict(payload: unknown): ProviderVerdict {
  if (!payload || typeof payload !== "object") return null;
  const seen = new Set<object>();
  const visit = (value: unknown): ProviderVerdict => {
    if (!value || typeof value !== "object") return null;
    if (seen.has(value as object)) return null;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = visit(item);
        if (result) return result;
      }
      return null;
    }
    for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
      const key = rawKey.toLowerCase().replace(/[-\s]/g, "_");
      if (typeof rawValue === "boolean") {
        if (["nsfw", "is_nsfw", "unsafe", "is_unsafe", "content_policy_violation", "blocked", "nsfw_content_detected"].includes(key)) {
          if (rawValue) return "block";
        }
        if (["safe", "is_safe", "content_policy_passed", "safety_checker_passed", "safety_check_passed"].includes(key)) {
          return rawValue ? "allow" : "block";
        }
        if (["nsfw", "is_nsfw", "unsafe", "is_unsafe", "blocked", "nsfw_content_detected"].includes(key) && !rawValue) return "allow";
      }
      if (typeof rawValue === "string" && ["safety", "content_policy", "moderation"].includes(key)) {
        const v = rawValue.toLowerCase();
        if (/block|unsafe|nsfw|violation|reject/.test(v)) return "block";
        if (/safe|clear|pass|allow/.test(v)) return "allow";
      }
      const nested = visit(rawValue);
      if (nested) return nested;
    }
    return null;
  };
  return visit(payload);
}

export async function moderateBuffers(
  buffers: Buffer[],
  fetcher: typeof fetch = fetch,
): Promise<ModerationDecision> {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      allowed: false,
      classifier: "openai/omni-moderation-latest (unavailable)",
      score: null,
      reason: "classifier-unavailable",
    };
  }
  if (!buffers.length) {
    return { allowed: false, classifier: "openai/omni-moderation-latest", score: null, reason: "no-sampled-output" };
  }
  const input = buffers.slice(0, 6).map((buffer) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` },
  }));
  try {
    const response = await fetcher("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.SOCIAL_MODERATION_MODEL || "omni-moderation-latest", input }),
    });
    if (!response.ok) throw new Error(`moderation request failed (${response.status})`);
    return interpretModerationResult((await response.json()) as ModerationResponse);
  } catch (error) {
    console.error("Social moderation classifier failed closed", error);
    return {
      allowed: false,
      classifier: "openai/omni-moderation-latest (error)",
      score: null,
      reason: "classifier-error",
    };
  }
}

export async function evaluateSocialOutput(args: {
  providerOutput?: unknown;
  samples: Buffer[];
  classify?: (buffers: Buffer[]) => Promise<ModerationDecision>;
}): Promise<ModerationDecision> {
  const providerVerdict = providerSafetyVerdict(args.providerOutput);
  if (providerVerdict === "block") {
    return { allowed: false, classifier: "provider-safety", score: 1, reason: "provider-blocked" };
  }
  if (providerVerdict === "allow") {
    return { allowed: true, classifier: "provider-safety", score: 0, reason: "provider-cleared" };
  }
  return (args.classify ?? ((buffers) => moderateBuffers(buffers)))(args.samples);
}

export function promptHash(prompt: string | null | undefined): string {
  return createHash("sha256").update(prompt ?? "").digest("hex");
}

export function logSocialModerationBlock(args: {
  userId: string;
  prompt: string | null | undefined;
  model: string;
  provider: string;
  decision: ModerationDecision;
}): void {
  console.warn(
    "[social-moderation-block]",
    JSON.stringify({
      user_id: args.userId,
      prompt_hash: promptHash(args.prompt),
      model: args.model,
      provider: args.provider,
      classifier: args.decision.classifier,
      classifier_score: args.decision.score,
      reason: args.decision.reason,
    }),
  );
}

export { SOCIAL_BLOCK_MESSAGE };
