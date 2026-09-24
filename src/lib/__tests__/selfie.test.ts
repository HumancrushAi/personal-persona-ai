import { describe, it, expect } from "vitest";
import {
  normalizeRequest,
  requestIsNude,
  requestedShot,
  selfiePrompt,
  wantsSelfie,
  wantsVideo,
} from "../selfie";

describe("wantsVideo", () => {
  it("detects video requests", () => {
    for (const t of [
      "send me a video",
      "can you make me a video of you dancing",
      "record a clip for me",
      "show me a video of you",
      "i wanna see a video",
      "take a video of yourself",
    ]) {
      expect(wantsVideo(t), t).toBe(true);
    }
  });

  it("does not trigger on normal chat or plain photo requests", () => {
    for (const t of ["i watched a video today", "send me a pic", "how was your day"]) {
      expect(wantsVideo(t), t).toBe(false);
    }
  });
});

describe("wantsSelfie", () => {
  it("detects explicit pic requests", () => {
    for (const t of [
      "show me your pussy",
      "send me a pic",
      "can I see your tits",
      "send a nude",
      "take a selfie for me",
      "lemme see your ass",
      "I wanna see you naked",
      "show mw your dick",
      "send dick",
      "give me cock",
    ]) {
      expect(wantsSelfie(t), t).toBe(true);
    }
  });

  it("does not trigger on normal chat", () => {
    for (const t of [
      "how was your day",
      "i love talking to you",
      "tell me about yourself",
      "what are you thinking about",
    ]) {
      expect(wantsSelfie(t), t).toBe(false);
    }
  });
});

describe("selfiePrompt", () => {
  const c = { name: "Amara", age: 23, ethnicity: "Latina", short_bio: "playful" };

  it("builds a female 1girl booru prompt that follows an explicit pussy request", () => {
    const p = selfiePrompt(c, "show me your pussy", "flirty");
    expect(p).toMatch(/1girl/);
    expect(p).toContain("show me your pussy");
    // request keyword maps to explicit pose tags so the picture matches it
    expect(p).toMatch(/spread pussy|presenting/i);
    expect(p).toContain("Latina");
    expect(p).not.toMatch(/1boy|\bpenis\b/i);
  });

  it("renders described sexual acts (toy, anal, masturbation) as pose tags + nudity", () => {
    const dildo = selfiePrompt(c, "show me a picture of you sticking a dildo in your ass", "");
    expect(dildo).toMatch(/naked|nude/i);
    expect(dildo).toMatch(/dildo/i);
    expect(dildo).toMatch(/anal/i);

    const play = selfiePrompt(c, "a pic of you playing with yourself", "");
    expect(play).toMatch(/naked|nude/i); // must not stay clothed
    expect(play).toMatch(/masturbation|fingering|pleasuring/i);

    const touch = selfiePrompt(c, "touch yourself for me", "");
    expect(touch).toMatch(/masturbation|fingering|pleasuring/i);
  });

  it("renders natural-language genital-touch requests as explicit acts + nudity", () => {
    // Phrasings that don't use the literal keywords "masturbate"/"pussy".
    for (const req of [
      "image of her hand in her genitals",
      "a pic of you touching yourself down there",
      "photo of her with her hand between her legs",
      "picture of you rubbing your crotch",
    ]) {
      const p = selfiePrompt(c, req, "");
      expect(p, req).toMatch(/naked|nude/i);
      expect(p, req).toMatch(/masturbation|fingering|pleasuring|spread pussy|presenting/i);
    }
  });

  it("covers a broad range of explicit vocabulary", () => {
    const cases: [string, RegExp][] = [
      ["send a pic sucking a cock", /oral|fellatio/i],
      ["photo of you with a vibrator", /sex toy|dildo/i],
      ["pic of you bent over", /bent over|rear view/i],
      ["image of you squirting", /orgasm|fluids|ahegao/i],
      ["a pic of your wet cunt", /pussy|spread pussy/i],
      ["show me you riding on top", /straddling|riding/i],
      ["send a pic of your tits out", /breasts|nipples/i],
      ["pic of you fingering your clit", /masturbation|fingering|pleasuring/i],
    ];
    for (const [req, expected] of cases) {
      const p = selfiePrompt(c, req, "");
      expect(p, req).toMatch(expected);
      expect(p, req).toMatch(/naked|nude/i);
    }
  });

  it("keeps lingerie clothed (sexy, not forced nude)", () => {
    const p = selfiePrompt(c, "pic of you in sexy lingerie", "");
    expect(p).toMatch(/lingerie/i);
    expect(p).toContain("clothed");
  });

  it("has a sensible default when no request is given", () => {
    const p = selfiePrompt(c, "", null);
    expect(p).toMatch(/1girl/);
    expect(p).toMatch(/seductive/i);
  });

  it("builds a male booru prompt that includes the user's request and backstory", () => {
    const maleC = {
      name: "Kaito",
      age: 25,
      ethnicity: "Japanese",
      gender: "male",
      short_bio: "athletic",
    };
    const p = selfiePrompt(maleC, "flexing his muscles", "gym rat");
    expect(p).toMatch(/1boy/);
    expect(p).toContain("flexing his muscles");
    expect(p).toContain("gym rat");
    expect(p).toContain("Japanese");
  });

  it("builds a booru 1boy prompt with genitalia for nude male companions", () => {
    const maleC = {
      name: "Kaito",
      age: 25,
      ethnicity: "Japanese",
      gender: "male",
      short_bio: "athletic",
    };
    const p = selfiePrompt(maleC, "send me a nude", "casual");
    expect(p).toMatch(/1boy/);
    expect(p).toMatch(/penis/i);
    expect(p).toMatch(/testicles/i);
    // Pony draws any anatomy tag it sees — the male prompt must never name female parts.
    expect(p).not.toMatch(/vagina|vulva/i);
  });

  it("builds a nude female booru prompt without male parts", () => {
    const p = selfiePrompt(c, "send me a nude", "flirty");
    expect(p).toMatch(/1girl/);
    expect(p).toMatch(/naked|nude/i);
    // The female prompt must never name male parts.
    expect(p).not.toMatch(/\bpenis\b|testicles|1boy/i);
  });

  it("does not force nudity on a clothed male request", () => {
    const maleC = {
      name: "Kaito",
      age: 25,
      ethnicity: "Japanese",
      gender: "male",
      short_bio: "athletic",
    };
    const p = selfiePrompt(maleC, "wearing a suit at dinner", "casual");
    expect(p).not.toMatch(/penis|testicles/i);
    expect(p).toMatch(/1boy/);
  });

  it("renders non-binary companions on the androgynous Pony prompt (not gender-locked)", () => {
    const nbC = { name: "Jordan", age: 22, ethnicity: "mixed", gender: "non-binary" };
    const p = selfiePrompt(nbC, "", "alternative");
    // Now uses the booru Pony pipeline so explicit requests are followed,
    // with an androgynous tag instead of the 1boy/1girl gender lock.
    expect(p).toMatch(/androgynous/i);
    expect(p).toMatch(/seductive/i);
    expect(p).toContain("alternative");
    expect(p).not.toMatch(/1girl|1boy/);
  });

  it("follows an explicit request for a non-binary companion", () => {
    const nbC = { name: "Jordan", age: 22, ethnicity: "mixed", gender: "non-binary" };
    const p = selfiePrompt(nbC, "touch yourself for me", "");
    expect(p).toMatch(/naked|nude/i);
    expect(p).toMatch(/masturbation|fingering|pleasuring/i);
  });
});

// Real phrasings from the chat that produced no picture at all: the ask was
// answered with text, so the user paid for a message and got nothing they
// wanted. The negatives matter just as much — a false positive silently spends
// 8 credits on what was meant to be conversation.
describe("media intent on real phrasings", () => {
  const photos = [
    "take a pic eating a taco with lingerie and legs spread",
    "can i get a photo of you",
    "show me what you're wearing",
    "pic please",
    "photo?",
    "gimme a pic babe",
    "let me see you in the shower",
    "can you take a picture eating a taco",
  ];
  const videos = ["record yourself twerking", "film yourself dancing"];
  const neither = [
    "i miss you",
    "see you tomorrow",
    "see you later babe",
    "show me how you feel",
    "i loved those pics you sent me earlier so much",
    "you look amazing in that picture",
    "tell me about your day",
  ];

  it("routes picture asks to the photo pipeline", () => {
    for (const t of photos) {
      expect(wantsVideo(t), t).toBe(false);
      expect(wantsSelfie(t), t).toBe(true);
    }
  });

  it("routes camera-verb asks to the video pipeline", () => {
    for (const t of videos) expect(wantsVideo(t), t).toBe(true);
  });

  it("leaves ordinary conversation alone", () => {
    for (const t of neither) {
      expect(wantsVideo(t), t).toBe(false);
      expect(wantsSelfie(t), t).toBe(false);
    }
  });
});

// "I said send me a nasty picture and it sent this" — a woman kneeling in the
// lingerie and shorts from her portrait. No word in the message named a body
// part or an act, so it was read as a clothed request and she held the pose.
describe("requestIsNude", () => {
  it("reads explicit tone as a nude request", () => {
    for (const t of [
      "send me a nasty picture",
      "send me something naughty",
      "dirty pic please",
      "a filthy photo of you",
      "send me a lewd selfie",
      "something explicit",
      "send nsfw",
      "get freaky for me",
      "send me a spicy pic",
    ]) {
      expect(`${t} -> ${requestIsNude(t)}`).toBe(`${t} -> true`);
    }
  });

  // Naming the garment is asking to see it. Forcing nudity would take away the
  // one thing they specified.
  it("keeps a named garment on even when the tone is explicit", () => {
    for (const t of [
      "send me a naughty pic in lingerie",
      "dirty pic in your thong",
      "something nasty in stockings",
    ]) {
      expect(`${t} -> ${requestIsNude(t)}`).toBe(`${t} -> false`);
    }
  });

  // "Sexy" is deliberately not explicit: a sexy picture in a dress is a real
  // clothed request and must stay one.
  it("does not treat an ordinary flattering request as explicit", () => {
    for (const t of ["send me a sexy pic in a red dress", "a cute selfie", "send me a pic"]) {
      expect(`${t} -> ${requestIsNude(t)}`).toBe(`${t} -> false`);
    }
  });

  it("still treats a named body part or act as nude, whatever else is said", () => {
    expect(requestIsNude("show me your tits in lingerie")).toBe(true);
    expect(requestIsNude("send me a naughty pic of your pussy")).toBe(true);
  });
});

describe("photo vocabulary", () => {
  it("reads portrait, headshot, backshot, pix and friends as a photo request", () => {
    for (const t of [
      "send me a face potrait",
      "send me a portrait",
      "headshot please",
      "send me a headshot",
      "send a backshot",
      "pix?",
      "send pix",
      "send me some pics",
      "can i get a snapshot of you",
      "send me a photograph of you",
      "send me a picture of you",
    ]) {
      expect(wantsSelfie(t), t).toBe(true);
    }
  });

  it("still leaves ordinary chat alone", () => {
    for (const t of [
      "i painted a portrait of my dog last year and it was hard",
      "send me your snap",
      "love those photos you sent earlier today babe",
    ]) {
      expect(wantsSelfie(t), t).toBe(false);
    }
  });

  it("frames a portrait on the face and a backshot from behind", () => {
    expect(requestedShot("send me a face potrait")).toBe("face");
    expect(requestedShot("headshot please")).toBe("face");
    expect(requestedShot("send me a pic of your pretty face")).toBe("face");
    expect(requestedShot("send a backshot")).toBe("back");
    expect(requestedShot("send me a nude portrait")).toBe(null);
    expect(requestedShot("send me a pic")).toBe(null);
  });

  it("strips the photo lead-in so the action reads cleanly", () => {
    expect(normalizeRequest("send me a face portrait of you smiling", "she")).toBe("smiling");
    expect(normalizeRequest("send pix of you in the kitchen", "she")).toBe("in the kitchen");
  });
});
