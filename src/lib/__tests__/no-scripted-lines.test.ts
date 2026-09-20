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
});
