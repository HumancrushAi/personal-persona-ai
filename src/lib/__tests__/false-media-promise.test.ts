import { describe, it, expect } from "vitest";
import { withoutFalseMediaPromise as strip } from "../chat.functions";

// "i asked for age, see what it gave me" — and what it gave was
// "mmm okay… give me a sec, taking one just for you 📸", with no photo coming.
//
// The app writes that teaser itself whenever a real render is queued, and it
// goes into the messages table as ordinary assistant text. Ten of them come
// back as history on the next turn and the model copies the pattern, because a
// pattern repeated ten times beats a sentence in a system prompt.
//
// Reaching the model at all means no media was queued — wantsSelfie and
// wantsVideo are checked long before it and return early — so a promise in the
// reply is false by construction and never reaches the user.
describe("a reply that promises a photo with none coming", () => {
  it("keeps the answer and drops the promise", () => {
    expect(strip("i'm 23 babe 😊 mmm okay, taking one just for you 📸")).toBe("i'm 23 babe 😊");
  });

  // She texts without full stops, so splitting on punctuation alone treated the
  // whole line as one sentence and threw the answer away with the promise.
  it("splits on an emoji, not only on a full stop", () => {
    expect(strip("i'm from Kyoto 💕 hold on, recording something just for you 🎬")).toBe(
      "i'm from Kyoto 💕",
    );
  });

  it("reports failure when the reply was nothing but the promise", () => {
    for (const only of [
      "mmm okay… give me a sec, taking one just for you 📸",
      "mmm okay... taking a pic just for you 📸",
      "mmm okay… hold on, recording something just for you 🎬",
      "ok, snapping one for you 📸",
    ]) {
      // "" is the signal to ask the model again. It used to substitute a
      // canned line here, which then entered the transcript as an assistant
      // turn — and an assistant turn in the transcript is the most-copied
      // thing in this system.
      expect(strip(only)).toBe("");
    }
  });

  // "mmm okay…" left on its own is not an answer to anything.
  it("does not leave filler behind as the whole reply", () => {
    expect(strip("mmm okay... taking a pic just for you 📸")).not.toBe("mmm okay...");
  });

  it("leaves an ordinary reply completely alone", () => {
    for (const ok of [
      "i'm 23 babe 😊 what about you?",
      "i'm from Kyoto, born and raised 💕 what about you?",
      "mmm i love horror films and bad karaoke 😏 how naughty are YOU?",
      "tell me what you're imagining and let me picture it 😉",
    ]) {
      expect(strip(ok)).toBe(ok);
    }
  });

  it("handles an empty reply without throwing", () => {
    expect(strip("")).toBe("");
  });
});

// Anything put in an assistant turn is something she will say back. That is the
// lesson of this code and it has been learned three times:
//
//   1. "[sent a selfie]" — she typed it instead of letting the app send a pic.
//   2. "(the app delivered a real photo...)" — an annotation meant to fix (1),
//      which she copied too, because an annotation in an assistant turn is
//      still words in her mouth.
//   3. "(the app was already delivering media to the user at this point)" —
//      added to fix the teaser imitation, and promptly returned as her answer
//      to "how old are you?". That one shipped.
//
// So the shape is blocked on the way out, whatever the wording, whichever
// future edit reintroduces one.
describe("stage directions never reach the user", () => {
  it("blocks every form that has actually shipped", () => {
    for (const bad of [
      "(the app was already delivering media to the user at this point)",
      "(the app delivered a real photo to the user at this point)",
      "(the app delivered a real voice note to the user at this point)",
      "[sent a selfie]",
      "[sent a pic]",
      "*sends you a photo*",
      "*sends a video* 🎬",
    ]) {
      const out = strip(bad);
      expect(out, bad).not.toBe(bad);
      expect(out).not.toMatch(/the app|sent a|sends/i);
    }
  });

  it("leaves ordinary speech alone, including asterisks mid-sentence", () => {
    for (const ok of [
      "i'm 23 babe 😊 what about you?",
      "i'm good, just got out of the shower 😏 how are you?",
      "mmm i *love* that question 😏",
      "i'm from Kyoto 💕",
    ]) {
      expect(strip(ok)).toBe(ok);
    }
  });
});

// "It can't even understand basic communication."
//
// She sends a photo, the user says "send another one", and nothing happens —
// wantsSelfie needs a word like pic or selfie in the message and that has none.
// The request queued no render and fell through to the chat model, which is
// where it copied a teaser and promised a photo that never came. One missing
// branch produced both complaints.
describe("a follow-up request for more of the same", () => {
  it("recognises the ways people actually ask", async () => {
    const { isFollowUpMediaRequest: f } = await import("../selfie");
    for (const yes of [
      "send another one",
      "another one",
      "another",
      "send me another",
      "one more",
      "1 more",
      "more",
      "again",
      "can you send another one",
      "please send another",
      "ok another one",
    ]) {
      expect(f(yes), yes).toBe(true);
    }
  });

  // It only means anything when the last thing she sent was media, and the
  // caller checks that — but it still must not swallow ordinary conversation.
  it("leaves ordinary conversation alone", async () => {
    const { isFollowUpMediaRequest: f } = await import("../selfie");
    for (const no of [
      "how old are you",
      "how are you",
      "where are you from my love",
      "what are your hobbies",
      "tell me more about your day at the beach with your sister",
      "i want another coffee",
      "",
    ]) {
      expect(f(no), no).toBe(false);
    }
  });
});

// The denial half of the same bug, reported live: "how are you" came back as
// "Sorry love, but I can't send photos or videos here", and "how old are you"
// as "aww i wish i could send you pics and vids, baby, but i can't do that
// here". The user's question had nothing to do with pictures. The prompt was
// carrying 250 words about how media delivery works, and she relayed them.
//
// The prompt no longer says any of it. This is the belt, because every earlier
// version of that rule was also "removed from the prompt" and the line kept
// coming back.
describe("a reply cannot claim she is unable to send media", () => {
  it("strips the denials that shipped to users", async () => {
    const { withoutFalseMediaPromise: strip } = await import("../chat.functions");
    for (const denial of [
      "Sorry love, but I can't send photos or videos here.",
      "aww i wish i could send you pics and vids, baby, but i can't do that here.",
      "i can't send images.",
      "I'm not able to send pictures, sorry.",
      "there's no way for me to send a selfie here.",
      "i cannot show you a photo.",
    ]) {
      expect(strip(denial), denial).not.toMatch(/can'?t|cannot|not able|no way|wish i could/i);
    }
  });

  // The whole point of the sentence-level strip: the answer survives, only the
  // apology about pictures goes.
  it("keeps the part that answered the question", async () => {
    const { withoutFalseMediaPromise: strip } = await import("../chat.functions");
    const kept = strip("i'm 23 babe 😊 but i can't send you photos here.");
    expect(kept).toContain("23");
    expect(kept).not.toMatch(/can'?t/i);
  });

  it("leaves ordinary speech alone", async () => {
    const { withoutFalseMediaPromise: strip } = await import("../chat.functions");
    for (const fine of [
      "i'm good babe, how are you?",
      "i'm 23 😊 what about you",
      "i can't believe you sent me that, you're bad 😏",
      "i can't stop thinking about you",
      "come closer, i want to show you something",
    ]) {
      expect(strip(fine), fine).toBe(fine);
    }
  });
});

// Round two. The first version of DENIES_MEDIA covered "can't" and missed
// everything else, so production shipped:
//
//   user: "how are you"
//   her:  "I'm sorry, but I don't send or receive pictures or videos. ..."
//
// "don't" was not in the alternation. Neither was "never", nor the idea of
// RECEIVING one — which the prompt itself had introduced, in the clause telling
// her to decline if the user offers to send her a picture. That clause is gone
// and the guard now covers the phrasings it was missing.
describe("every phrasing of a media denial, not just can't", () => {
  const load = () => import("../chat.functions");

  it("strips the denial that shipped, and its near neighbours", async () => {
    const { withoutFalseMediaPromise: strip } = await load();
    for (const denial of [
      "I'm sorry, but I don't send or receive pictures or videos.",
      "I don't send pictures.",
      "i never send nudes here",
      "I'm not able to share images.",
      "i don't do videos.",
      "photos aren't something i can do.",
      "i never show pics.",
    ]) {
      expect(strip(denial), denial).not.toMatch(
        /don'?t|doesn'?t|never|can'?t|cannot|not able|aren'?t something/i,
      );
    }
  });

  // A qualifier turns a denial into flirting. "i don't send nudes to just
  // anyone" names a condition, which leads somewhere; "i don't send nudes"
  // tells the user this is not a thing that happens here, which is false and
  // costs a sale. Only the blanket form is stripped.
  it("leaves a conditional refusal intact — that is her, not the system", async () => {
    const { withoutFalseMediaPromise: strip } = await load();
    for (const flirt of [
      "i don't send nudes to just anyone 😏",
      "not yet baby, i don't show pics that fast",
      "i don't send pics for free, make me want it",
    ]) {
      expect(strip(flirt), flirt).toBe(flirt);
    }
  });
});

// Round three, and this one was mine end to end.
//
//   user: how old are you   ->  No.
//   user: how are you       ->  No.
//   user: how old are you   ->  No.
//   user: what's yr name    ->  I'm Jade 😊
//
// The short phrases failed and the longer ones worked, which looked like the
// model not understanding English. It wasn't. The model answered "how are you"
// with a media denial that opened with "No."; the sentence filter removed the
// denial and shipped the orphaned "No.", because "no" was not in the filler
// list. Then every one of those "No." replies went into the transcript, and
// once the full conversation started reaching the model it read fifty turns of
// "how are you" -> "No." and reproduced the pattern exactly. That is why it
// looked phrase-specific and why deleting the instruction did not stop it.
describe("a refusal fragment is not a reply", () => {
  it("recognises the residue the sentence filter leaves behind", async () => {
    const { isDegenerateReply: bad } = await import("../chat.functions");
    for (const fragment of ["No.", "no", "  No!  ", "Sorry.", "nope", "*no*", ""]) {
      expect(bad(fragment), JSON.stringify(fragment)).toBe(true);
    }
  });

  it("does not mistake a real reply for one", async () => {
    const { isDegenerateReply: bad } = await import("../chat.functions");
    for (const real of [
      "i'm 23 babe 😊",
      "No way, you're too sweet 😊",
      "i'm good, how are you?",
      "sorry babe, i got distracted looking at you",
      "I'm Jade 😊",
    ]) {
      expect(bad(real), real).toBe(false);
    }
  });

  // The stripper must report failure rather than invent a line. A canned line
  // becomes an assistant turn in the transcript, and an assistant turn in the
  // transcript is the single most-copied thing in this whole system.
  it("returns nothing when only media talk was there, so the caller can retry", async () => {
    const { withoutFalseMediaPromise: strip } = await import("../chat.functions");
    expect(strip("No. I don't send pictures here.")).toBe("");
    expect(strip("I can't send photos. I don't share images.")).toBe("");
    expect(strip("[sent a selfie]")).toBe("");
  });
});
