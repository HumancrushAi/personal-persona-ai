import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { refineMediaPrompt, stripUnrequestedProps } from "../prompt-refiner.server";

const subject = { gender: "female", ethnicity: "Italian", age: 26 };

describe("refineMediaPrompt", () => {
  const realKey = process.env.XAI_API_KEY;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
  });

  it("stays out of the way when no key is configured", async () => {
    delete process.env.XAI_API_KEY;
    expect(await refineMediaPrompt("photo", "in the shower", subject)).toBeNull();
  });

  it("returns null for an empty request rather than inventing one", async () => {
    process.env.XAI_API_KEY = "test";
    expect(await refineMediaPrompt("photo", "   ", subject)).toBeNull();
  });

  // A refusal must not reach the renderer — "I can't help with that" as a
  // generation prompt is worse than the builder output it would replace.
  it("rejects a refusal and falls back", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "I'm sorry, I can't help with that request at all." } },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toBeNull();
  });

  it("rejects a stub answer", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toBeNull();
  });

  it("passes a real refined prompt through", async () => {
    process.env.XAI_API_KEY = "test";
    const good =
      "Wide full body shot of a woman standing in a bedroom, her whole body from head to feet in frame, face clearly visible, camera at a distance. She is already completely naked with nothing on, bare breasts visible. Candid photograph, natural light, real skin with visible pores.";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: good } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("photo", "naked on the bed", subject)).toEqual([good]);
  });

  it("falls back when the API errors", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await refineMediaPrompt("video", "dancing", subject)).toBeNull();
  });
});

// "I only asked for pussy, not with a dildo." One of the three nude examples
// the model was always shown had a dildo in it, and the model reproduced it on
// a request that named no toy. The example is now shown only to a request
// that asked for a toy, and a toy the request did not name is cut from the
// answer regardless.
describe("a toy nobody asked for", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  const answer =
    "exact same woman as the reference image, completely nude, reclining against pillows, smooth matte silicone dildo inserted into her pussy, her fingers on its base, bare breasts, plain white sheets, soft window daylight, candid raw photograph with visible pores";

  function captureSystemPrompt() {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: any) => {
      seen.push(JSON.parse(init.body).messages[0].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), {
        status: 200,
      });
    });
    return seen;
  }

  it("is not shown to a request that named none", async () => {
    process.env.XAI_API_KEY = "test";
    const seen = captureSystemPrompt();
    await refineMediaPrompt("photo", "send me a picture of your pussy", subject);
    // The rules still name "dildo" as a word to use when the user does; it is
    // the worked EXAMPLE of one that must not be there.
    expect(seen[0]).not.toMatch(/silicone dildo inserted/i);
  });

  it("is shown to a request that asked for one", async () => {
    process.env.XAI_API_KEY = "test";
    const seen = captureSystemPrompt();
    await refineMediaPrompt("photo", "a dildo in your pussy", subject);
    expect(seen[0]).toMatch(/dildo inserted/i);
  });

  it("is cut from the answer when the request named none", async () => {
    process.env.XAI_API_KEY = "test";
    captureSystemPrompt();
    const out = await refineMediaPrompt("photo", "send me a picture of your pussy", subject);
    expect(out?.[0]).not.toMatch(/dildo|silicone/i);
    expect(out?.[0]).toMatch(/bare breasts/);
    expect(out?.[0]).toMatch(/window daylight/);
  });

  it("is kept when the request asked for it", async () => {
    process.env.XAI_API_KEY = "test";
    captureSystemPrompt();
    const out = await refineMediaPrompt("photo", "a dildo in your pussy", subject);
    expect(out?.[0]).toMatch(/dildo inserted/);
  });

  it("strips by fragment, on its own", () => {
    const p = stripUnrequestedProps(
      "completely nude, holding a pink vibrator against her clit, lying back on the bed, warm lamplight, candid raw photograph with real skin texture",
      "show me your pussy",
    );
    expect(p).toBe(
      "completely nude, lying back on the bed, warm lamplight, candid raw photograph with real skin texture",
    );
  });
});

// A video is rendered scene by scene, so the refiner has to hand back one
// prompt per scene rather than a single block the endpoint would stretch.
describe("refineMediaPrompt video scenes", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  it("splits a numbered list into separate scene prompts", async () => {
    process.env.XAI_API_KEY = "test";
    const body =
      "1. exact same woman as the reference image, completely nude, standing in a marble shower, water running over her tits, golden light, photorealistic 8k\n" +
      "2. exact same woman as the reference image, completely nude, kneeling on the wet floor, fingers between her legs, steam, photorealistic 8k";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), {
          status: 200,
        }),
    );
    const out = await refineMediaPrompt("video", "shower scene", subject, 2);
    expect(out).toHaveLength(2);
    expect(out?.[0]).toMatch(/^exact same woman/);
    expect(out?.[1]).toMatch(/kneeling/);
  });

  it("never returns more scenes than were asked for", async () => {
    process.env.XAI_API_KEY = "test";
    const body = [1, 2, 3, 4, 5]
      .map(
        (n) =>
          `${n}. exact same woman as the reference image, completely nude scene ${n}, luxury bedroom, soft lighting, photorealistic 8k detailed skin`,
      )
      .join("\n");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("video", "strip", subject, 2)).toHaveLength(2);
  });
});

// Promo prompts are the opposite content rules from chat media: clothed,
// publishable, and when a reference image supplies the face the model must not
// invent a conflicting one.
describe("refinePromoPrompt", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  it("stays out of the way with no key", async () => {
    const { refinePromoPrompt } = await import("../prompt-refiner.server");
    delete process.env.XAI_API_KEY;
    expect(await refinePromoPrompt("a goth woman")).toBeNull();
  });

  it("tells the model not to invent looks when a reference is supplied", async () => {
    const { refinePromoPrompt } = await import("../prompt-refiner.server");
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "the same woman as the reference image, identical face and hair, black silk robe, balcony, overcast daylight, 85mm lens, real skin texture with visible pores",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    await refinePromoPrompt("on a balcony", true);
    expect(sent.messages[0].content).toMatch(/reference image/i);
    expect(sent.messages[0].content).toMatch(/Do NOT invent/i);
  });

  it("keeps the minor guard in the promo rules", async () => {
    const { refinePromoPrompt } = await import("../prompt-refiner.server");
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "x".repeat(80) } }] }), {
        status: 200,
      });
    });
    await refinePromoPrompt("a woman in a kitchen");
    expect(sent.messages[0].content).toMatch(/never describe the subject as young/i);
  });
});

// The refiner writes the prompt that production actually renders — a successful
// refine replaces the keyword builder wholesale. So every rule the builders
// enforce has to be enforced here too, starting with the one that broke:
// nothing in the positive prompt may negate.
describe("the refiner never lets a negation reach the renderer", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  const systemPromptFor = async (req: string, companion: any = subject) => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "exact same woman as the reference image, completely nude, bare breasts and detailed pussy, lying back on the bed, warm lamplight, candid raw photograph with visible pores",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    await refineMediaPrompt("photo", req, companion);
    return sent.messages[0].content as string;
  };

  it("tells the model, in the system prompt, that the renderer cannot negate", async () => {
    const sys = await systemPromptFor("stick a dildo in your pussy");
    expect(sys).toMatch(/renderer cannot read negation/i);
    expect(sys).toMatch(/WRITE ONLY WHAT IS IN THE PICTURE/);
  });

  // The old rules ORDERED the negation: "completely away from her face, mouth,
  // and chest" and "never allow it to look like a smoking pipe, bong, or
  // bottle". Grok obeyed, and the user was sent the bong.
  it("no longer orders the model to write the anti-face wording", async () => {
    const sys = await systemPromptFor("stick a dildo in your pussy");
    expect(sys).not.toMatch(/away from (?:her )?face/i);
    expect(sys).not.toMatch(/smoking pipe, bong/i);
  });

  it("asks for exactly one framing instead of making the model choose", async () => {
    const wide = await systemPromptFor("stick a dildo in your pussy");
    expect(wide).toMatch(/from the top of her head down to her knees/);
    expect(wide).not.toMatch(/close-up point-of-view photograph taken from between/);

    const close = await systemPromptFor("show me your pussy close to my face");
    expect(close).toMatch(/close-up point-of-view photograph taken from between/);
    expect(close).not.toMatch(/from the top of her head down to her knees, her face clearly/);
  });

  // A female companion's system prompt used to carry two paragraphs of penis
  // anatomy and two worked examples of nude men.
  it("describes only the anatomy the companion actually has", async () => {
    const female = await systemPromptFor("get naked", subject);
    expect(female).not.toMatch(/erect cock|testicles/i);

    const male = await systemPromptFor("get naked", { gender: "male", age: 30 });
    expect(male).toMatch(/testicles/i);
    expect(male).not.toMatch(/naturally shaped attractive pussy/i);
  });

  it("strips a negation the model wrote anyway", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "exact same woman as the reference image, completely nude, bare breasts and detailed pussy, dildo inserted between her thighs, sex toy held away from her face and mouth, warm bedside lamplight, candid raw photograph, not cropped, real skin with visible pores",
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const out = await refineMediaPrompt("photo", "stick a dildo in your pussy", subject);
    expect(out?.[0]).not.toMatch(/away from her face/i);
    expect(out?.[0]).not.toMatch(/not cropped/i);
    // and the rest of the prompt survives intact
    expect(out?.[0]).toMatch(/dildo inserted between her thighs/);
    expect(out?.[0]).toMatch(/warm bedside lamplight/);
  });

  // A sanitised prompt passes the "I'm sorry" check and then silently replaces
  // the explicit builder — the user pays 8 credits for a portrait.
  it("rejects an answer that came back scrubbed of anything explicit", async () => {
    process.env.XAI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "exact same woman as the reference image, identical face and hair, wearing a flowing summer dress, standing in a sunlit meadow, soft golden light, candid raw photograph, authentic skin texture with visible pores, shot on 85mm",
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await refineMediaPrompt("photo", "get completely naked for me", subject)).toBeNull();
  });

  it("still passes a clothed request through, where explicit words are wrong", async () => {
    process.env.XAI_API_KEY = "test";
    const dressed =
      "exact same woman as the reference image, identical face and hair, wearing a red silk slip dress, seated at a candlelit table, warm restaurant light, candid raw photograph, authentic skin texture with visible pores";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: dressed } }] }), {
          status: 200,
        }),
    );
    expect(await refineMediaPrompt("photo", "wearing your red dress at dinner", subject)).toEqual([
      dressed,
    ]);
  });
});

describe("stripNegations", () => {
  it("drops the whole fragment, so the stray noun goes with it", async () => {
    const { stripNegations } = await import("../prompt-refiner.server");
    const out = stripNegations(
      "exact same woman as the reference image, completely nude, sex toy held away from her face, " +
        "lying back on the bed, warm bedside lamplight, candid raw photograph with visible pores",
    );
    expect(out).not.toMatch(/away from/);
    // and the fragment goes as a unit, taking the stray `face` with it
    expect(out).not.toMatch(/\bface\b/);
    expect(out).toBe(
      "exact same woman as the reference image, completely nude, lying back on the bed, " +
        "warm bedside lamplight, candid raw photograph with visible pores",
    );
  });

  it("leaves a clean prompt untouched", async () => {
    const { stripNegations } = await import("../prompt-refiner.server");
    const clean = "nude woman, dildo inserted between her thighs, bedroom, warm light";
    expect(stripNegations(clean)).toBe(clean);
  });

  // An empty prompt renders a stranger, which is worse than a prompt with one
  // negation left in it.
  it("keeps the original when stripping would gut it", async () => {
    const { stripNegations } = await import("../prompt-refiner.server");
    const mostlyNegation = "not cropped, not a close-up, no watermark, woman";
    expect(stripNegations(mostlyNegation)).toBe(mostlyNegation);
  });
});

// The reported failure: a request that named a viewpoint and a part came back as
// a front-facing picture of a different part entirely.
//
// It was not the model ignoring the request. Four things in the system prompt
// specified the front and none of them were conditioned on what was asked for —
// the worked examples, the ANATOMY block (which ends "Write it in exactly those
// words"), every branch of the framing bullet, and a focus flag that only ever
// asked about one part. The single clause that knew what "from behind" meant was
// outvoted. These tests pin the four.
describe("a viewpoint the user set themselves", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  const systemPromptFor = async (req: string, kind: "photo" | "video" = "photo") => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "exact same woman as the reference image, identical face and hair, completely nude, bare skin, kneeling on the bed, warm lamplight, candid raw photograph with visible pores",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    await refineMediaPrompt(kind, req, subject, kind === "video" ? 2 : 1);
    return sent.messages[0].content as string;
  };

  it("withholds the verbatim anatomy order when the request set its own viewpoint", async () => {
    const sys = await systemPromptFor("bend over and show me the view from behind");
    expect(sys).not.toMatch(/Write it in exactly those words/);
  });

  it("still sends it for a request that set no viewpoint", async () => {
    const sys = await systemPromptFor("naked on the bed");
    expect(sys).toMatch(/Write it in exactly those words/);
  });

  // "ass" has been in selfie.ts's nudity vocabulary all along, so this counted as
  // a request for a nude photo and then went to a front-facing template. Naming
  // the part is setting the viewpoint.
  it("counts naming the part as setting the viewpoint", async () => {
    const sys = await systemPromptFor("show me your ass");
    expect(sys).not.toMatch(/Write it in exactly those words/);
    expect(sys).toMatch(/THEIR viewpoint in THEIR words/);
  });

  it("replaces the default framing rather than adding to it", async () => {
    const sys = await systemPromptFor("from behind, on all fours");
    expect(sys).toMatch(/THEIR viewpoint in THEIR words/);
    // "camera two metres away" is the default framing bullet's own wording, and
    // nothing else in the file says it. The phrases it shares with the worked
    // examples are deliberately left out of this assertion: the examples are
    // still front-facing after the demotion, and pinning their text here would
    // make this test pass for the wrong reason.
    expect(sys).not.toMatch(/camera two metres away/);
  });

  // The POV worked example looks up the front of the body. A close-up that set
  // its own viewpoint gets the format lesson without that composition.
  it("withholds the front-facing POV example from a close-up that set a viewpoint", async () => {
    const sys = await systemPromptFor("close up of your ass");
    expect(sys).not.toMatch(/looking up along her body/);
  });

  it("keeps the POV example for a close-up that set none", async () => {
    const sys = await systemPromptFor("close up of your pussy");
    expect(sys).toMatch(/looking up along her body/);
  });

  // Examples are the strongest instruction in the file and every one of them is
  // front-facing, so when they disagree with the request they are demoted in
  // writing to the one thing they are still needed for.
  it("demotes the examples to format when the request disagrees with them", async () => {
    const sys = await systemPromptFor("turn around and bend over");
    expect(sys).toMatch(/FORMAT ONLY/);
    expect(sys).toMatch(/the authority on all four/);
  });

  it("leaves the examples undemoted when they agree with the request", async () => {
    const sys = await systemPromptFor("naked on the bed");
    expect(sys).not.toMatch(/FORMAT ONLY/);
  });

  it("applies to video as well as photo", async () => {
    const sys = await systemPromptFor("bend over for me", "video");
    expect(sys).not.toMatch(/Write it in exactly those words/);
    expect(sys).toMatch(/THEIR viewpoint in THEIR words/);
  });

  // Both named: the focal-point bullet puts its subject in the centre of the
  // frame, which is a composition the user already chose differently.
  it("drops the centre-of-frame focus bullet when the user placed the camera", async () => {
    const sys = await systemPromptFor("your pussy from behind");
    expect(sys).not.toMatch(/FOCAL POINT of the photograph/);
  });

  it("keeps it when they did not", async () => {
    const sys = await systemPromptFor("send me a picture of your pussy");
    expect(sys).toMatch(/FOCAL POINT of the photograph/);
  });
});

// The third wardrobe state. `nude` was a boolean, so a request that MOVES a
// garment collapsed into one of two templates and each threw away half of what
// was asked for: "nude" loses the garment, "clothed" loses the position.
describe("a garment the user moved", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  const systemPromptFor = async (req: string) => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "exact same woman as the reference image, identical face and hair, black leggings rolled down to her knees, bare skin above them, kneeling on the bed, warm lamplight, candid raw photograph with visible pores",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    await refineMediaPrompt("photo", req, subject);
    return sent.messages[0].content as string;
  };

  it("asks for the garment AND the position the user put it in", async () => {
    const sys = await systemPromptFor("your leggings pulled down to your knees");
    expect(sys).toMatch(/the GARMENT AND ITS POSITION/);
  });

  it("does not collapse it into full nudity", async () => {
    const sys = await systemPromptFor("your leggings pulled down to your knees");
    expect(sys).not.toMatch(/nudity stated as ALREADY TRUE/);
  });

  it("does not collapse it into fully dressed either", async () => {
    const sys = await systemPromptFor("your leggings pulled down to your knees");
    expect(sys).not.toMatch(/STAYING ON/);
  });

  it("leaves a plain nude request alone", async () => {
    const sys = await systemPromptFor("get completely naked");
    expect(sys).toMatch(/nudity stated as ALREADY TRUE/);
    expect(sys).not.toMatch(/the GARMENT AND ITS POSITION/);
  });

  it("leaves a plain clothed request alone", async () => {
    const sys = await systemPromptFor("wearing your red dress at dinner");
    expect(sys).toMatch(/STAYING ON/);
    expect(sys).not.toMatch(/the GARMENT AND ITS POSITION/);
  });
});

// "If I say lie down it should. If I say stand it should. If I say turn it
// should."
//
// None of those were answerable. The posture bullet opened "INFER from the act
// rather than wait to be told", and the bullet under it ended "even then, when
// she is lying down at all, write 'propped up on a stack of pillows'" — a rule
// that fired hardest exactly when the user HAD said what they wanted. Inference
// is the right default for a request that named nothing, and the wrong answer to
// a request that named something.
describe("a posture the user named", () => {
  const realKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = realKey;
    vi.restoreAllMocks();
  });

  const systemPromptFor = async (req: string) => {
    process.env.XAI_API_KEY = "test";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "exact same woman as the reference image, identical face and hair, completely nude, bare skin, warm lamplight, candid raw photograph with visible pores",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    await refineMediaPrompt("photo", req, subject);
    return sent.messages[0].content as string;
  };

  it("stops the model inferring a posture over the top of it", async () => {
    const sys = await systemPromptFor("lie down on the bed for me");
    expect(sys).toMatch(/the POSTURE THE USER NAMED/);
    expect(sys).not.toMatch(/INFER from the act rather than wait to be told/);
  });

  // The specific clause that made "lie down" unanswerable: it applied itself
  // "even then", on requests that had named the position.
  it("no longer overrides lying down with propped up on pillows", async () => {
    const sys = await systemPromptFor("lie down flat on your back");
    expect(sys).not.toMatch(/propped up on a stack of pillows/);
  });

  it("obeys standing", async () => {
    const sys = await systemPromptFor("stand up for me");
    expect(sys).toMatch(/the POSTURE THE USER NAMED/);
    expect(sys).not.toMatch(/Choose standing only when the user asked for it/);
  });

  it("obeys turning", async () => {
    const sys = await systemPromptFor("turn around for me");
    expect(sys).toMatch(/the POSTURE THE USER NAMED/);
  });

  it("obeys sitting and kneeling", async () => {
    for (const req of ["sit on the edge of the bed", "kneel on the floor"]) {
      const sys = await systemPromptFor(req);
      expect(sys).toMatch(/the POSTURE THE USER NAMED/);
    }
  });

  // Inference is still the right default, and an ACT is not a stated posture —
  // that distinction is why this has its own regex rather than reusing the
  // keyword builder's, which counts "dildo" and "fuck" as carrying a posture.
  it("still infers one when the request named none", async () => {
    const sys = await systemPromptFor("touch yourself for me");
    expect(sys).toMatch(/INFER from the act rather than wait to be told/);
    expect(sys).not.toMatch(/the POSTURE THE USER NAMED/);
  });

  it("keeps the upright default for a request that named no position", async () => {
    const sys = await systemPromptFor("send me a nude");
    expect(sys).toMatch(/keep the torso UPRIGHT or PROPPED UP/);
  });

  it("drops the upright default for a request that did name one", async () => {
    const sys = await systemPromptFor("lie down on your side");
    expect(sys).not.toMatch(/keep the torso UPRIGHT or PROPPED UP/);
  });
});
