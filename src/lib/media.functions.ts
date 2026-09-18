// Chat media (photos, videos, voice notes).
//
// Photos and videos both run on RunPod, and only on RunPod — there is no
// Replicate fallback in this file any more. A misconfigured or unreachable
// endpoint fails the job and refunds rather than quietly rendering somewhere
// else, because a silent fallback is what previously hid a broken image path.
//
// Rows still marked provider="replicate" are pre-switch jobs that can never
// finish now the provider is gone; checkMediaJob fails and refunds them rather
// than leaving the user on a spinner forever.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { applyDeduction, hasEnough } from "./credits";
import { textToSpeech, chatComplete } from "./ai";
import { screenUserMessage, BLOCKED_CONTENT } from "./safety";
import {
  kontextSelfiePrompt,
  videoStillPrompt,
  videoActionPrompt,
  stillImagePrompt,
  requestIsNude,
  checkCrossGenderRequest,
  finishMediaPrompt,
} from "./selfie";

// Negative prompt for the RunPod WAN endpoint, in two halves.
//
// QUALITY_NEGATIVE is what a generated picture looks like when it goes wrong,
// and it applies to a photo and a clip alike: plastic/waxy/airbrushed skin, CGI
// and doll-like faces, the oversaturated over-sharpened HDR look, and mangled
// hands and genitals.
//
// What is NOT in here any more: "cropped head, headless, head out of frame,
// face cut off, close-up, extreme close-up, torso only, tight crop, zoomed in".
// Those were added to stop the head being cut off and they never worked —
// start-frame.server.ts records the same attempt failing. Worse than useless,
// in fact: a negative prompt pushes on the TOKENS it contains, not on the
// sentence they were written into, so a list containing `head`, `face` and
// `torso` pushes her head and face out of the picture. That is the headless
// torso a user was actually sent. Framing is now stated positively in the
// prompt (see framingFor in selfie.ts) and negated nowhere.
// NO BODY PART THAT SHOULD BE IN THE PICTURE IS NAMED HERE. This list used to
// end "deformed penis, mutated penis, fused penis, inverted genitalia, deformed
// pussy, distorted crotch, featureless crotch, plastic genitalia" plus six
// entries naming breasts — so every render was sent `penis` × 3, `breasts` × 6,
// `crotch` × 2, `genitalia` × 2 and `pussy` × 1 in its NEGATIVE conditioning.
//
// A negative prompt pushes on the tokens it contains, not on the adjective they
// were written next to; this is the same fact the positive half of the prompt
// was rebuilt around two commits ago. A male nude therefore named `penis` once
// in the prompt and three times in the negative, and lost 3:1 on the one token
// that mattered. It is exactly why the reported failure was asymmetric: the
// women improved when the positive prompt was fixed, because suppressing
// `penis` is CORRECT for them, while the men got quietly worse. "Men's penis
// still looks funny" is this line.
//
// The distinction that decides what may stay: a negative prompt cannot remove a
// part the body must have, but it can absolutely leave an OPTIONAL one smooth
// and unrendered. Hands, fingers, eyes and faces are always present, so
// "extra fingers, fused fingers, distorted hands" are safe and are kept — that
// is standard practice and it demonstrably helps. Genitals and breasts are the
// parts a model will happily just not draw, so they are never named here.
// Anything cross-sex that must be suppressed is named in crossSexNegative,
// which knows whose body it is.
//
// "asymmetric" is gone too. The positive prompt asks for "natural asymmetry" in
// the same breath — a real face and a real body are not symmetrical, and this
// was quietly fighting the one term that most makes a render read as a photo.
//
// What is also NOT in here any more: "cropped head, headless, head out of
// frame, face cut off, close-up, extreme close-up, torso only, tight crop,
// zoomed in". Those were added to stop the head being cut off and they never
// worked — start-frame.server.ts records the same attempt failing. Worse than
// useless, in fact: a list containing `head`, `face` and `torso` pushes her
// head and face out of the picture. That is the headless torso a user was
// actually sent. Framing is stated positively now (framingFor in selfie.ts).
const QUALITY_NEGATIVE =
  "blurry, low quality, deformed, mutated, malformed, fused, warped anatomy, bad anatomy, extra limbs, extra arms, floating limbs, watermark, text, watermark text overlay, inconsistent characters, cartoon, anime, illustration, painting, drawing, 3d render, cgi, video game, plastic skin, waxy skin, oily skin, greasy skin, shiny skin, silicone skin, airbrushed, oversmoothed, poreless, poreless skin, featureless, smooth blank skin where detail belongs, doll face, mannequin, uncanny valley, lifeless eyes, oversaturated, overexposed, oversharpened, hdr, heavy makeup, instagram filter, beauty filter, beauty lighting, ring light, even lighting, flat lighting, CGI lighting, studio lighting, distorted hands, extra fingers, fused fingers, mutated hands, melting object, deformed object, object merging into hand, morphing, flickering";

// Motion terms. These stop the endpoint returning a near-still clip, and they
// belong ONLY on a video.
//
// A chat photo is one frame cut out of a clip on this same endpoint, and it was
// being sent this list too — so every photo was rendered from a clip that had
// been explicitly forbidden to hold still, and then a frame was taken out of the
// motion. That is a picture of a woman mid-movement: smeared hands, a prop
// halfway between two positions, a body still morphing out of the start frame.
// pickSharpest in media-finalize.server.ts was added to fish for the least
// smeared frame, which is treating the symptom of this line.
const MOTION_NEGATIVE =
  "slow, slow motion, static, still, frozen, stuck, no movement, jittery motion, rubbery movement, unnatural motion";

// Shape words only, for a companion who has breasts, clothed or not. They used
// to sit in QUALITY_NEGATIVE and go out on every render — a man's included,
// where "droopy" pushes against the scrotum his own anatomy clause says hangs
// below his penis. Adjectives and never the noun, for the reason set out above:
// a negative that names the part flattens it.
const SAG_NEGATIVE =
  "saggy, sagging, droopy, drooping, pendulous, deflated, elongated, stretch marks, flattened, splayed, spread flat, sliding sideways, hanging to the sides";

// The one failure the closed-cleft clause in anatomy.ts cannot suppress on its
// own: a render that pulls something OUT of it. That is the "weird thing
// sticking out" a user sent back — a tongue of tissue extruded from the cleft.
// Things and adjectives only, never the part, for the reason set out above.
// "inner labia" and "labia minora" ARE named here, and that is the one
// deliberate exception to the rule above: they are the sub-part the render
// keeps extruding, the positive clause no longer contains the word "labia" at
// all, and pushing the inner structure away is exactly what a closed mound
// needs. The bare part — pussy, vulva — is still never here.
const VULVA_NEGATIVE =
  "protruding, dangling, hanging flap, flaps, extra folds, elongated, stretched, gaping, tentacle, growth, appendage, inner labia, labia minora, spread open, pulled apart, splayed open, exposed pink interior, meat curtains, fingers spreading";

// Applied only when the request implies nudity. Without it nothing pushes back
// on the clothes already in the start frame, so explicit acts were performed
// fully dressed.
const CLOTHING_NEGATIVE =
  "clothed, wearing clothes, dressed, trousers, pants, jeans, shorts, skirt, leggings, underwear, panties, bra, lingerie, shirt, top, dress, swimsuit, fabric covering body, partially undressed";

// `moving` says whether the output is a clip (true) or one still frame cut out
// of one (false). It is not a detail: see MOTION_NEGATIVE above.
//
// Exported for the test. This is the half of the prompt nobody looks at, and it
// is where two of the reported failures were actually coming from, so it gets
// the same regression cover as the positive half.
export function negativeFor(
  userReq: string | undefined,
  gender?: string | null,
  opts: { moving?: boolean } = {},
): string {
  const req = userReq ?? "";
  const isNude = requestIsNude(req);
  const quality = opts.moving ? `${QUALITY_NEGATIVE}, ${MOTION_NEGATIVE}` : QUALITY_NEGATIVE;
  let base = isNude ? `${CLOTHING_NEGATIVE}, ${quality}` : quality;

  // The two hand-rolled lists that used to live here — one for women, one for
  // men — had no branch for a trans man at all, and the trans-female branch
  // suppressed nothing, so a trans woman's render had nothing pushing a vulva
  // out of her groin. crossSexNegative covers all five kinds off the same table
  // the positive anatomy clause is built from, so the two halves cannot
  // disagree about which body this is.
  const a = anatomyOf(gender);
  if (isNude) {
    const cross = crossSexNegative(gender);
    if (cross) base = `${base}, ${cross}`;
    if (a.hasVulva) base = `${base}, ${VULVA_NEGATIVE}`;
  }
  if (a.hasBreasts) base = `${base}, ${SAG_NEGATIVE}`;

  const props = propNegative(req);
  return props ? `${base}, ${props}` : base;
}
import { propClause, propNegative } from "./props";
import { anatomyOf, crossSexNegative } from "./anatomy";
import { VIDEO_LORA_STRENGTHS, runpodEndpoint, runpodRun } from "./runpod";
import { assertNotSuspended, assertRateLimit } from "./account.server";

const SELFIE_COST = 8;
const VOICE_COST = 3;
const VIDEO_COST = 15;

// How long a job may sit unfinished before it is written off and refunded.
// A 10s clip plus queue time runs past four minutes, so this has to be well
// clear of a slow-but-healthy job while still not leaving a hung one open.
const STALE_JOB_MS = 15 * 60_000;

// Warmer, more natural voices first (alloy is the flattest, so it's last).
const VOICES = ["shimmer", "coral", "sage", "nova", "verse", "alloy"];

// Check the user can afford it BEFORE generating (so we don't call the AI for
// someone who's broke). Returns the current balance to deduct from later.
async function ensureBalance(supabase: any, userId: string, cost: number) {
  // Testers are refilled first — see tester-accounts.server.ts.
  const { topUpTester } = await import("./tester-accounts.server");
  const { data: authUser } = await supabase.auth.getUser();
  await topUpTester(userId, authUser?.user?.email);

  const { data: bal } = await supabase
    .from("credit_balances")
    .select("free_messages_remaining, paid_credits")
    .eq("user_id", userId)
    .maybeSingle();
  if (!bal) throw new Error("No balance");
  const free = bal.free_messages_remaining ?? 0;
  const paid = bal.paid_credits ?? 0;
  if (!hasEnough(free, paid, cost)) throw new Error("OUT_OF_CREDITS");
  return { free, paid };
}

// Deduct only AFTER a successful generation, so a refused/failed request
// (e.g. OpenAI rejecting explicit content) never costs the user credits.
async function deductCredits(
  supabase: any,
  userId: string,
  cost: number,
  reason: string,
  free: number,
  paid: number,
) {
  const { free: newFree, paid: newPaid } = applyDeduction(free, paid, cost);
  await supabase
    .from("credit_balances")
    .update({ free_messages_remaining: newFree, paid_credits: newPaid })
    .eq("user_id", userId);
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: -cost,
    reason,
    balance_after: newFree + newPaid,
  });
  return { free: newFree, paid: newPaid };
}

// Undo an upfront media charge when the job never launched. `balance` must be
// the POST-deduction balance returned by deductCredits — refunding from the
// pre-deduction snapshot would over-credit the user.
export async function refundCredits(
  supabase: any,
  userId: string,
  cost: number,
  refundKey: string,
  balance: { free: number; paid: number },
) {
  const newPaid = balance.paid + cost;
  await supabase.from("credit_balances").update({ paid_credits: newPaid }).eq("user_id", userId);
  await supabase.from("credit_ledger").insert({
    user_id: userId,
    delta: cost,
    reason: "refund_credit",
    balance_after: balance.free + newPaid,
    idempotency_key: refundKey,
  });
}

export const generateSelfie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    await assertRateLimit(supabase, "media_jobs", userId, 300, 10);

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "scenario, user_personalities(nickname, identity, style_backstory, companions(name, ethnicity, age, gender, base_personality, short_bio, image_url))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    if (await mediaJobInFlight(supabase, data.conversationId, "image")) {
      throw new Error("She's already taking one for you — hold on 📸");
    }

    const userPrompt = data.prompt?.trim();
    // Safety gate on the image request (blocks minors / illegal even for photos).
    const screen = screenUserMessage(userPrompt ?? "");
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;

    // Cross-gender body part request check
    const crossGenderWarning = checkCrossGenderRequest(c.gender, userPrompt ?? "");
    if (crossGenderWarning) throw new Error(crossGenderWarning);

    const { free, paid } = await ensureBalance(supabase, userId, SELFIE_COST);
    const balance = await deductCredits(supabase, userId, SELFIE_COST, "image_debit", free, paid);

    const jobId = await startImageJob(
      supabase,
      userId,
      data.conversationId,
      {
        name: c.name,
        age: c.age,
        ethnicity: c.ethnicity,
        gender: c.gender,
        short_bio: c.short_bio,
        imageUrl: c.image_url,
      },
      userPrompt,
      p.style_backstory,
      balance,
    );

    return { jobId, status: "pending", balance };
  });

// One job of a kind per conversation at a time.
//
// Generation runs for minutes with no way to tell from the outside that it is
// working, so people ask again — and the second ask was charged and rendered as
// a duplicate of the same picture. The typed path, the 📷 button and the 🎬
// button all reach this before spending anything, so a retry from any of them
// lands on the job already running instead of starting a new one.
export async function mediaJobInFlight(
  supabase: any,
  conversationId: string,
  kind: "image" | "video",
): Promise<boolean> {
  const { data } = await supabase
    .from("media_jobs")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("kind", kind)
    .in("status", ["pending", "processing"])
    .limit(1);
  return Boolean(data?.length);
}

// Create a media_jobs row and fire the async selfie generation. The caller must
// have ALREADY charged SELFIE_COST; on any launch failure this marks the job
// failed, refunds, and rethrows. Shared by the 📷 button (generateSelfie) and
// the in-chat auto-selfie (sendChatMessage).
//
// Chat photos run on RunPod only. FLUX.1 Kontext edits her actual photo, so
// identity carries over natively and there's no face-swap pass to chain.
//
// It is image-TO-image, so it needs a hosted photo to edit: a companion with no
// fetchable image_url fails here and refunds rather than silently falling back.
// There is no Replicate path any more — see the header comment on this file.
export async function startImageJob(
  supabase: any,
  userId: string,
  conversationId: string,
  companion: {
    name: string;
    age: number;
    ethnicity: string;
    gender?: string | null;
    short_bio?: string | null;
    imageUrl?: string | null;
  },
  userRequest: string | undefined,
  styleBackstory: string | null | undefined,
  balance: { free: number; paid: number },
): Promise<string> {
  // Which of the three renderers this photo goes to, decided once and then
  // threaded through the prompt, the start frame and the job body — see
  // imageProvider.
  const provider = imageProvider();
  const runpodImage = runpodEndpoint(provider === "wan" ? "video" : "image");
  if (!runpodImage) {
    await refundCredits(
      supabase,
      userId,
      SELFIE_COST,
      `refund-nocfg-${userId}-${Date.now()}`,
      balance,
    );
    throw new Error("Photo generation is not configured (RUNPOD_API_KEY missing).");
  }

  // A RunPod worker fetches the source frame over the network, so only a real
  // http(s) URL works — an inline data: photo can't be reached from outside.
  //
  // The ComfyUI path is the exception: nothing is handed to a worker to fetch,
  // because the reference portrait travels inside the job as base64, and a
  // workflow that carries her likeness some other way (a LoRA of her, say)
  // needs no portrait at all. So a missing photo only fails the paths that
  // literally cannot run without one.
  const sourceImage = resolveHostedImage(companion.imageUrl);
  const needsHostedPhoto = provider !== "comfy";
  if (needsHostedPhoto && (!sourceImage || !/^https?:/i.test(sourceImage))) {
    await refundCredits(
      supabase,
      userId,
      SELFIE_COST,
      `refund-nosrc-${userId}-${Date.now()}`,
      balance,
    );
    throw new Error(
      "This companion has no hosted photo to edit — regenerate her image in the admin panel first.",
    );
  }

  const imagePrompt = await photoPrompt(companion, userRequest, styleBackstory, provider);

  // The WAN endpoint centre-crops to a square, which decapitated the result.
  // Square it ourselves, keeping the whole figure, before handing it over. An
  // image model renders its own frame and needs none of this.
  let startFrame = sourceImage ?? "";
  if (provider === "wan") {
    try {
      const { squareStartFrame } = await import("./start-frame.server");
      startFrame = await squareStartFrame(startFrame, `img-${userId}-${Date.now()}`);
    } catch {
      /* fall back to the raw portrait rather than failing the whole request */
    }
  }

  // media_jobs is only writable by the service role (users can just read
  // their own rows), so job bookkeeping goes through the admin client.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("media_jobs")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      kind: "image",
      status: "pending",
      prompt: imagePrompt,
      provider: "runpod",
      cost: SELFIE_COST,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    await refundCredits(
      supabase,
      userId,
      SELFIE_COST,
      `refund-nojob-${userId}-${Date.now()}`,
      balance,
    );
    throw new Error("Failed to create image generation job");
  }

  try {
    // Each endpoint takes a completely different input, so the body is built
    // per provider rather than shared. `moving: false` on the negative — this
    // job is a photo. The motion negatives that force a video to keep moving
    // are left off: they were making every chat photo a picture of someone
    // mid-movement. And the companion's own gender is passed, without which
    // negativeFor defaulted to female and a male companion's nude photo was
    // rendered with "penis, cock, male genitalia" in its negative prompt.
    const negative = negativeFor(userRequest, companion.gender, { moving: false });
    const input =
      provider === "comfy"
        ? await comfyJobInput(imagePrompt, negative, sourceImage)
        : provider === "kontext"
          ? {
              prompt: imagePrompt,
              negative_prompt: [
                "different person, different face, changed identity, deformed, extra limbs, bad anatomy, blurry, cartoon, anime, watermark, text",
                propNegative(userRequest ?? ""),
              ]
                .filter(Boolean)
                .join(", "),
              // Was -1, which tells the endpoint to pick its own random seed —
              // the same per-job lottery comfySettings had. Derived from the
              // prompt so the same request reproduces; see seedFor.
              seed: (await import("./comfy")).seedFor(imagePrompt),
              num_inference_steps: Number(process.env.RUNPOD_IMAGE_STEPS || "28"),
              guidance: Number(process.env.RUNPOD_IMAGE_GUIDANCE || "2.5"),
              image: sourceImage,
              size: process.env.RUNPOD_IMAGE_SIZE || "1024*1024",
              output_format: "png",
              // This app's whole purpose is explicit; the safety checker would blank
              // the output. screenUserMessage already blocked the illegal requests.
              enable_safety_checker: false,
            }
          : stillJobInput(startFrame, imagePrompt, negative);

    const result = await runpodRun(runpodImage, input, webhookFor("runpod"));
    await supabaseAdmin
      .from("media_jobs")
      .update({ replicate_id: result.id, status: "processing" })
      .eq("id", job.id);
  } catch (err: any) {
    await supabaseAdmin
      .from("media_jobs")
      .update({
        status: "failed",
        error: err.message || "Failed to trigger image generation",
      })
      .eq("id", job.id);

    await refundCredits(supabase, userId, SELFIE_COST, `refund-${job.id}`, balance);
    throw err;
  }

  return job.id;
}

/**
 * Which renderer a chat photo goes to.
 *
 *   comfy    a ComfyUI endpoint running an uncensored checkpoint. A still,
 *            rendered as a still, at the size and step count the checkpoint
 *            was tuned for. The only one of the three that is actually an
 *            image model on uncensored weights.
 *   kontext  a Kontext-shaped image endpoint that EDITS her portrait. Carries
 *            her face natively; refuses nudity on the public FLUX weights, so
 *            this is only ever right for a privately hosted uncensored one.
 *   wan      the video endpoint, with one frame cut out of the clip. The
 *            fallback, and the one everything was rendered on until now.
 *
 * Resolved from the env in one place because four separate things branch on
 * it — the prompt, whether the portrait is squared, the job body, and which
 * endpoint the job is polled against.
 */
export type ImageProvider = "comfy" | "kontext" | "wan";

export function imageProvider(): ImageProvider {
  if (process.env.RUNPOD_COMFY_ENDPOINT) return "comfy";
  if (process.env.RUNPOD_IMAGE_ENDPOINT) return "kontext";
  return "wan";
}

/**
 * The ComfyUI job body: the graph with this request substituted into it, plus
 * her portrait as base64 when the graph asks for a reference.
 *
 * The portrait is fetched HERE rather than handed over as a URL, because the
 * worker's contract takes image bytes, not links.
 */
export async function comfyJobInput(
  prompt: string,
  negative: string,
  portraitUrl: string | null,
): Promise<Record<string, unknown>> {
  const { comfyInput, comfySettings, comfyTemplate, wantsReference } = await import("./comfy");
  const template = comfyTemplate();

  let referenceBase64: string | undefined;
  if (wantsReference(template)) {
    if (!portraitUrl) {
      throw new Error(
        "This workflow needs her portrait and this companion has none — upload one in the admin panel.",
      );
    }
    const res = await fetch(portraitUrl);
    if (!res.ok) throw new Error(`Could not read her portrait (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // RunPod caps a queued job's payload, and base64 is a third larger than the
    // bytes. A portrait is a few hundred KB; anything near the cap is a sign
    // something else is being passed and is worth failing loudly for.
    if (bytes.byteLength > 6_000_000) {
      throw new Error("Her portrait is too large to send with the job (over 6MB).");
    }
    referenceBase64 = bytes.toString("base64");
  }

  return comfyInput({ ...comfySettings(prompt), prompt, negative }, { template, referenceBase64 });
}

/**
 * The prompt a chat photo is rendered from.
 *
 * Its own function so scripts/test-still.ts renders from exactly what a user's
 * request would, rather than a copy that drifts.
 */
export async function photoPrompt(
  companion: {
    name: string;
    age: number;
    ethnicity: string;
    gender?: string | null;
    short_bio?: string | null;
  },
  userRequest: string | undefined,
  styleBackstory: string | null | undefined,
  provider: ImageProvider,
): Promise<string> {
  // Grok rewrites the user's line into a full prompt in the house style; the
  // keyword builder is the fallback when no key is set or the call fails.
  const { refineMediaPrompt } = await import("./prompt-refiner.server");
  const refined = await refineMediaPrompt("photo", userRequest ?? "", companion);

  // The prop specification is appended to whatever prompt we end up with, and
  // that includes the refined one — see finishMediaPrompt.
  //
  // The close-up patching that used to sit here is gone. It tried to repair a
  // refined prompt by find-and-replacing the literal string "full body visible,
  // head to feet in frame" — text the refiner only produced when the old rules
  // told it to, and which it no longer writes at all — and then prepended a
  // second framing sentence when the first was not found, so a close-up request
  // could end up carrying two contradictory cameras. The refiner is now told
  // which framing to write (refineMediaPrompt reads CLOSE_UP_RE itself), so
  // there is one camera in the prompt and nothing to patch afterwards.
  // The fallback builder has to match the renderer. Kontext is told to EDIT the
  // photo it is given; ComfyUI draws the same photograph in one pass, so it gets
  // the same builder without the cue telling a clip to settle; WAN gets the cue.
  const builder =
    provider === "kontext"
      ? kontextSelfiePrompt(companion, userRequest, styleBackstory)
      : provider === "comfy"
        ? stillImagePrompt(companion, userRequest)
        : videoStillPrompt(companion, userRequest);

  return finishMediaPrompt(refined?.[0] ?? builder, userRequest ?? "", {
    anatomy: anatomyOf(companion.gender),
    appendProps: Boolean(refined?.[0]),
    // Same condition as appendProps and for the same reason: the builders write
    // their own anatomy clause, the refined prompt no longer does.
    appendAnatomy: Boolean(refined?.[0]),
    // Only when the photo is being cut out of a clip. A real image endpoint
    // renders a still by definition and does not need telling.
    still: provider === "wan",
  });
}

// An env knob that can also be switched off entirely, so the worker falls back
// to its own tuned value. "off" is how scripts/test-still.ts renders the same
// request with and without a setting, to see which one actually looks better.
function stillKnob(name: string, fallback: string): string | null {
  const v = (process.env[name] ?? fallback).trim();
  return v && v.toLowerCase() !== "off" ? v : null;
}

/**
 * The WAN job body for a chat photo, which is one frame cut out of a clip.
 * Shared with scripts/test-still.ts for the same reason as photoPrompt.
 */
export function stillJobInput(startFrame: string, prompt: string, negative: string) {
  // Off unless set. A 480*832 size, guidance_scale 4.0 and 30 steps went out
  // as defaults without a single render to check them against, and photos were
  // reported as weird and unrealistic straight after. The worker's own tuned
  // values are the known quantity, so they are the default again; set e.g.
  // RUNPOD_STILL_SIZE="480*832" and RUNPOD_STILL_GUIDANCE="4.0" to opt back in
  // once scripts/test-still.ts shows they look better.
  const size = stillKnob("RUNPOD_STILL_SIZE", "off");
  const guidance = stillKnob("RUNPOD_STILL_GUIDANCE", "off");
  return {
    // The frame count is NOT a cost dial, which is what it was being treated
    // as. WAN i2v paces an action across a fixed arc — the video path in this
    // same file uses 82 frames and calls it the endpoint's tuned default. Run
    // the same model for 49 frames and it does not perform the action faster;
    // it performs 60% of it and stops. Then extractLastFrame takes a frame from
    // the last 1.2 seconds of that, so the photo the user paid for was, by
    // construction, the subject partway through morphing out of her clothed
    // portrait: half-resolved limbs, a prop between two positions, a body still
    // forming. That is most of what "the nudes look bad" was describing.
    //
    // 81 frames lets the pose actually arrive. Steps come back down to 26 to pay
    // for it — a completed pose at 26 steps beats an unfinished one at 32.
    // Both stay env-overridable.
    image_url: startFrame,
    fps: 16,
    frames_per_scene: Number(process.env.RUNPOD_STILL_FRAMES || "81"),
    num_scenes: 1,
    sampling_steps: Number(process.env.RUNPOD_STILL_STEPS || "26"),
    prompts: [prompt],
    negative_prompt: negative,
    lora_strengths: VIDEO_LORA_STRENGTHS,
    ...(size ? { size } : {}),
    ...(guidance ? { guidance_scale: Number(guidance) } : {}),
  };
}

export const requestVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(500).optional(),
        // Clip length, chosen in the request dialog. Without this field zod
        // strips it silently and every video comes back at the 82-frame
        // default — which is why picking 8s or 10s changed nothing.
        seconds: z.number().int().min(3).max(12).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);
    await assertRateLimit(supabase, "media_jobs", userId, 300, 10);

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "user_personalities(nickname, style_backstory, companions(name, image_url, sort_order, age, ethnicity, gender, base_personality))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    if (await mediaJobInFlight(supabase, data.conversationId, "video")) {
      throw new Error("She's still filming the last one — give her a sec 🎬");
    }

    const userPrompt = data.prompt?.trim();
    if (userPrompt) {
      const screen = screenUserMessage(userPrompt);
      if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);
    }

    const p: any = (conv as any).user_personalities;
    const c = p.companions;

    // The video path never had this check. The 📷 button and the chat
    // auto-selfie both refused a request for anatomy the companion does not
    // have; the 🎬 button rendered it, which made the gate decorative — ask for
    // it as a video and you got it. Checked before the debit, so a refusal
    // never costs the 15 credits.
    const crossGenderWarning = checkCrossGenderRequest(c.gender, userPrompt ?? "");
    if (crossGenderWarning) throw new Error(crossGenderWarning);

    const { free, paid } = await ensureBalance(supabase, userId, VIDEO_COST);
    const balance = await deductCredits(supabase, userId, VIDEO_COST, "video_debit", free, paid);

    const jobId = await startVideoJob(
      supabase,
      userId,
      data.conversationId,
      {
        name: c.name,
        gender: c.gender,
        imageUrl: c.image_url,
        age: c.age,
        ethnicity: c.ethnicity,
      },
      userPrompt,
      balance,
      data.seconds,
    );

    return { jobId, status: "pending", balance };
  });

// Build the motion prompt for image-to-video. The companion's appearance comes
// from the start-frame image, so the prompt describes MOTION/ACTION, not looks.
// No forced "SFW" — the safety screen (run by the caller) blocks illegal content;
// clamping to SFW is why asking her to do something explicit never matched.
// Turn a companion's stored image into a URL a generation worker can fetch.
// Image-to-image and image-to-video both need a remotely-fetchable source frame:
// http(s) and data: URIs work as-is; a site-relative path is resolved against
// PUBLIC_SITE_URL. A bare bundled filename isn't reachable from outside, so it
// returns null (caller errors + refunds, prompting the admin to upload or
// regenerate a hosted photo).
function resolveHostedImage(imageUrl?: string | null): string | null {
  const u = (imageUrl ?? "").trim();
  if (!u) return null;
  if (/^(https?:|data:)/i.test(u)) return u;
  if (u.startsWith("/")) return `${process.env.PUBLIC_SITE_URL || "https://humancrush.com"}${u}`;
  return null;
}

// Each provider posts completions to its own receiver route.
function webhookFor(provider: "runpod"): string {
  const base = process.env.PUBLIC_SITE_URL || "https://humancrush.com";
  return `${base}/api/public/${provider}-webhook`;
}

// The companion's own sex, which decides whether the prop spec asserts female
// anatomy. Kept next to the negative builder because both are per-request
// plumbing rather than part of any public surface.
function isMaleCompanion(gender: string | null | undefined): boolean {
  const g = (gender ?? "female").toLowerCase();
  return g === "male" || g === "trans-male";
}

// Create a media_jobs row and fire the async image-to-video job, using the
// companion's photo as the start frame so the clip looks like HER. Prefers the
// RunPod WAN endpoint (runs the weights on RunPod, nothing screened upstream)
// and falls back to Replicate when RUNPOD_VIDEO_ENDPOINT isn't configured.
// Caller must have ALREADY charged VIDEO_COST; on any launch failure this marks
// the job failed, refunds, and rethrows. Shared by the 🎬 button (requestVideo)
// and the in-chat auto-video (sendChatMessage).
export async function startVideoJob(
  supabase: any,
  userId: string,
  conversationId: string,
  companion: {
    name: string;
    gender?: string | null;
    imageUrl?: string | null;
    age?: number;
    ethnicity?: string;
  },
  userReq: string | undefined,
  balance: { free: number; paid: number },
  seconds?: number,
): Promise<string> {
  const startImage = resolveHostedImage(companion.imageUrl);

  // The endpoint renders one scene per prompt and joins them, so a clip is cut
  // into ~5s scenes and Grok writes the action as a progression across them.
  // One prompt stretched over the whole clip is what made a video read as a
  // single held pose.
  const totalSeconds = seconds ?? 5;
  const sceneCount = Math.max(1, Math.min(4, Math.round(totalSeconds / 5)));

  const cost = VIDEO_COST;

  const runpodVideo = runpodEndpoint("video");
  if (!runpodVideo) {
    await refundCredits(supabase, userId, cost, `refund-nocfg-${userId}-${Date.now()}`, balance);
    throw new Error(
      "Video generation is not configured (RUNPOD_API_KEY / RUNPOD_VIDEO_ENDPOINT missing).",
    );
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // The job row is written FIRST, before any slow work.
  //
  // Credits are debited by the caller before this function runs, and the
  // refiner below can take a minute — Grok is allowed 60s and the OpenRouter
  // fallback another 20. Refining first meant the user was charged and then sat
  // through a minute of silence with no row anywhere; a phone that dropped the
  // request in that window cancelled the function, so no job existed, no refund
  // path had been reached, and the credits were simply gone. Measured on a real
  // request: debit at 12:37:41, job row at 12:38:44, sixty-three seconds apart.
  //
  // With the row written up front, an interrupted request leaves a pending job
  // that checkMediaJob's stale sweep can fail and refund, and the prompt is
  // filled in below once it exists.
  const { data: job, error: jobErr } = await supabaseAdmin
    .from("media_jobs")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      kind: "video",
      status: "pending",
      prompt: "",
      provider: "runpod",
      cost,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    await refundCredits(supabase, userId, cost, `refund-nojob-${userId}-${Date.now()}`, balance);
    throw new Error("Failed to create video generation job");
  }

  const fail = async (message: string) => {
    await supabaseAdmin
      .from("media_jobs")
      .update({ status: "failed", error: message })
      .eq("id", job.id);
    await refundCredits(supabase, userId, cost, `refund-${job.id}`, balance);
  };

  if (!startImage) {
    await fail(
      "Video needs a hosted companion photo — upload or regenerate this companion's image in the admin panel.",
    );
    throw new Error("No fetchable companion image for video generation");
  }

  // Now the slow part, with a job row already standing behind it.
  const { refineMediaPrompt } = await import("./prompt-refiner.server");
  const refinedVideo = await refineMediaPrompt("video", userReq ?? "", companion, sceneCount);
  // Same reason as the photo path: a successful refine replaces the builder, so
  // the prop spec is re-appended to every scene rather than lost.
  const rawReq = userReq ?? "";
  const anatomy = anatomyOf(companion.gender);
  const refinedScenes = refinedVideo?.length ? refinedVideo : null;
  const scenePrompts = (refinedScenes ?? [videoActionPrompt(companion, userReq)]).map((p) =>
    finishMediaPrompt(p, rawReq, { anatomy, appendProps: Boolean(refinedScenes) }),
  );
  const videoPrompt = scenePrompts.join("\n\n");
  await supabaseAdmin.from("media_jobs").update({ prompt: videoPrompt }).eq("id", job.id);

  // Same centre-crop problem as photos: hand the endpoint a square that keeps
  // her whole body rather than letting it slice the frame down to a torso.
  let startFrame = startImage;
  try {
    const { squareStartFrame } = await import("./start-frame.server");
    startFrame = await squareStartFrame(startImage, `vid-${userId}-${Date.now()}`);
  } catch {
    /* fall back to the raw portrait rather than failing the whole request */
  }

  // fps * frames is the clip length: 82 frames @ 16fps ≈ 5s, the endpoint's
  // tuned default. num_scenes stays 1 — one prompt, one continuous shot.
  const fps = Number(process.env.RUNPOD_VIDEO_FPS || "16");
  try {
    const result = await runpodRun(
      runpodVideo,
      {
        image_url: startFrame,
        fps,
        // Length is frames / fps on this endpoint, so the requested duration is
        // converted here rather than sent as seconds.
        // Total length is frames_per_scene * num_scenes, so the per-scene frame
        // count is the requested duration divided across the scenes.
        frames_per_scene: Math.round((totalSeconds * fps) / scenePrompts.length),
        num_scenes: scenePrompts.length,
        sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "25"),
        prompts: scenePrompts,
        negative_prompt: negativeFor(userReq, companion.gender, { moving: true }),
        lora_strengths: VIDEO_LORA_STRENGTHS,
      },
      webhookFor("runpod"),
    );
    await supabaseAdmin
      .from("media_jobs")
      .update({ replicate_id: result.id, status: "processing" })
      .eq("id", job.id);
  } catch (err: any) {
    await fail(err.message || "Failed to trigger video model");
    throw err;
  }

  return job.id;
}

// Reconcile a media job against its provider directly, so completion does NOT
// depend on the webhook callback landing (serverless webhooks are unreliable).
// The client's status poll calls this; it checks the job, chains the face
// swap when one is needed, stores the result, and finalizes the job.
export const checkMediaJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job } = await supabase
      .from("media_jobs")
      .select(
        "id, user_id, conversation_id, kind, cost, status, provider, replicate_id, media_url, created_at",
      )
      .eq("id", data.jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");

    if (job.status === "completed")
      return { status: "completed", mediaUrl: (job as any).media_url };
    if (job.status === "failed") return { status: "failed" };
    const { completeMediaJob: complete, failMediaJob: fail } =
      await import("./media-finalize.server");

    // A worker can hang: one video job sat IN_PROGRESS on RunPod overnight, so
    // the row stayed "processing" forever, nothing was ever posted to the chat,
    // and the credits were never returned. Nothing else would ever have closed
    // it out — the webhook only fires on a terminal state, which never came.
    //
    // This check now runs BEFORE the replicate_id one below. A job that was
    // written but never reached the provider — the request was cancelled while
    // the prompt was still being refined, say — has no provider id at all, so
    // returning early on that skipped the sweep entirely and stranded the row in
    // "pending" for good, with the credits still spent. Age is what decides
    // whether a job is dead, and that is true whether or not it was ever
    // launched.
    const ageMs = Date.now() - new Date((job as any).created_at).getTime();
    if (ageMs > STALE_JOB_MS) {
      await fail(job as any, "Generation timed out — the provider never finished this job.");
      return { status: "failed" };
    }

    // Written but not yet launched, and not old enough to give up on. The
    // caller keeps polling.
    if (!(job as any).replicate_id) return { status: job.status };

    // RunPod jobs need no face-swap chaining: the image path edits her real
    // photo and the video path animates it, so identity is already hers.
    if ((job as any).provider === "runpod") {
      const endpoint = runpodEndpoint(job.kind);
      if (!endpoint) return { status: job.status };

      const { runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } =
        await import("./runpod");
      let res: { status: string; output?: any; error?: any };
      try {
        res = await runpodGet(endpoint, (job as any).replicate_id);
      } catch {
        return { status: job.status }; // transient — keep polling
      }

      const state = runpodStatusOf(res.status);
      if (state === "failed") {
        await fail(job as any, runpodOutputError(res.output, res.error) || `Job ${res.status}`);
        return { status: "failed" };
      }
      if (state === "processing") return { status: "processing" };

      const err = runpodOutputError(res.output, res.error);
      if (err) {
        await fail(job as any, err);
        return { status: "failed" };
      }
      const url = runpodOutputUrl(res.output);
      if (!url) {
        // A ComfyUI worker that rendered nothing usually says why in `errors`
        // — a missing checkpoint, a node that is not installed. That belongs in
        // the job row rather than a flat "no output", because it is the
        // difference between a bad request and a misconfigured endpoint.
        const { comfyError } = await import("./comfy");
        await fail(job as any, comfyError(res.output) || "No output from generation model");
        return { status: "failed" };
      }
      try {
        const mediaUrl = await complete(job as any, url);
        return { status: "completed", mediaUrl };
      } catch (e: any) {
        await fail(job as any, `Storage failed: ${e.message}`);
        return { status: "failed" };
      }
    }

    // Anything still marked provider="replicate" is a job from before the switch.
    // Replicate is gone (its credentials have been removed), so those can never
    // finish — fail them and give the credits back rather than leaving the user
    // staring at a spinner forever.
    await fail(job as any, "Generation provider was retired before this job finished.");
    return { status: "failed" };
    return { status: "processing" };
  });

export const generateVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().min(1).max(800),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSuspended(supabase, userId);

    const { data: conv } = await supabase
      .from("conversations")
      .select("user_personalities(companions(sort_order, voice_id))")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const { free, paid } = await ensureBalance(supabase, userId, VOICE_COST);

    const comp = (conv as any).user_personalities?.companions;
    const sort: number = comp?.sort_order ?? 0;
    // Admin-assigned voice wins; otherwise rotate through the roster.
    const voice = comp?.voice_id || VOICES[sort % VOICES.length];

    // Generate first; only charge if it actually succeeds.
    const buf = await textToSpeech(data.text, voice);
    const dataUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;
    const balance = await deductCredits(supabase, userId, VOICE_COST, "voice_note", free, paid);

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: data.text,
      kind: "voice",
      media_url: dataUrl,
    });

    return { balance, mediaUrl: dataUrl };
  });

// Step 1 of a video request: pick a short spoken line (in-character, flirty) and
// render her voice for it. The clip itself is assembled in the browser (canvas +
// this audio) — no charge here; the user is only charged when the finished video
// is saved (saveVideoNote), so a failed render never costs credits.
export const videoScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        prompt: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select(
        "user_personalities(nickname, style_backstory, companions(name, image_url, sort_order, age, ethnicity, gender, base_personality, voice_id))",
      )
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    // Must be able to afford the video before we spend on TTS.
    await ensureBalance(supabase, userId, VIDEO_COST);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;
    if (data.prompt) {
      const screen = screenUserMessage(data.prompt);
      if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);
    }

    const g = (c.gender ?? "").toLowerCase();
    const noun =
      g === "male" || g === "trans-male"
        ? "man"
        : g === "non-binary"
          ? "androgynous person"
          : "woman";

    const line = (
      await chatComplete(
        [
          {
            role: "system",
            content:
              `You are ${p.nickname}, a ${c.age}-year-old ${c.ethnicity} ${noun} recording a short, flirty, intimate video message for the person you're talking to. ` +
              `Base personality: ${c.base_personality}. ${p.style_backstory ? `Vibe: ${p.style_backstory}. ` : ""}` +
              `Write ONE or TWO short sentences she says out loud to the camera — playful, seductive, personal, spoken aloud (no stage directions, no asterisks, no quotes). Max 160 characters.`,
          },
          {
            role: "user",
            content: data.prompt
              ? `Make the video about: ${data.prompt}`
              : "Make a teasing hello video for me.",
          },
        ],
        { maxTokens: 90 },
      )
    )
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .slice(0, 200);

    const sort: number = c.sort_order ?? 0;
    const voice = c.voice_id || VOICES[sort % VOICES.length];
    const buf = await textToSpeech(line || `Hey you… I made this just for you.`, voice);
    const audioUrl = `data:audio/mpeg;base64,${buf.toString("base64")}`;

    return { line, audioUrl, imageUrl: c.image_url as string, name: c.name as string };
  });

// Step 2 of a video request: persist the finished clip (rendered in the browser)
// and charge for it. Only now does the user pay — after a real video exists.
export const saveVideoNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        dataUrl: z.string().startsWith("data:video/").max(20_000_000),
        caption: z.string().max(400).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const { free, paid } = await ensureBalance(supabase, userId, VIDEO_COST);
    const balance = await deductCredits(supabase, userId, VIDEO_COST, "video_note", free, paid);

    await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      content: data.caption || "*sends you a video* 🎬",
      kind: "video",
      media_url: data.dataUrl,
    });

    return { balance };
  });
