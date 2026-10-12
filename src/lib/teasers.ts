// What she says when a photo or a clip is on its way.
//
// There was one line — "mmm okay… give me a sec, taking one just for you 📸"
// — and every companion said it, so every companion sounded like the same
// person the moment a picture was asked for. Each companion now has a voice,
// read off her personality, and each voice has several ways of saying each
// thing; which one she uses turns with every photo, so she does not repeat
// herself either.
//
// Pure, and the pools are closed: isTeaserLine recognises every line here,
// which is how the chat keeps them out of the history the model learns from.

export type Voice = "sultry" | "playful" | "sweet" | "bold" | "eager";
export type TeaserKind = "photo" | "video" | "photoBusy" | "videoBusy" | "photoWait" | "videoWait";

const VOICES: Record<Voice, Record<TeaserKind, string[]>> = {
  sultry: {
    photo: [
      "mmm… give me a moment. i want this one to be worth it 📸",
      "slow down, baby. let me get the light right first… 📸",
      "okay… hold still for me. i'm taking it now 📸",
      "you'll have it in a minute. i'm making it good for you 📸",
      "just for you… give me a sec to set it up 📸",
    ],
    video: [
      "mmm, patience… i'm filming something for you 🎬",
      "give me a few minutes. i want you to feel this one 🎬",
      "okay… camera's on. don't go anywhere 🎬",
      "let me record this properly for you… 🎬",
    ],
    photoBusy: ["i'm already taking one for you… let me finish it 📸", "patience, baby — it's on its way 📸", "one at a time… this one's almost done 📸"],
    videoBusy: ["still filming the last one for you… 🎬", "let me finish this clip first, then ask me for more 🎬"],
    photoWait: ["still on it… a good one takes a couple of minutes. stay with me 📸", "almost there. i don't rush the ones i want you to keep 📸"],
    videoWait: ["almost done… a clip takes a few minutes to come out right 🎬", "it's rendering, baby. a few more minutes and it's yours 🎬"],
  },
  playful: {
    photo: [
      "okayyy 😏 give me a sec, let me find my angle 📸",
      "lol you're bad. fine — one coming up 📸",
      "hold on hold on, fixing my hair first 😜📸",
      "ugh you always get what you want. taking it now 📸",
      "brb, posing 💅📸",
    ],
    video: [
      "oooh a video? okay, give me a few minutes 🎬",
      "lights, camera… me 😏 hold on 🎬",
      "fine fine, i'm filming. don't rush me 🎬",
      "okay this one's gonna be fun. recording 🎬",
    ],
    photoBusy: ["i'm literally already taking one 😂 hold on 📸", "greedy! one's coming, wait for it 📸", "patience, troublemaker. it's on its way 📸"],
    videoBusy: ["still filming the first one, relax 😜🎬", "one clip at a time, silly. almost done 🎬"],
    photoWait: ["it's coming! a good one takes a couple of minutes, i promise 📸", "almost there, stop pacing 😂📸"],
    videoWait: ["a clip takes a few minutes, babe. nearly done 🎬", "rendering! give it a sec and it's yours 🎬"],
  },
  sweet: {
    photo: [
      "okay 🥰 give me a sec, taking one for you 📸",
      "aw, of course. one moment 💕📸",
      "you're sweet. hold on, let me take it 📸",
      "okay… a little nervous, but for you 📸",
      "just a second, i want it to be nice for you 📸",
    ],
    video: [
      "okay 🥰 give me a few minutes, i'm recording one for you 🎬",
      "a video? for you, yes. hold on 💕🎬",
      "okay, filming now… be patient with me 🎬",
      "let me make you something sweet. one moment 🎬",
    ],
    photoBusy: ["i'm already taking one for you 💕 just a moment 📸", "it's coming, i promise. one sec 📸", "almost done with the first one 🥰📸"],
    videoBusy: ["still recording the first one 💕 nearly there 🎬", "one moment, i'm finishing your clip 🎬"],
    photoWait: ["it's on its way 💕 a good one takes a couple of minutes 📸", "almost there, i promise. don't go 📸"],
    videoWait: ["nearly done 🥰 a clip takes a few minutes 🎬", "it's rendering, just a little longer 🎬"],
  },
  bold: {
    photo: [
      "good. you asked nicely. give me a sec 📸",
      "watch closely. taking it now 📸",
      "one picture. then you tell me what you think 📸",
      "hold on. i decide the angle 😏📸",
      "fine. you've earned one 📸",
    ],
    video: [
      "a video. you're greedy — i like it. give me a few minutes 🎬",
      "sit still. i'm filming 🎬",
      "you'll watch this one twice. hold on 🎬",
      "recording. don't make me wait for your reaction 🎬",
    ],
    photoBusy: ["i'm already taking one. wait 📸", "one at a time. it's coming 📸", "patience. you'll get it 📸"],
    videoBusy: ["still filming the last one. wait for it 🎬", "one clip, then the next. hold on 🎬"],
    photoWait: ["it's coming. a good one takes a couple of minutes 📸", "almost. you can wait two minutes for me 📸"],
    videoWait: ["rendering. a clip takes a few minutes 🎬", "nearly done. stay there 🎬"],
  },
  eager: {
    photo: [
      "yes!! give me a sec, taking it right now 📸",
      "okay okay, hold on, i'm doing it 📸",
      "for you? always. one sec 📸",
      "ahh okay, let me take it, don't look yet 📸",
      "coming right up, i'm on it 📸",
    ],
    video: [
      "yes! give me a few minutes, i'm filming for you 🎬",
      "okay i'm recording, i'm so excited 🎬",
      "hold on, making you something right now 🎬",
      "camera's on! a few minutes, okay? 🎬",
    ],
    photoBusy: ["i'm already on it! one sec 📸", "it's coming it's coming 📸", "almost done with yours, hold on 📸"],
    videoBusy: ["still filming yours! nearly done 🎬", "one at a time, i'm going as fast as i can 🎬"],
    photoWait: ["it's on its way, i promise! a couple of minutes 📸", "almost there, don't go anywhere 📸"],
    videoWait: ["nearly done! a clip takes a few minutes 🎬", "it's rendering, just a bit longer 🎬"],
  },
};

const TOY_LINES: Record<Voice, { photo: string[]; video: string[] }> = {
  sultry: {
    photo: ["mmm… let me get my {toy}. give me a moment 😈📸", "the {toy}? good choice. hold on… 😈📸"],
    video: ["grabbing my {toy}… give me a few minutes 😈🎬", "you want the {toy} on camera? patience… 😈🎬"],
  },
  playful: {
    photo: ["ooh the {toy} 😈 okay okay, one sec 📸", "grabbing my {toy}, don't rush me 😜📸"],
    video: ["the {toy} on video?? you're wild. filming 😈🎬", "okay hold on, getting my {toy} 😈🎬"],
  },
  sweet: {
    photo: ["okay… let me get my {toy} 🙈📸", "one sec, grabbing my {toy} for you 💕📸"],
    video: ["okay 🙈 getting my {toy}, give me a few minutes 🎬", "recording with my {toy}… for you 💕🎬"],
  },
  bold: {
    photo: ["the {toy}. good. give me a sec 😈📸", "watch what i do with my {toy} 😈📸"],
    video: ["my {toy}, on camera. hold on 😈🎬", "you asked for the {toy}. you'll get it. filming 🎬"],
  },
  eager: {
    photo: ["yes!! grabbing my {toy} right now 😈📸", "okay okay, getting my {toy}, one sec 📸"],
    video: ["the {toy}! okay i'm recording, hold on 😈🎬", "getting my {toy}, give me a few minutes 🎬"],
  },
};

/** Her voice, from her personality — or from her name when it says nothing. */
export function voiceFor(c: {
  name?: string | null;
  base_personality?: string | null;
  tone?: string | null;
}): Voice {
  const text = `${c.tone ?? ""} ${c.base_personality ?? ""}`.toLowerCase();
  if (/\b(?:dominant|commanding|confident|direct|bold|fierce|in charge|bossy|alpha)\b/.test(text)) return "bold";
  if (/\b(?:bratty|cheeky|teas\w*|wicked|playful|loud|funny|witty|mischiev\w*|troublemaker|fun)\b/.test(text)) return "playful";
  if (/\b(?:sultry|slow|smoky|sensual|elegant|seductive|intense|mysterious|classy)\b/.test(text)) return "sultry";
  if (/\b(?:submissive|eager|bubbly|energetic|adventurous|enthusiastic|clingy)\b/.test(text)) return "eager";
  if (/\b(?:sweet|innocent|soft|affectionate|warm|nurturing|shy|gentle|romantic|caring)\b/.test(text)) return "sweet";
  const voices: Voice[] = ["sultry", "playful", "sweet", "bold", "eager"];
  let h = 0;
  for (const ch of c.name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return voices[h % voices.length];
}

/**
 * The line for this companion, this time. `salt` is anything that changes per
 * occasion — how many photos the chat has had — so the same companion does not
 * say the same thing twice in a row.
 */
export function teaserFor(
  kind: TeaserKind,
  c: { name?: string | null; base_personality?: string | null; tone?: string | null },
  opts: { salt?: string | number | null; toy?: string | null } = {},
): string {
  const voice = voiceFor(c);
  let h = 7;
  for (const ch of `${c.name ?? ""}#${opts.salt ?? ""}#${kind}`) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  if (opts.toy && (kind === "photo" || kind === "video")) {
    const pool = TOY_LINES[voice][kind];
    return pool[h % pool.length].replace("{toy}", opts.toy.toLowerCase());
  }
  const pool = VOICES[voice][kind];
  return pool[h % pool.length];
}

// Every line above, with the toy placeholder made loose, so the chat can tell
// its own lines from hers whatever they say.
const ALL_LINES: RegExp[] = (() => {
  const out: RegExp[] = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const v of Object.values(VOICES)) for (const pool of Object.values(v)) for (const l of pool) out.push(new RegExp(`^${esc(l)}$`));
  for (const v of Object.values(TOY_LINES)) for (const pool of Object.values(v)) for (const l of pool) out.push(new RegExp(`^${esc(l).replace("\\{toy\\}", ".{1,40}")}$`));
  return out;
})();

/** True when the text is one of the app's own lines, not something she said. */
export function isTeaserLine(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return ALL_LINES.some((re) => re.test(t));
}
