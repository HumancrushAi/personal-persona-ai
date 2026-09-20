import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A literal example in a prompt is not an illustration to a language model. It
// is the highest-probability thing to say — so it gets said, to anything.
//
// This has now happened four times in this project, and every time it shipped:
//
//   1. The app's photo teaser, left verbatim in the conversation history:
//      "how old are you?" → "mmm okay… give me a sec, taking one just for you 📸"
//   2. The history annotation added to fix (1):
//      "how are you?" → "(the app was already delivering media to the user at this point)"
//   3. The photo rule's own example:
//      "how old are you?" → "mmm i wish, but you can't send me pics here…"
//   4. The minor-refusal script:
//      "how are you?" → "Sorry — I can't do that. This site is 18+ only…"
//
// Each one was a sentence written into the prompt in quotes for the model to
// copy, and each one became its answer to unrelated questions. So: describe the
// behaviour, never write the line.
describe("the system prompt scripts no replies", () => {
  const source = readFileSync(join(__dirname, "..", "chat.functions.ts"), "utf8");
  // ONLY what the model is shown. The same sentences exist elsewhere in this
  // file on purpose — TEASERS holds the photo line the APP writes, and the
  // refusal exists as the server-side replacement — and neither is ever put in
  // front of the model, so neither can be copied.
  const start = source.indexOf("const systemPrompt = [");
  const end = source.indexOf('.join("\\n\\n")', start);
  expect(start, "systemPrompt array not found — did it move?").toBeGreaterThan(-1);
  expect(end, "end of systemPrompt array not found").toBeGreaterThan(start);
  // Comments describe these failures on purpose, so they are not evidence.
  const code = source
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  it("has no phrase that hands the model a line to copy", () => {
    for (const introducer of [
      /Something like "/i,
      /Say plainly and once: "/i,
      /react with ONE short[^"]*"/i,
      /respond with[^.]{0,20}"/i,
      /reply with[^.]{0,20}"/i,
    ]) {
      expect(code, `prompt scripts a reply: ${introducer}`).not.toMatch(introducer);
    }
  });

  it("does not contain the four lines that actually shipped", () => {
    for (const shipped of [
      "give me a sec, taking one just for you",
      "the app was already delivering media to the user at this point",
      "you can't send me pics here",
    ]) {
      expect(code, `"${shipped}" is back in the prompt`).not.toContain(shipped);
    }
  });

  // The refusal text still exists ONCE, as the server-side replacement used
  // when screenAssistantReply blocks a reply. The model never sees that string,
  // so it cannot copy it. More than one occurrence means it is back in the
  // prompt.
  it("keeps the refusal server-side only, out of the model's sight", () => {
    expect(code, "the refusal is scripted in the prompt again").not.toContain(
      "This site is 18+ only",
    );
  });

  // The fifth instance was not a scripted line. It was a scripted TOPIC.
  //
  // Two rules, ~250 words between them, explained how media delivery works:
  // that the app sends pictures, that she does not, that the user cannot upload
  // one, and — mine, from commit d66a152 — "the app is NOT sending a picture
  // for this message". She relayed the explanation. "how are you" returned
  // "Sorry love, but I can't send photos or videos here."
  //
  // A model does not distinguish "here is how the system works" from "here is
  // what to say". 250 words on one subject is also simply the loudest thing in
  // the prompt, so it wins any message with no other strong pull — which is
  // exactly what a plain "how are you" is.
  //
  // So the prompt may forbid the output FORMS. It may not narrate the pipeline.
  it("does not explain to her how media delivery works", () => {
    for (const narration of [
      /the app is not sending/i,
      /delivered by the app/i,
      /are delivered by/i,
      /no way for them to upload/i,
      /tap the .{0,3} photo button/i,
      /if you are writing a reply at all/i,
      /can'?t send images/i,
    ]) {
      expect(code, `prompt narrates the media pipeline: ${narration}`).not.toMatch(
        narration,
      );
    }
  });

  // A budget, not a ban. Media has to be mentioned — she must not type
  // "[sent a pic]" — but the moment it is the biggest subject in the prompt it
  // becomes her answer to everything. It was 40+ before this test existed.
  it("keeps media a small part of the prompt, not its loudest topic", () => {
    const mentions = (code.match(
      /\b(?:photo|photos|picture|pictures|pic|pics|selfie|selfies|image|images|video|videos)\b/gi,
    ) ?? []).length;
    expect(mentions, "media is dominating the prompt again").toBeLessThanOrEqual(12);
  });

  // Sixth instance, and the most literal one yet. TWO separate blocks told her
  // to "say no ... briefly": the ABSOLUTE RULE's "Say no plainly and briefly,
  // IN YOUR OWN WORDS, once" and the priority block's "say no briefly in your
  // own words". Asked "how old are you", she replied, in full:
  //
  //     No.
  //
  // Brief, and in her own words. The instruction executed. An age question is
  // the densest possible trigger for a prompt whose age-adjacent mass is almost
  // entirely about refusing, so that is the branch it took.
  //
  // A rule may describe the BEHAVIOUR ("turn it down and change the subject").
  // It may not contain the words to say.
  it("never tells her to say a word that is itself a reply", () => {
    for (const sayable of [/say no\b/i, /\bsay "?sorry/i, /reply "?no/i, /just say\b/i]) {
      expect(code, `prompt scripts a one-word reply: ${sayable}`).not.toMatch(sayable);
    }
  });
});
