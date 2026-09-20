import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The chat model was answering messages from a hundred turns earlier.
//
// The history fetch read `.order("created_at", { ascending: true }).limit(30)`.
// PostgREST applies LIMIT after ORDER BY, so that is the FIRST thirty messages
// the conversation ever had — not the last thirty. Five things read `history`:
// what the model is shown as the conversation, the rolling summary, the "send
// another one" media lookup, fact extraction, and the length check. Past
// message thirty, all of them were frozen on the opening of the chat.
//
// The chat UI runs its own query with no limit, so the user saw their real
// transcript while the model answered something ancient. "how are you" came
// back as a line about not sending pictures because the model never received
// "how are you" — it received a stretch of conversation from back when photos
// were the subject, and answered that.
//
// No prompt wording can fix a question that is not in the payload, which is why
// this is checked at the source: the mistake is in a database query, and a
// reviewer reading the prompt would never have found it.
describe("the model is shown the newest messages, not the oldest", () => {
  const lib = join(__dirname, "..");
  // Comments in this repo quote the bug they fixed, verbatim — including the
  // old query, two lines above the new one. A scanner that reads them finds the
  // defect in the note explaining why it is gone.
  const strip = (src: string) =>
    src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
  const chat = strip(readFileSync(join(lib, "chat.functions.ts"), "utf8"));

  it("fetches the message history newest-first and reverses it", () => {
    // The conversation-history read is the one with the row limit on it; the
    // other messages queries are inserts and single-row lookups.
    const at = chat.indexOf(".limit(HISTORY_ROW_CAP)");
    expect(at, "the history window query moved").toBeGreaterThan(-1);
    const query = chat.slice(Math.max(0, at - 400), at + 200);
    expect(query, "history is limited but ordered oldest-first").not.toMatch(
      /ascending:\s*true/,
    );
    expect(query, "the newest 30 means ordering descending").toMatch(/ascending:\s*false/);
    expect(chat, "newest-first rows must be reversed back to chronological").toMatch(
      /\.reverse\(\)/,
    );
  });

  // The same mistake anywhere else is the same bug. A row limit on an
  // ascending-ordered query almost always means "I wanted the latest N".
  it("has no other ascending-ordered query with a row limit", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = strip(readFileSync(full, "utf8"));
        // `.limit(1)` on an ascending query is a deliberate "first row", which
        // is a different and legitimate intent.
        const re = /ascending:\s*true\s*\}\s*\)[\s\S]{0,80}?\.limit\((\d+)\)/g;
        for (let m = re.exec(src); m; m = re.exec(src)) {
          if (m[1] !== "1") offenders.push(`${entry.name}: .limit(${m[1]})`);
        }
      }
    };
    walk(lib);
    expect(offenders, `oldest-N where newest-N was meant: ${offenders.join(", ")}`).toEqual([]);
  });
});

// Fixing the direction was only half of it. The window was also ten messages
// wide, against a model that holds 131,072 tokens — so even with the ordering
// right, the model saw a keyhole. The size is now a token budget computed from
// the model's real context window, and a fixed slice must not creep back.
describe("the window is sized by the model, not by a magic number", () => {
  const chat = readFileSync(join(__dirname, "..", "chat.functions.ts"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("no longer truncates history to a fixed number of messages", () => {
    expect(chat, "a fixed slice of history is back").not.toMatch(
      /history\s*\?\?\s*\[\]\s*\)\s*\.slice\(-\d+\)/,
    );
  });

  it("sizes the payload from the model's own context window", () => {
    expect(chat).toMatch(/modelContextTokens\(/);
    expect(chat).toMatch(/fitToBudget\(/);
  });
});
