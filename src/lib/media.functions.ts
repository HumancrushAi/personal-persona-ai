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
import { screenUserMessage, screenAssistantReply, BLOCKED_CONTENT } from "./safety";
import {
  kontextSelfiePrompt,
  videoStillPrompt,
  videoActionPrompt,
  stillImagePrompt,
  requestIsNude,
  requestKeepsGarment,
  requestSetsViewpoint,
  checkCrossGenderRequest,
  finishMediaPrompt,
  isClimaxAct,
  isRubAct,
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
  "blurry, low quality, grain, film grain, digital noise, chromatic noise, compression artifacts, jpeg artifacts, soft focus, motion blur, out of focus, deformed, mutated, malformed, fused, warped anatomy, bad anatomy, extra limbs, extra arms, floating limbs, watermark, text, watermark text overlay, inconsistent characters, cartoon, anime, illustration, painting, drawing, 3d render, cgi, video game, plastic skin, waxy skin, magazine photoshoot, supermodel, oily skin, greasy skin, shiny skin, silicone skin, airbrushed, oversmoothed, doll face, mannequin, uncanny valley, lifeless eyes, oversaturated, overexposed, oversharpened, hdr, heavy makeup, instagram filter, beauty filter, beauty lighting, ring light, even lighting, flat lighting, CGI lighting, studio lighting, distorted hands, extra fingers, fused fingers, mutated hands, third hand, extra hand, disembodied hand, floating hand, three arms, two people, second person, extra person, crowd, group of people, bystander, someone else's hand, someone else's arm, melting object, deformed object, object merging into hand, morphing, flickering";

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
  "static pose, frozen frame, motionless, stuck pose, jitter, rubbery movement, random unrelated movement";

// WAN tends to turn any explicit seated clip into its learned generic breast-
// fondling motion, even when the still begins with the hand correctly placed.
// State one continuous action at both ends of the prompt and give every hand a
// fixed job. Repetition is intentional: later tokens steer later video frames.
export function videoActionLock(req: string | undefined, gender?: string | null, toy: Toy | null = null): string {
  const request = req ?? "";
  const a = anatomyOf(gender);
  if (toy && propIsInserted(request)) {
    const anal = /\b(?:ass|anus|butt|booty|rear|back door)\b/i.test(request) &&
      !/\b(?:pussy|vagina|vulva|cunt|slit)\b/i.test(request);
    const opening = anal ? `${a.poss} anus` : `${a.poss} pussy`;
    const anchor = anal ? `${a.poss} buttocks` : `${a.poss} open thighs`;
    return (
      `Primary continuous penetration action from first frame to last: the rounded narrow tip and the first part ` +
      `of the ${toy.name} are already visibly inside ${opening} in frame one. ${a.poss} right hand grips only the ` +
      `outer handle or wider base and completes repeated straight in-and-out fucking strokes on one fixed axis: ` +
      `pushes most of the insertable length inside, then pulls partway out while the tip always remains inside, ` +
      `then pushes in again. The toy never fully withdraws. Its outer handle or base never enters the body. ` +
      `The opening stays visibly centered and snug around the shaft during every stroke. ${a.poss} left hand stays ` +
      `planted on ${anchor}. The toy never hovers beside the body, slides over the skin, flips direction or points ` +
      `away from the opening. The fixed camera clearly shows the insertion point, gripping hand and repeated stroke.`
    );
  }
  if (!isRubAct(request)) return "";
  if (a.hasVulva) {
    return `Primary continuous action from first frame to last: ${a.poss} right index and middle fingers stay pressed on ${a.poss} own clitoris and complete repeated visible circular rubbing strokes over the same spot; ${a.poss} left palm stays planted on ${a.poss} inner thigh; ${a.poss} torso stays relaxed; the fixed camera keeps ${a.poss} groin and both hands in frame.`;
  }
  if (a.hasPenis) {
    return `Primary continuous action from first frame to last: one hand stays closed around ${a.poss} own penis and completes repeated visible up-and-down stroking cycles; ${a.poss} other palm stays planted on ${a.poss} thigh; ${a.poss} torso stays relaxed; the fixed camera keeps ${a.poss} groin and both hands in frame.`;
  }
  return "";
}

/** Keep an owned chest toy visually stable through every frame of a clip. */
export function videoToyLock(toy: Toy | null): string {
  if (!toy) return "";
  return (
    `Prop continuity lock from first frame to last: exactly one ${toy.name}, ` +
    `${toy.tags}. It remains the same manufactured object with identical color, material, scale, ` +
    `shape and component count throughout the clip; it stays clearly visible and in sharp focus; ` +
    `it never disappears, duplicates, changes design, melts into skin or becomes a different toy.`
  );
}

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

// Age. The most important list in this file.
//
// A tester was sent a render that read as a child. Nothing in this pipeline was
// pushing back on it: grep the render path for child, minor, teen or underage
// before this commit and there is not one term, positive or negative. The only
// age safety in the app is screenUserMessage, which screens what the USER
// types — nothing stood between the checkpoint's own prior and the output.
//
// Two things in the prompt were pushing toward it. "small smooth defined
// areolae" in the anatomy clause, and "slim slender build, narrow waist, flat
// toned stomach" — the build default added to fix a heavy-midsection
// complaint. Both read young to a text encoder.
//
// Applied to EVERY render: every gender, clothed or nude, photo and video, no
// condition and no env switch. Nothing here is a style choice that a caller
// gets to opt out of.
const AGE_NEGATIVE =
  "child, children, kid, kids, toddler, infant, baby, teen, teenager, teenage, adolescent, minor, underage, preteen, pre-teen, pubescent, prepubescent, loli, lolita, shota, young girl, young boy, little girl, little boy, schoolgirl, schoolboy, school uniform, childlike, childish, childish proportions, juvenile, immature body, undeveloped, barely legal, jailbait, petite child, small child, shrunken body, doll-like proportions";

// The part of the above that only applies to a body that has breasts.
//
// The first version of this said "flat chest, flat chested, undeveloped chest,
// no breast development" and that was a bad mistake, for the reason set out at
// the top of this file: a negative pushes on the TOKENS it contains, so naming
// `chest` and `breast` here pushes against the very anatomy her own clause asks
// for. The likeliest result is a render with less breast development, which is
// the opposite of what this list is for — and it is how a man's penis was made
// to look wrong by the same error.
//
// So: maturity stated without naming the part. These push on the proportions of
// a body that has not finished growing, which is what a childlike render
// actually gets wrong, and they say nothing a text encoder can read as "less
// chest". Split from AGE_NEGATIVE because "girlish" is meaningless for a male
// companion and "adolescent frame" is already covered there for everyone.
const AGE_NEGATIVE_BREASTS =
  "prepubescent proportions, adolescent frame, girlish figure, unfinished growth, small immature body";

// Age, from the other side. "youthful face" and "baby face" used to sit in
// AGE_NEGATIVE, and a negative pushes on the tokens it contains: every render
// was being pushed AWAY from a youthful face, and the realism wording asked
// for pores and moles on top — faces came back lined, tired and chapped.
// Those two terms are gone from the list above (the minor terms stay, every
// one), and this pushes the other way. Conditions and adjectives, never a
// part; "old" itself is not here because "24-year-old" is in every prompt.
// The other failure mode, and it showed up the moment the ageing terms went:
// a face rendered as a product shot — glossy, airbrushed, brows like they
// were drawn with a ruler. Finish and rendering words only; "eyebrows" is
// named with its fault attached, never bare, so the brows themselves stay.
const PLASTIC_NEGATIVE =
  "glossy skin, over-rendered, overprocessed, cgi face, 3d render face, uncanny, too perfect, microbladed eyebrows, drawn-on eyebrows, overdrawn eyebrows, razor-sharp eyebrows, stencilled eyebrows, plastic face";

const AGED_NEGATIVE =
  "wrinkles, wrinkled, deep lines, crow's feet, nasolabial folds, sagging skin, leathery skin, weathered skin, haggard, gaunt, elderly, middle-aged, aged face, chapped lips, cracked lips, dry lips, tired eyes, dark circles, eye bags, grey hair, gray hair";

// The same list for a companion of forty or more, who is allowed her lines,
// her folds and her grey: only the neglect stays pushed away.
const AGED_NEGATIVE_OLDER =
  "haggard, gaunt, leathery skin, weathered skin, chapped lips, cracked lips, dry lips, tired eyes, dark circles, eye bags";

// Body mass, suppressed where suppression actually works.
//
// The positive prompt was doing all of this on its own and losing. A stated
// build is one clause competing with a checkpoint's whole idea of a body, and
// LUSTIFY's idea is heavier than this app wants — so renders came back with a
// midsection nobody asked for, on companions whose own portraits are slim.
//
// Adjectives and conditions only, never a part. That is the rule the whole file
// turns on: a negative cannot remove a part the body must have, but it CAN
// leave an optional feature unrendered, and fat is optional in exactly the way
// a breast is not. "belly" alone would push against her abdomen; "belly fat"
// and "belly rolls" push against the fat on it.
//
// `pregnant` and `swollen abdomen` are here because that is the shape that was
// actually reported — "a big belly like she's pregnant" — and the renderer has
// a strong prior for it that nothing else was pushing back on.
//
// Applies to every render, clothed or nude, for every gender: the reported
// failure arrived on a lingerie request, where the anatomy clause is not even
// appended.
// Extremes both ways. Belly fat and a pregnant look were reported once, so
// those stay; "chubby, plus size, thick waist, wide waist, heavyset, love
// handles" are gone - suppressing them on every render slimmed every woman,
// the curvy ones included, into the "very skinny" bodies reported next.
const BUILD_NEGATIVE =
  "overweight, obese, belly fat, belly rolls, bloated, distended stomach, swollen abdomen, pregnant, skinny, underweight, emaciated, bony, visible ribs, jutting hip bones, anorexic, sickly thin";

// Applied only when the request implies nudity. Without it nothing pushes back
// on the clothes already in the start frame, so explicit acts were performed
// fully dressed.
const CLOTHING_NEGATIVE =
  "clothed, wearing clothes, dressed, fully clothed, partially clothed, trousers, pants, jeans, shorts, skirt, leggings, underwear, panties, bra, lingerie, shirt, top, blouse, dress, swimsuit, bikini, fabric covering body, fabric covering chest, fabric covering hips, clothes on, still dressed, remains of clothing";

// `moving` says whether the output is a clip (true) or one still frame cut out
// of one (false). It is not a detail: see MOTION_NEGATIVE above.
//
// Exported for the test. This is the half of the prompt nobody looks at, and it
// is where two of the reported failures were actually coming from, so it gets
// the same regression cover as the positive half.
// A mouth with nothing in it. "licking your tits" came back as her holding a
// toy to her mouth: the request named no object, so no list suppressed one,
// and the checkpoint's own idea of what "licking" means filled the gap.
// Objects and acts only, never the part — she still has a mouth and a tongue.
// The phallic terms are added only for a body that has no penis; a trans
// woman's own cock must not be pushed out of her picture by her licking her
// nipple.
const ORAL_SOLO_RE = /\b(?:lick\w*|suck\w*|tongue|mouth|lips?|kiss\w*|oral|bit(?:e|es|ing))\b/i;
const ORAL_SOLO_NEGATIVE =
  "dildo, sex toy, vibrator, object in mouth, object in hand, holding an object, bottle, lollipop, popsicle, banana, microphone, fellatio, blowjob, oral sex, semen, second person, another person's hand, man's hand";
const ORAL_SOLO_NEGATIVE_NO_PENIS = "phallus, phallic object, cylinder, rod, pole, stick";

export function negativeFor(
  userReq: string | undefined,
  gender?: string | null,
  opts: { moving?: boolean; extra?: string[]; age?: number | null; toy?: Toy | null; tattooed?: boolean } = {},
): string {
  const req = userReq ?? "";
  const isNude = requestIsNude(req);
  const quality = opts.moving ? `${QUALITY_NEGATIVE}, ${MOTION_NEGATIVE}` : QUALITY_NEGATIVE;
  // CLOTHING_NEGATIVE is withheld when the request KEEPS a garment on — "in
  // lingerie with your pussy showing". Naming a part makes requestIsNude true,
  // so that request used to be sent `bra, lingerie, panties` in its negative
  // while the prompt asked for exactly those things. The render split the
  // difference and followed neither half.
  const keepsGarment = requestKeepsGarment(req);
  let base = isNude && !keepsGarment ? `${CLOTHING_NEGATIVE}, ${quality}` : quality;

  // The two hand-rolled lists that used to live here — one for women, one for
  // men — had no branch for a trans man at all, and the trans-female branch
  // suppressed nothing, so a trans woman's render had nothing pushing a vulva
  // out of her groin. crossSexNegative covers all five kinds off the same table
  // the positive anatomy clause is built from, so the two halves cannot
  // disagree about which body this is.
  const a = anatomyOf(gender);
  // The opposite body's parts go into EVERY negative, not only a nude one.
  // A plain "send me a picture" of a trans woman still rendered nude often
  // enough, and with nothing pushing back the checkpoint gave her a vulva as
  // well as her penis. On a clothed render it changes nothing.
  const cross = crossSexNegative(gender);
  if (cross) base = `${base}, ${cross}`;
  if (isNude && a.hasVulva) {
    // The closed-vulva list keeps her closed on every nude render — except
    // the one that asks her to spread it, which it was fighting word for word.
    const spreadPussy =
      /\b(?:spread\w*|open\w*|pull\w*\s+(?:apart|open)|part\w*)\b[^.?!]{0,16}\b(?:pussy|lips|labia|vulva|cunt|slit|herself|yourself)\b/i.test(req) &&
      !/\b(?:legs?|thighs?)\b/i.test(req);
    base = `${base}, ${
      spreadPussy
        ? VULVA_NEGATIVE.replace(/,?\s*(?:spread open|pulled apart|splayed open|exposed pink interior)\b/g, "")
        : VULVA_NEGATIVE
    }`;
  }
  if (a.hasBreasts) {
    // "splayed, spread flat" are breast-shape words, but a negative carries
    // no noun, and on "spread your legs" they pushed against the request.
    const spreadAsked =
      /\b(?:spread\w*|splay\w*|open\w*)\b[^.?!]{0,20}\b(?:legs?|thighs?|pussy|ass|cheeks|wide)\b|\blegs?\s+(?:spread|open|apart)\b/i.test(
        req,
      );
    base = `${base}, ${spreadAsked ? SAG_NEGATIVE.replace(", splayed, spread flat", "") : SAG_NEGATIVE}`;
  }
  // Every render. See BUILD_NEGATIVE: the reported failure came back on a
  // clothed request, so gating this on nudity would miss it.
  base = `${base}, ${BUILD_NEGATIVE}`;
  // Unconditional, and first among equals. See AGE_NEGATIVE.
  base = `${base}, ${AGE_NEGATIVE}`;
  if (a.hasBreasts) base = `${base}, ${AGE_NEGATIVE_BREASTS}`;
  // A companion in her forties or fifties IS middle-aged, and pushing that
  // away made her a stranger to her own portrait. She keeps her age; only
  // the neglect words stay.
  const aged = (opts.age ?? 0) >= 40 ? AGED_NEGATIVE_OLDER : AGED_NEGATIVE;
  base = `${base}, ${aged}, ${PLASTIC_NEGATIVE}`;

  // Her mouth on her own body, with no toy and no penis in the request.
  if (ORAL_SOLO_RE.test(req) && !hasProp(req) && !mentionsPart(req, "penis")) {
    const climax = isClimaxAct(req);
    const oral = ORAL_SOLO_NEGATIVE.split(", ").filter((t) => {
      // His own cum is the act; his own hand is a man's hand.
      if (t === "semen" && climax && a.hasPenis) return false;
      if (t === "man's hand" && !a.hasBreasts) return false;
      // An object the request names is the picture, not a thing to push away.
      if (/^(?:bottle|lollipop|popsicle|banana|microphone)$/.test(t) && new RegExp(`\\b${t}s?\\b`, "i").test(req))
        return false;
      return true;
    });
    base = `${base}, ${oral.join(", ")}`;
    if (!a.hasPenis) base = `${base}, ${ORAL_SOLO_NEGATIVE_NO_PENIS}`;
  }

  const props = propNegative(req, opts.toy);
  if (props) base = `${base}, ${props}`;

  // What the refiner said would go wrong for this request (see filterAvoid):
  // terms already in the list are not pushed twice.
  const have = new Set(base.toLowerCase().split(/\s*,\s*/));
  if (opts.tattooed && isNude)
    base = `${base}, sleeves, long sleeves, shirt, cardigan, sweater, arm warmers, gloves, holding a flower, real flower, bouquet`;
  if (!opts.tattooed) base = `${base}, tattoo, tattoos, body art, inked skin, tattooed arms, tattooed legs`;
  if (requestSetsViewpoint(req)) {
    base = `${base}, front view, side view, high camera angle, legs together, crossed legs, closed thighs, butt-only framing`;
  }
  base = `${base}, logo, signature, artist name, corner text, watermark logo`;
  // The refiner names "tattoos" as a thing to avoid on a plain request; on an
  // inked companion that would push her own sleeves off her arms.
  const extra = (opts.extra ?? []).filter(
    (t) => t && !have.has(t.toLowerCase()) && !(opts.tattooed && /\b(?:tattoo\w*|ink\w*|body art)\b/i.test(t)),
  );
  return extra.length ? `${base}, ${extra.join(", ")}` : base;
}
import { propClause, propNegative, hasProp, propIsInserted } from "./props";
import type { Toy } from "./toys";
import type { Setting } from "./selfie";
import { anatomyOf, crossSexNegative, genderKind, mentionsPart } from "./anatomy";
import { VIDEO_LORA_STRENGTHS, runpodEndpoint, runpodRun, pickImageTarget, tagJobId, targetFor } from "./runpod";
import { companionImage } from "./companion-images";
import { assertNotSuspended, assertRateLimit } from "./account.server";

const SELFIE_COST = 8;
const VOICE_COST = 3;
const VIDEO_COST = 15;

// How long a job may sit unfinished before it is written off and refunded.
// A 10s clip plus queue time runs past four minutes, so this has to be well
// clear of a slow-but-healthy job while still not leaving a hung one open.
const STALE_JOB_MS = 15 * 60_000;

export { voiceFor } from "./voices";
import { voiceFor } from "./voices";

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

    let userPrompt = data.prompt?.trim();
    // Safety gate on the image request (blocks minors / illegal even for photos).
    const screen = screenUserMessage(userPrompt ?? "");
    if (!screen.allowed) throw new Error(`${BLOCKED_CONTENT}: ${screen.reason}`);

    const p: any = (conv as any).user_personalities;
    const c = p.companions;

    // Cross-gender body part request check
    const crossGenderWarning = checkCrossGenderRequest(c.gender, userPrompt ?? "");
    if (crossGenderWarning) throw new Error(crossGenderWarning);

    // A toy she does not have yet: she says so, in chat, and nothing is charged.
    const { toyForRequest } = await import("./toys.server");
    const { data: au } = await supabase.auth.getUser();
    const { toy, needed } = await toyForRequest(supabase, userId, au?.user?.email, userPrompt ?? "");
    if (toy && userPrompt) {
      const { withToyPlace } = await import("./toys");
      userPrompt = withToyPlace(userPrompt, toy, anatomyOf(c.gender).hasVulva);
    }
    if (needed) {
      const { needsToyReply } = await import("./toys");
      const reply = needsToyReply(needed);
      await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
        kind: "text",
      });
      return { needsToy: needed.id, reply, status: "needs_toy" as const };
    }

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
      toy,
    );

    return { jobId, status: "pending" as const, balance, toy: toy?.name ?? null };
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

/**
 * Where a chat photo or clip is taken: the user's own room when they gave
 * her one for this chat (rooms.server.ts), else her own place as read off
 * her portrait (look.server.ts). Her reel and her card ARE her portrait, and
 * a chat photo rendered in a renderer's default bedroom never looked like
 * them; said as the setting, it is taken where they were.
 */
async function settingFor(conversationId: string, imageUrl: string | null | undefined): Promise<Setting> {
  const { roomFor } = await import("./rooms.server");
  const room = await roomFor(conversationId);
  if (room?.description) return { text: room.description, whose: "user" };
  const { companionScene } = await import("./look.server");
  const scene = await companionScene(imageUrl);
  return scene ? { text: scene, whose: "her" } : null;
}


/**
 * Send a photo job: to the dedicated pod when it is up and has room, else
 * to the serverless endpoint. A pod that fails to take the job hands it to
 * serverless in the same call, so the user never pays for the pod being down.
 */
async function submitImage(
  supabaseAdmin: any,
  serverlessEndpoint: string,
  input: Record<string, unknown>,
): Promise<{ result: { id: string; status: string }; endpoint: string }> {
  const target = await pickImageTarget(supabaseAdmin, serverlessEndpoint);
  if (target.pod && target.endpoint) {
    try {
      const result = await runpodRun(target.endpoint, input);
      return { result, endpoint: target.endpoint };
    } catch (e: any) {
      console.warn(`[media] pod refused the job (${String(e?.message ?? e).slice(0, 120)}); using serverless`);
    }
  }
  const result = await runpodRun(serverlessEndpoint, input, webhookFor("runpod"));
  return { result, endpoint: serverlessEndpoint };
}

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
  toy: Toy | null = null,
): Promise<string> {
  // The user's own room, if they gave her one for this chat; else her own
  // place, read off her portrait, so the photo is taken where her reel was.
  const setting = await settingFor(conversationId, companion.imageUrl);
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

  const { prompt: imagePrompt, avoid, look } = await photoPromptWithAvoid(
    companion,
    userRequest,
    styleBackstory,
    provider,
    toy,
    setting,
  );

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
    const negative = negativeFor(userRequest, companion.gender, {
      moving: false,
      extra: avoid,
      age: companion.age,
      toy,
      tattooed: /tattoo/i.test(look),
    });
    // How many photos this chat already has: the Nth photo of a request always
    // renders the same way, but the next one is a new picture, not a copy.
    const { count: photosSoFar } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("kind", "image");
    const seedSalt = String(photosSoFar ?? 0);
    // The composed frame: Grok draws the clothed version of this exact
    // request from her portrait, and the uncensored pass starts from it. Kept
    // for the job so a retake starts from the same picture.
    let composedFrame: string | null = null;
    const { composeMode } = await import("./compose.server");
    const mode = composeMode();
    if (provider === "comfy" && mode === "grok") {
      const { composeStartFrame, storeStartFrame } = await import("./compose.server");
      const composed = await composeStartFrame({
        portraitUrl: sourceImage,
        request: userRequest ?? "",
        setting: setting ? (typeof setting === "string" ? setting : setting.text) : null,
        toy,
        noun: anatomyOf(companion.gender).noun,
      });
      if (composed) {
        composedFrame = composed.base64;
        await storeStartFrame(job.id, composed.base64).catch((e) =>
          console.warn("composed frame not stored:", e?.message ?? e),
        );
      }
    }
    const input =
      provider === "comfy"
        ? await comfyJobInput(imagePrompt, negative, sourceImage, userRequest, seedSalt, {
            hasPenis: anatomyOf(companion.gender).hasPenis,
            toyTags: toy?.tags ?? null,
            toyKind: toy?.kind ?? null,
            lookTags: inkTags(look),
            startFrame: composedFrame,
            startFromPortrait: mode === "portrait",
          })
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
              seed: (await import("./comfy")).seedFor(`${imagePrompt}#${seedSalt}`),
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

    const { result, endpoint: sentTo } = await submitImage(supabaseAdmin, runpodImage, input);
    await supabaseAdmin
      .from("media_jobs")
      .update({ replicate_id: tagJobId(result.id, sentTo), status: "processing" })
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

/**
 * Her ink as weighted lead tags. A tattooed companion's look phrase says
 * "full tattoo sleeves on both arms, large chest tattoo", and the checkpoint
 * still rendered bare arms on the first live test: ink is the first thing an
 * SDXL checkpoint drops when it redraws skin. Said first and weighted, it stays.
 */

/** "tattoo sleeves" → "tattooed arms": the checkpoint draws a sleeve as a garment. */
export function unsleeve(text: string): string {
  return text
    .replace(/\b(?:full\s+)?(?:colou?rful\s+|black(?:-and-grey|work)?\s+|ink\s+)?(?:tattoo\s+)?sleeves?(?:\s+tattoos?)?(?=\s+(?:on|down|covering)\b)/gi, "tattoos")
    .replace(/\b(?:full\s+)?(?:colou?rful\s+|black(?:-and-grey|work)?\s+|ink\s+)?(?:tattoo\s+)?sleeves?(?:\s+tattoos?)?\b/gi, "arms covered in tattoos");
}

export function inkTags(look: string | null | undefined): string | null {
  const l = (look ?? "").toLowerCase();
  // Her build rides with the ink: the house build was dropped for hers, but
  // said once mid-prompt it lost to the checkpoint's default body.
  const build = l.split(/\s*,\s*/).filter((p) => /\b(?:bust|build|figure|curvy|slim|petite|hourglass|voluptuous)\b/.test(p));
  if (!/tattoo/.test(l)) return build.length ? build.join(", ") : null;
  const parts = l
    .split(/\s*,\s*/)
    .filter((p) => /tattoo/.test(p))
    .map((p) => unsleeve(p.trim()))
    // Placement in plain words the checkpoint renders: a second pod render
    // came back with bare arms and no chest piece from "tattoos on both arms".
    .map((p) =>
      /\barms?\b/.test(p)
        ? "both arms fully covered in dense tattoos from shoulder to wrist"
        : /\bchest\b/.test(p)
          ? "large floral chest tattoo inked across her upper chest above her breasts and along her collarbones"
          : /\b(?:legs?|thighs?)\b/.test(p)
            ? "tattoos covering both thighs"
            : /\b(?:stomach|belly)\b/.test(p)
              ? "large tattoo across the stomach"
              : p,
    );
  return ["heavily tattooed woman", ...parts, ...build].join(", ");
}


/** The nude state as lead tags, for a nude request that keeps no garment. */
export function nudeTags(req: string, hasPenis: boolean): string | null {
  if (!requestIsNude(req) || requestKeepsGarment(req)) return null;
  return hasPenis
    ? "completely nude, fully naked, no clothes, bare skin, bare chest, erect penis visible"
    : "completely nude, fully naked, no clothes, no underwear, bare skin, bare breasts, visible nipples, bare pussy";
}

export async function comfyJobInput(
  prompt: string,
  negative: string,
  portraitUrl: string | null,
  request?: string,
  seedSalt?: string,
  opts: {
    /** Render without the pose guide — the retry after a worker that lacks the model. */
    noPose?: boolean;
    /** Use the core image-to-image graph for a GPU-OOM retry. */
    graph?: "faceid-lite" | "img2img";
    /** Reduce the render bucket and steps for a GPU-OOM retry. */
    memorySafe?: boolean;
    /** The companion has a penis: climax tags describe ejaculation, not squirting. */
    hasPenis?: boolean;
    /** The chest toy's short tags, so the toy leads the prompt weighted and is drawn at all. */
    toyTags?: string | null;
    /** The owned toy kind, used to avoid applying dildo insertion tags to a wand or bullet. */
    toyKind?: string | null;
    /** Her ink, from the look phrase: leads the prompt weighted, or the checkpoint leaves it off. */
    lookTags?: string | null;
    /** A composed frame of this request (compose.server.ts), base64: the pass starts from it. */
    startFrame?: string | null;
    /** Start the pass from her portrait instead of from noise (COMFY_COMPOSE=portrait). */
    startFromPortrait?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const {
    comfyInput,
    comfySettings,
    comfyTemplate,
    wantsReference,
    FACEID_WORKFLOW,
    FACEID_LITE_WORKFLOW,
    FACEID_POSE_WORKFLOW,
    FACEID_I2I_WORKFLOW,
    FACEID_LITE_I2I_WORKFLOW,
    DEFAULT_WORKFLOW,
  } = await import("./comfy");
  let template = comfyTemplate(opts.graph);

  // A composed frame outranks the pose guide: it carries the pose already,
  // and the whole picture with it.
  const extraImages: { name: string; base64: string }[] = [];
  const isFaceIdGraph = template === FACEID_WORKFLOW || template === FACEID_LITE_WORKFLOW;
  const composed = Boolean(opts.startFrame) && isFaceIdGraph;
  if (composed) {
    const { START_NAME } = await import("./compose.server");
    template = template === FACEID_LITE_WORKFLOW ? FACEID_LITE_I2I_WORKFLOW : FACEID_I2I_WORKFLOW;
    extraImages.push({ name: START_NAME, base64: opts.startFrame as string });
  }
  // Her portrait as the start latent: the same graph, at the portrait tiers
  // (0.62 plain / 0.73 nude / 0.78 posed / 0.86 mouth act, comfySettings), so
  // her face, skin and light are what the pass starts from and FaceID holds
  // identity through the undress. Resolved after the portrait is read below.
  const fromPortrait = !composed && Boolean(opts.startFromPortrait) && isFaceIdGraph;

  // A pose guide, when this request has one and the worker can use it. Only
  // the FaceID graph has the wiring for it.
  const { poseFor, poseGuideAvailable } = await import("./poses");
  const guide = !opts.noPose && !composed && (await poseGuideAvailable()) ? poseFor(request ?? "") : null;
  if (guide && template === FACEID_WORKFLOW) {
    template = FACEID_POSE_WORKFLOW;
    extraImages.push({ name: guide.file, base64: guide.base64 });
  }

  let referenceBase64: string | undefined;
  if (wantsReference(template)) {
    // A companion with no portrait renders text-to-image instead of failing.
    //
    // The admin panel creates companions with image_url defaulting to "", and
    // the avatar is uploaded afterwards — so between those two steps, and for
    // any companion whose upload never happened, this threw and every photo
    // request for her failed outright. That is the worst of both: no identity
    // AND no picture.
    //
    // Falling back keeps her working. She will not be consistent between
    // renders, because nothing is anchoring her — the caller compensates by
    // describing her appearance in the prompt instead, which is exactly what
    // referenceReachesRenderer already decides. The fix for consistency is a
    // portrait on the row, not a thrown error here.
    const startFrameReference = opts.graph === "img2img" && opts.startFrame ? opts.startFrame : null;
    const portrait = portraitUrl ? await readPortrait(portraitUrl) : null;
    if (startFrameReference || portrait) {
      // A memory-safe retry can carry the already-composed frame through the
      // core I2I graph. That keeps the requested room, pose, and toy instead
      // of falling back to the companion's original portrait composition.
      referenceBase64 = startFrameReference ?? portrait ?? undefined;
      if (fromPortrait && portrait) {
        const { START_NAME } = await import("./compose.server");
        template = template === FACEID_LITE_WORKFLOW ? FACEID_LITE_I2I_WORKFLOW : FACEID_I2I_WORKFLOW;
        extraImages.push({ name: START_NAME, base64: portrait });
      }
    } else {
      // NEVER fall back to empty-latent txt2img. That path produces a random
      // stranger (wrong ethnicity, wrong face) — the exact failure testers
      // reported (Black companion → white girl with purple hair). Fail and
      // refund so the bug is visible instead of billing for the wrong person.
      throw new Error(
        "Could not load this companion's reference portrait for identity. Check image_url is a public https URL (Supabase avatars), then retry.",
      );
    }
  }

  // Does the REQUEST compose the picture, or does her portrait?
  //
  // A prop, a named posture or a viewpoint all mean the user has said what the
  // picture looks like, and the starting latent must not overrule them. Anything
  // else — "send me a selfie", "send me a nude" — says nothing about
  // composition, so her portrait should supply it and identity holds.
  const {
    requestComposesShot: composes,
    requestIsNude,
    requestKeepsGarment,
    isMouthAct,
    mouthActTags,
  } = await import("./selfie");
  const req = request ?? "";
  const promptSetsComposition = composes(req);
  // Nude without a hard pose still needs medium denoise or the clothed portrait wins.
  const needsUndress = requestIsNude(req) && !requestKeepsGarment(req);
  // Her mouth has to be free to change: a lighter face lock and no detailer
  // pass, on these requests only. See isMouthAct and templateForMouthAct.
  const mouthAct = isMouthAct(req);
  // The act first, weighted. ComfyUI's text encoder reads "(…:1.3)" as
  // emphasis, and the first tokens of an SDXL prompt carry the most weight —
  // which is exactly where the act was not.
  // Nudity first and weighted. From a dressed portrait the checkpoint kept
  // turning the dress into underwear: "completely nude" sat in the middle of
  // a 300-word prompt. At the head, weighted, it is the strongest thing said.
  // Three groups, three weights. One long weighted group drowned the act:
  // the first pod render had her nude and inked but waving instead of
  // rubbing. The act leads, strongest; the nude state next; her ink after.
  // A toy's tags say what it is; where it is, and the pose that shows it,
  // have to lead too, or the render holds it at her stomach or crops the
  // insertion out of the frame (both seen on the pod).
  const { propIsInserted, propIsOral } = await import("./props");
  const analToy = /\b(?:ass|anus|butt|asshole|booty)\b/i.test(req) && !/\b(?:pussy|vagina|cunt)\b/i.test(req);
  const insertableToy = !opts.toyKind || ["dildo", "vibrator", "plug", "beads", "strap-on"].includes(opts.toyKind);
  const insertedLead =
    opts.toyKind === "plug"
      ? "tapered bulb already inside, narrow neck centered in the opening, flared base fully outside"
      : opts.toyKind === "beads"
        ? "smallest beads already inside, remaining graduated beads and pull ring outside"
        : "rounded narrow tip and first half of shaft already visibly inside the opening, outer half and handle or base fully outside";
  const toyPlaced = opts.toyTags
    ? propIsInserted(req) && insertableToy
      ? analToy
        ? `${opts.toyTags}, ${insertedLead}, inserted tip-first in her ass, visible anal penetration and contact at the insertion point, bent over, ass toward the camera, legs apart`
        : `${opts.toyTags}, ${insertedLead}, inserted tip-first in her pussy, visible vaginal penetration and contact at the insertion point, lying back with legs spread wide, knees up, framed from head to knees`
      : propIsOral(req)
        ? `${opts.toyTags} in her mouth, lips around it`
        : opts.toyTags
    : null;
  const act = [toyPlaced, mouthActTags(req, Boolean(opts.hasPenis))].filter(Boolean).join(", ");
  const nude = nudeTags(req, Boolean(opts.hasPenis));
  let insertTrigger = "";
  const lead = [
    act ? `(${act}:1.35)` : "",
    nude ? `(${nude}:1.25)` : "",
    opts.lookTags ? `(${unsleeve(opts.lookTags)}:1.2)` : "",
  ].filter(Boolean);
  // "Sleeve" is a garment to the checkpoint: "tattoo sleeves" rendered white
  // knit sleeves on a nude body. Every mention is said as tattooed arms.
  let finalPrompt = unsleeve(lead.length ? `${lead.join(", ")}, ${prompt}` : prompt);

  {
    const { withFaceSwap, faceSwapOn, withLora } = await import("./comfy");
    if (faceSwapOn() && wantsReference(template)) template = withFaceSwap(template);
    // The insertion LoRA, for a toy inside her (COMFY_LORA_INSERT_PUSSY /
    // _ASS name the files on the volume; unset, nothing changes).
    const { propIsInserted } = await import("./props");
    if (propIsInserted(req)) {
      const anal = /\b(?:ass|anus|butt|asshole|booty)\b/i.test(req) && !/\b(?:pussy|vagina|cunt)\b/i.test(req);
      const name = (anal ? process.env.COMFY_LORA_INSERT_ASS : process.env.COMFY_LORA_INSERT_PUSSY)?.trim();
      if (name) {
        template = withLora(template, name, Number(process.env.COMFY_LORA_INSERT_STRENGTH || "0.8"));
        // The LoRA's own trigger words (sdxl-dildo: "vaginal object insertion").
        insertTrigger = anal
          ? process.env.COMFY_LORA_INSERT_TRIGGER_ASS || "dildo, anal object insertion"
          : process.env.COMFY_LORA_INSERT_TRIGGER_PUSSY || "dildo, vaginal object insertion";
      }
    }
  }
  if (insertTrigger) finalPrompt = `${insertTrigger}, ${finalPrompt}`;
  return comfyInput(
    {
      ...comfySettings(prompt, {
        promptSetsComposition,
        needsUndress,
        template,
        seedSalt,
        mouthAct,
        composed,
        memorySafe: opts.memorySafe,
      }),
      prompt: finalPrompt,
      negative,
      poseImage: guide ? extraImages.find((i) => i.name === guide.file)?.name : undefined,
      startImage:
        template === FACEID_I2I_WORKFLOW || template === FACEID_LITE_I2I_WORKFLOW ? "start.png" : undefined,
    },
    { template, referenceBase64, extraImages },
  );
}

/**
 * Her portrait as base64, or null if it cannot be used.
 *
 * Null rather than throwing, for the same reason as above: a missing or
 * unreachable avatar should cost identity, not the whole picture.
 */
async function readPortrait(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[media] could not read her portrait (${res.status})`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    // RunPod caps a queued job's payload, and base64 is a third larger than the
    // bytes. A portrait is a few hundred KB; anything near the cap is a sign
    // something else is being passed.
    if (bytes.byteLength > 6_000_000) {
      console.warn("[media] her portrait is over 6MB — too large to send with the job");
      return null;
    }
    return bytes.toString("base64");
  } catch {
    return null;
  }
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
  toy: Toy | null = null,
): Promise<string> {
  return (await photoPromptWithAvoid(companion, userRequest, styleBackstory, provider, toy)).prompt;
}

// The prompt and, from the same refiner call, the request-specific terms for
// the negative prompt. One call: the refiner is the slow part of a photo.
export async function photoPromptWithAvoid(
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
  provider: ImageProvider,
  toy: Toy | null = null,
  setting: Setting = null,
): Promise<{ prompt: string; avoid: string[]; look: string }> {
  // Grok rewrites the user's line into a full prompt in the house style; the
  // keyword builder is the fallback when no key is set or the call fails.
  const { refineMediaPrompt } = await import("./prompt-refiner.server");
  const { companionLook } = await import("./look.server");
  // The look first: the refiner is told about her tattoos.
  const look = await companionLook(companion.imageUrl);
  const refinedResult = await refineMediaPrompt("photo", userRequest ?? "", { ...companion, look }, 1, toy, setting);
  const refined = refinedResult?.prompts;
  const avoid = refinedResult?.avoid ?? [];

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
        ? stillImagePrompt(companion, userRequest, toy, setting)
        : videoStillPrompt(companion, userRequest, toy, setting);

  // Does a picture of her actually reach the renderer?
  //
  // Every prompt in this app is written on the assumption that one does: the
  // rules say "leave her hair colour, skin tone and build out entirely, a
  // reference photo supplies all of that", and for WAN and Kontext that is
  // true — both work FROM her portrait.
  //
  // The ComfyUI stock graph is text-to-image. No portrait reaches it at all, so
  // that sentence is false there: the prompt withholds her appearance and
  // nothing else supplies it, leaving the checkpoint's own idea of a body to
  // fill the gap. That is why bodies came back nothing like her.
  const { comfyTemplate, wantsReference } = await import("./comfy");
  const referenceReachesRenderer = provider !== "comfy" || wantsReference(comfyTemplate());

  // ...but "reaches" is not the same as "carries".
  //
  // When the request composes the shot, denoise goes high so the pose and the
  // prop can actually happen, and at that point the reference is no longer
  // holding her likeness. The prompt was still withholding her appearance on
  // the assumption that it was, so nothing described her at all and a brunette
  // came back blonde. Describe her in words exactly when the photo has stopped
  // doing it.
  const { requestComposesShot } = await import("./selfie");
  const promptLedShot = requestComposesShot(userRequest ?? "");

  const prompt = finishMediaPrompt(refined?.[0] ?? builder, userRequest ?? "", {
    anatomy: anatomyOf(companion.gender),
    appendProps: Boolean(refined?.[0]),
    // Appended for BOTH the refined prompt and the builder: neither of them
    // describes her build, because both were written for a path that had her
    // photo. Only when nothing carries her likeness to the renderer.
    appendAppearance: !referenceReachesRenderer || promptLedShot,
    // Her own row, not a default. Without this every companion in the app
    // rendered as the same anonymous woman, because the prompt opened
    // "Photograph of a woman indoors" and nothing ever said which one.
    appearance: { age: companion.age, ethnicity: companion.ethnicity, look },
    // Same condition as appendProps and for the same reason: the builders write
    // their own anatomy clause, the refined prompt no longer does.
    appendAnatomy: Boolean(refined?.[0]),
    // Only when the photo is being cut out of a clip. A real image endpoint
    // renders a still by definition and does not need telling.
    still: provider === "wan",
    // A posed/prop request may also need written appearance details, but it is
    // still an edit of this companion's reference image. Keep the identity
    // clause in that case instead of letting the action prompt replace it.
    lockIdentity: referenceReachesRenderer,
    toy,
    setting,
  });
  return { prompt, avoid, look };
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

    let userPrompt = data.prompt?.trim();
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

    const { toyForRequest } = await import("./toys.server");
    const { data: au } = await supabase.auth.getUser();
    const { toy, needed } = await toyForRequest(supabase, userId, au?.user?.email, userPrompt ?? "");
    if (toy && userPrompt) {
      const { withToyPlace } = await import("./toys");
      userPrompt = withToyPlace(userPrompt, toy, anatomyOf(c.gender).hasVulva);
    }
    if (needed) {
      const { needsToyReply } = await import("./toys");
      const reply = needsToyReply(needed);
      await supabase.from("messages").insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
        kind: "text",
      });
      return { needsToy: needed.id, reply, status: "needs_toy" as const };
    }

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
      toy,
    );

    return { jobId, status: "pending" as const, balance, toy: toy?.name ?? null };
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
/**
 * The exact portrait the homepage uses (companions.image_url).
 *
 * Chat selfies must start from THIS URL so Aria on the site is Aria in chat.
 * Prefer public https (Supabase avatars after regen). Filenames fall through
 * companionImage() → site-relative assets — never invent a different photo.
 */
export function resolveHostedImage(imageUrl?: string | null): string | null {
  const u = (imageUrl ?? "").trim();
  if (!u) return null;

  // Homepage + chat share this: full public URL from admin regen / create flow
  if (/^(https?:|data:)/i.test(u)) return u;

  const base = (process.env.PUBLIC_SITE_URL || "https://www.humancrush.com").replace(
    /\/$/,
    "",
  );

  // Site-relative path (same origin as the card image)
  if (u.startsWith("/")) return `${base}${u}`;

  // Seeded companions store bare filenames like "01-aria.jpg".
  // companionImage() maps those to the Vite-bundled asset URL — same as UI.
  const resolved = companionImage(u);
  if (resolved) {
    if (/^(https?:|data:)/i.test(resolved)) return resolved;
    if (resolved.startsWith("/")) return `${base}${resolved}`;
    return resolved;
  }

  return null;
}

// Each provider posts completions to its own receiver route.
export function webhookFor(provider: "runpod"): string {
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
  toy: Toy | null = null,
): Promise<string> {
  const startImage = resolveHostedImage(companion.imageUrl);
  const setting = await settingFor(conversationId, companion.imageUrl);

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
  const { companionLook } = await import("./look.server");
  const look = await companionLook(companion.imageUrl);
  const refinedVideo = await refineMediaPrompt("video", userReq ?? "", { ...companion, look }, sceneCount, toy, setting);
  const videoAvoid = refinedVideo?.avoid ?? [];
  // Same reason as the photo path: a successful refine replaces the builder, so
  // the prop spec is re-appended to every scene rather than lost.
  const rawReq = userReq ?? "";
  const anatomy = anatomyOf(companion.gender);
  const refinedScenes = refinedVideo?.prompts.length ? refinedVideo.prompts : null;
  const actionLock = videoActionLock(rawReq, companion.gender, toy);
  const toyLock = videoToyLock(toy);
  const scenePrompts = (refinedScenes ?? [videoActionPrompt(companion, userReq, toy, setting)]).map((p) => {
    const locked = actionLock ? `${actionLock} ${p} ${actionLock}` : p;
    const finished = finishMediaPrompt(locked, rawReq, {
      anatomy,
      toy,
      setting,
      appendProps: Boolean(refinedScenes),
      // Per scene, for the same reason it is per photo: the refiner no longer
      // writes the clause, so a scene that did not get it would be the one part
      // of a clip where the body is whatever the renderer felt like.
      // A generic full-body anatomy block made genital-action clips spend most
      // of their prompt describing breasts. WAN then replaced the requested
      // hand motion with its learned breast-fondling motion. The refined scene
      // already names the requested anatomy precisely; keep it focused.
      appendAnatomy: false,
      // Her row reaches the adult clause on this path too. appendAppearance
      // stays off — WAN animates her portrait, so the rest of her appearance
      // comes from the picture — but the age assertion is unconditional.
      appendAppearance: true,
      lockIdentity: true,
      appearance: { age: companion.age, ethnicity: companion.ethnicity, look },
      // This is a clip. The fallback builder ended every scene with the motion
      // tail and a refined scene ended with nothing — while the negative prompt
      // forbade the clip from holding still. Both halves now agree.
      moving: true,
    });
    // Keep the exact catalogue object at both ends of every scene prompt.
    // WAN weighs later tokens in later frames, so a single early description
    // lets a toy disappear or morph as the clip progresses.
    return toyLock ? `${toyLock} ${finished} ${toyLock}` : finished;
  });
  const videoPrompt = scenePrompts.join("\n\n");
  await supabaseAdmin.from("media_jobs").update({ prompt: videoPrompt }).eq("id", job.id);

  // Same centre-crop problem as photos: hand the endpoint a square that keeps
  // her whole body rather than letting it slice the frame down to a torso.
  const fpsSetting = Number(process.env.RUNPOD_VIDEO_FPS || "16");
  // 720p portrait, not the endpoint's square default. The clip a tester sent
  // back was 368 pixels square; nothing about a face is realistic at that size.
  // "WIDTH*HEIGHT"; RUNPOD_VIDEO_SIZE=off hands the choice back to the worker.
  const videoSize = stillKnob("RUNPOD_VIDEO_SIZE", "720*1280");
  const [videoWidth, videoHeight] = (videoSize ?? "")
    .split("*")
    .map((n) => Number(n));
  const videoInput = {
    fps: fpsSetting,
    frames_per_scene: Math.round((totalSeconds * fpsSetting) / scenePrompts.length),
    num_scenes: scenePrompts.length,
    // 30 steps, up from 25: the act has to be finished in every frame, not
    // mostly there.
    sampling_steps: Number(process.env.RUNPOD_VIDEO_STEPS || "30"),
    ...(videoSize ? { size: videoSize } : {}),
    // Endpoint versions differ: newer workers read size, older WAN handlers
    // read explicit dimensions. Supplying both is backward compatible and
    // prevents the silent 368x368 fallback seen in production clip 1261901.
    ...(videoWidth && videoHeight ? { width: videoWidth, height: videoHeight } : {}),
    prompts: scenePrompts,
    negative_prompt: negativeFor(userReq, companion.gender, {
      moving: true,
      extra: [
        ...videoAvoid,
        ...(isRubAct(rawReq)
          ? ["hand moving upward", "hand leaving groin", "hand on stomach", "hand on chest", "breast touching", "breast fondling"]
          : []),
        ...(toy && propIsInserted(rawReq)
          ? [
              "toy hovering outside body",
              "toy beside opening",
              "toy sliding over skin",
              "toy fully withdrawn",
              "hand gripping middle of shaft",
              "handle entering body",
              "base entering body",
              "sideways penetration",
            ]
          : []),
      ],
      age: companion.age,
      toy,
    }),
    lora_strengths: VIDEO_LORA_STRENGTHS,
  };

  // Same face as her photos: render the opening frame on the photo graph first
  // (FaceID / img2img from her portrait, already in the requested scene), and
  // animate THAT. The webhook or the status poll picks it up when the still is
  // done — see advanceVideoFromStill. Starting straight from the shrunken
  // portrait left the video model to redraw her face, and it drifted.
  const comfyEndpoint = runpodEndpoint("comfy");
  if (imageProvider() === "comfy" && comfyEndpoint) {
    try {
      const { comfyTemplate, wantsReference } = await import("./comfy");
      if (wantsReference(comfyTemplate())) {
        const { prompt: stillPrompt, avoid: stillAvoid } = await photoPromptWithAvoid(
          {
            name: companion.name,
            age: companion.age ?? 18,
            ethnicity: companion.ethnicity ?? "",
            gender: companion.gender,
            imageUrl: companion.imageUrl,
          },
          userReq,
          null,
          "comfy",
          // The opening frame is the image the video actually animates. If the
          // owned toy is omitted here, the video starts from a different scene
          // than the request and the action/prop is lost during animation.
          toy,
          setting,
        );
        const stillInput = await comfyJobInput(
          stillPrompt,
          negativeFor(userReq, companion.gender, {
            moving: false,
            extra: stillAvoid,
            age: companion.age,
            toy,
          }),
          startImage,
          userReq,
          `video-${job.id}`,
          {
            hasPenis: anatomyOf(companion.gender).hasPenis,
            // The opening still is the frame the video actually animates.
            // Keep the owned chest toy in this path too; otherwise the video
            // silently falls back to the checkpoint's generic prop.
            toyTags: toy?.tags ?? null,
            toyKind: toy?.kind ?? null,
          },
        );
        const { result: still, endpoint: stillSentTo } = await submitImage(supabaseAdmin, comfyEndpoint, stillInput);
        await supabaseAdmin
          .from("media_jobs")
          .update({
            replicate_id: tagJobId(still.id, stillSentTo),
            provider: "runpod-still",
            status: "processing",
            prompt: JSON.stringify({ stage: "still", videoInput, videoPrompt }),
          })
          .eq("id", job.id);
        return job.id;
      }
    } catch (e: any) {
      console.warn(`[media] face-locked start frame failed, using her portrait: ${e?.message ?? e}`);
    }
  }

  // The clip starts from the composed frame of this request when there is
  // one: the pose and the room arrive in the first frame instead of being
  // reached for from her portrait.
  let startSource = startImage;
  {
    const { composeStartFrame, storeStartFrame } = await import("./compose.server");
    const composed = await composeStartFrame({
      portraitUrl: startImage,
      request: userReq ?? "",
      setting: setting ? (typeof setting === "string" ? setting : setting.text) : null,
      toy,
      noun: anatomy.noun,
    });
    if (composed) {
      try {
        startSource = await storeStartFrame(job.id, composed.base64);
      } catch (e: any) {
        console.warn("composed frame not stored:", e?.message ?? e);
      }
    }
  }
  let startFrame = startSource;
  try {
    const { squareStartFrame, fitStartFrame } = await import("./start-frame.server");
    const [vw, vh] = (videoSize ?? "").split("*").map((n) => Number(n));
    // A portrait clip takes the portrait fitted to its frame; a square one is squared.
    startFrame =
      vw && vh && vh > vw
        ? await fitStartFrame(startSource, `vid-${userId}-${Date.now()}`, vw, vh)
        : await squareStartFrame(startSource, `vid-${userId}-${Date.now()}`);
  } catch {
    /* fall back to the raw portrait rather than failing the whole request */
  }

  // videoInput (above) carries the clip length: length is frames / fps on this
  // endpoint, and total length is frames_per_scene * num_scenes, so the
  // requested duration is divided across the scenes there.
  try {
    const result = await runpodRun(
      runpodVideo,
      { image_url: startFrame, ...videoInput },
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
        "id, user_id, conversation_id, kind, cost, status, provider, replicate_id, media_url, error, created_at",
      )
      .eq("id", data.jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");

    if (job.status === "completed")
      return { status: "completed", mediaUrl: (job as any).media_url };
    if (job.status === "failed")
      return { status: "failed", error: (job as any).error ?? "Generation failed" };
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
    // Being resubmitted after a worker error (see retryImageJob): nothing to
    // poll yet, and the placeholder must never be reported as a failed id.
    if ((job as any).replicate_id === "retrying") return { status: "processing" };

    // A video still rendering its face-locked opening frame on the ComfyUI
    // endpoint (see startVideoJob). Poll THAT endpoint, and when the still is
    // done start the video — the same step the webhook takes, claimed
    // atomically so only one of them submits it.
    if ((job as any).provider === "runpod-advancing") return { status: "processing" };
    if ((job as any).provider === "runpod-still") {
      const stillTarget = targetFor(runpodEndpoint("comfy"), (job as any).replicate_id);
      const endpoint = stillTarget.endpoint;
      if (!endpoint) return { status: "processing" };
      const { runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } =
        await import("./runpod");
      let res: { status: string; output?: any; error?: any };
      try {
        res = await runpodGet(endpoint, stillTarget.id);
      } catch {
        return { status: "processing" };
      }
      const state = runpodStatusOf(res.status);
      if (state === "processing") return { status: "processing" };
      const err = runpodOutputError(res.output, res.error);
      const url = runpodOutputUrl(res.output);
      if (state === "failed" || err || !url) {
        await fail(
          job as any,
          err || `Her opening frame did not render (${res.status})`,
          (job as any).replicate_id,
        );
        return { status: "failed" };
      }
      const { advanceVideoFromStill } = await import("./media-finalize.server");
      await advanceVideoFromStill(job as any, url);
      return { status: "processing" };
    }

    // RunPod jobs need no face-swap chaining: the image path edits her real
    // photo and the video path animates it, so identity is already hers.
    if ((job as any).provider === "runpod") {
      const target = targetFor(runpodEndpoint(job.kind), (job as any).replicate_id);
      const endpoint = target.endpoint;
      if (!endpoint) return { status: job.status };

      const { runpodGet, runpodStatusOf, runpodOutputUrl, runpodOutputError } =
        await import("./runpod");
      let res: { status: string; output?: any; error?: any };
      try {
        res = await runpodGet(endpoint, target.id);
      } catch {
        return { status: job.status }; // transient — keep polling
      }

      const state = runpodStatusOf(res.status);
      if (state === "failed") {
        await fail(
          job as any,
          runpodOutputError(res.output, res.error) || `Job ${res.status}`,
          (job as any).replicate_id,
        );
        return { status: "failed" };
      }
      if (state === "processing") {
        // Still in the queue after minutes: no worker has taken it. Send it
        // again once, and tell the client what it is waiting on.
        const queued = String(res.status).toUpperCase() === "IN_QUEUE";
        if (queued) {
          const { requeueIfStuck } = await import("./media-finalize.server");
          await requeueIfStuck(job as any, endpoint, res.status);
        }
        return { status: "processing", queued, waitedMs: ageMs };
      }

      const err = runpodOutputError(res.output, res.error);
      if (err) {
        await fail(job as any, err, (job as any).replicate_id);
        return { status: "failed" };
      }
      const url = runpodOutputUrl(res.output);
      if (!url) {
        // A ComfyUI worker that rendered nothing usually says why in `errors`
        // — a missing checkpoint, a node that is not installed. That belongs in
        // the job row rather than a flat "no output", because it is the
        // difference between a bad request and a misconfigured endpoint.
        const { comfyError } = await import("./comfy");
        await fail(
          job as any,
          comfyError(res.output) || "No output from generation model",
          (job as any).replicate_id,
        );
        return { status: "failed" };
      }
      try {
        const mediaUrl = await complete(job as any, url);
        // null: the picture failed its check and is being rendered again.
        if (!mediaUrl) return { status: "processing" };
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
      .select("user_personalities(companions(name, sort_order, voice_id, gender))")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");

    const { free, paid } = await ensureBalance(supabase, userId, VOICE_COST);

    const comp = (conv as any).user_personalities?.companions;
    const voice = voiceFor(comp ?? {});
    // What the user last said, so "moan for me" gets moans in her voice note.
    const { data: lastUser } = await supabase
      .from("messages")
      .select("content")
      .eq("conversation_id", data.conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Generate first; only charge if it actually succeeds. Orpheus (her own
    // voice, with sighs and moans) when RUNPOD_TTS_ENDPOINT is set, the OpenAI
    // voice otherwise or on any failure — see voice.server.ts.
    const { companionVoiceNote } = await import("./voice.server");
    const buf = await companionVoiceNote({
      reply: data.text,
      userAsk: (lastUser as any)?.content ?? "",
      companion: comp ?? {},
      openaiVoice: voice,
    });
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

    // Screened on the way out, like a chat reply. This line is written by the
    // same model and then SPOKEN ALOUD to the user, so it is the last place
    // that should be trusted unchecked — and until now it was the only
    // model-written text in the app that nothing looked at.
    const spoken = screenAssistantReply(line).allowed ? line : "";
    const voice = voiceFor(c);
    const buf = await textToSpeech(spoken || `Hey you… I made this just for you.`, voice);
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
      content: data.caption || "",
      kind: "video",
      media_url: data.dataUrl,
    });

    return { balance };
  });
