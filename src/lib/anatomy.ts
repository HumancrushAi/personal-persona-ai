// What body a companion actually has, resolved in ONE place.

export type GenderKind = "female" | "male" | "trans-female" | "trans-male" | "nb";

export type Anatomy = {
  kind: GenderKind;
  noun: string;
  subject: "she" | "he" | "they";
  object: "her" | "him" | "them";
  poss: "her" | "his" | "their";
  refl: "herself" | "himself" | "themselves";
  is: "is" | "are";
  s: "s" | "";
  hasBreasts: boolean;
  hasPenis: boolean;
  hasVulva: boolean;
};

const TABLE: Record<GenderKind, Omit<Anatomy, "kind">> = {
  female: {
    noun: "woman",
    subject: "she",
    object: "her",
    poss: "her",
    refl: "herself",
    is: "is",
    s: "s",
    hasBreasts: true,
    hasPenis: false,
    hasVulva: true,
  },
  male: {
    noun: "man",
    subject: "he",
    object: "him",
    poss: "his",
    refl: "himself",
    is: "is",
    s: "s",
    hasBreasts: false,
    hasPenis: true,
    hasVulva: false,
  },
  "trans-female": {
    noun: "transgender woman",
    subject: "she",
    object: "her",
    poss: "her",
    refl: "herself",
    is: "is",
    s: "s",
    hasBreasts: true,
    hasPenis: true,
    hasVulva: false,
  },
  "trans-male": {
    noun: "transgender man",
    subject: "he",
    object: "him",
    poss: "his",
    refl: "himself",
    is: "is",
    s: "s",
    hasBreasts: false,
    hasPenis: false,
    hasVulva: true,
  },
  nb: {
    noun: "androgynous person",
    subject: "they",
    object: "them",
    poss: "their",
    refl: "themselves",
    is: "are",
    s: "",
    hasBreasts: false,
    hasPenis: false,
    hasVulva: false,
  },
};

export function genderKind(gender?: string | null): GenderKind {
  const g = (gender ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!g) return "female";
  if (
    g === "trans-female" ||
    g === "transfemale" ||
    g === "transwoman" ||
    g === "trans-woman" ||
    g === "futa" ||
    g === "futanari" ||
    g === "shemale" ||
    g === "ladyboy" ||
    g === "dickgirl"
  )
    return "trans-female";
  if (g === "trans-male" || g === "transmale" || g === "transman" || g === "trans-man")
    return "trans-male";
  if (g === "male" || g === "man") return "male";
  if (g === "non-binary" || g === "nonbinary" || g === "nb" || g === "enby") return "nb";
  return "female";
}

export function anatomyOf(gender?: string | null): Anatomy {
  const kind = genderKind(gender);
  return { kind, ...TABLE[kind] };
}

/**
 * Strictly positive anatomy descriptions.
 * These are appended after the refiner finishes so they always land whole.
 * Never use negation words (no, without, zero, free of, etc.).
 */
const NUDE_ANATOMY: Record<GenderKind, string> = {
  female:
    "exact same body proportions and breast size as the reference image, natural firm high-set breasts matching her frame, projected forward and holding a tight round shape, taut smooth skin, nipples level with the middle of the upper arms pointing straight forward, small smooth defined areolae and naturally erect nipples with clean realistic texture, smoothly shaved plump closed pussy as a soft rounded mound with a single neat vertical crease, everything fully closed and tucked so only the clean crease shows, firm high perfectly round ass with smooth even skin texture matching the reference",

  male:
    "exact same body proportions as the reference image, lean athletic muscular chest and defined abs, thick erect penis standing out from the body and angled slightly upward about as long as the hand from wrist to fingertip, clearly defined shaft with soft realistic veining, distinct coronal ridge meeting the smooth rounded glans, natural firm testicles in a separate lightly textured scrotum",

  "trans-female":
    "exact same body proportions as the reference image, natural firm high-set breasts matching her frame, projected forward and holding a tight round shape, defined areolae and naturally erect nipples with clean realistic texture, feminine hips and waist, thick erect penis standing out and angled slightly upward about as long as the hand from wrist to fingertip, defined shaft with soft veining, distinct ridge below the smooth rounded glans, natural testicles in a separate sac, firm high perfectly round ass matching the reference",

  "trans-male":
    "exact same body proportions as the reference image, flat masculine chest with flat dark nipples and faint pale scars beneath each pectoral, broad ribcage and lean stomach, smoothly shaved plump closed pussy as a soft rounded mound with a single neat vertical crease, firm high perfectly round ass matching the reference",

  nb: "exact same body proportions as the reference image, lean androgynous body, flat soft chest, narrow hips, smooth groin, firm high perfectly round ass matching the reference",
};

export function nudeAnatomy(gender?: string | null): string {
  return NUDE_ANATOMY[genderKind(gender)];
}

const CROSS_SEX_NEGATIVE: Record<GenderKind, string> = {
  female:
    "penis, cock, erect cock, testicles, scrotum, male genitalia, bulge, male chest, muscular male torso, male arms, hairy legs, beard, mustache, male body, male pelvis, masculine groin, masculine thighs",
  male: "vulva, vagina, labia, female genitalia, breasts, cleavage, feminine bust, feminine hips",
  "trans-female":
    "vulva, vagina, labia, female genitalia, beard, mustache, stubble, male chest, muscular male torso, masculine jaw, male body",
  "trans-male":
    "penis, cock, erect cock, testicles, scrotum, bulge, breasts, cleavage, feminine bust",
  nb: "",
};

export function crossSexNegative(gender?: string | null): string {
  return CROSS_SEX_NEGATIVE[genderKind(gender)];
}

const PART_TERMS = {
  penis: String.raw`dicks?|cocks?|penis|penises|balls|testicles?|ballsack|scrotum|shafts?|boners?|hard[- ]?ons?|erections?|schlongs?|dongs?|manhood|pricks?|willy|pecker|phallus|bulge|cum ?shot|jerk\w* off|jack\w* off`,
  vulva: String.raw`pussy|pussies|vagina|vaginas|vulvas?|clit|clitoris|labia|cunts?|snatch|coochie|cooch|camel ?toe|muff|beaver|front hole`,
  breasts: String.raw`tits|titties|boobs|boobies|breasts?|nipples?|areolas?|cleavage|rack|knockers|jugs|hooters|funbags|ta-tas`,
  ass: String.raw`ass|asses|arse|asshole|arsehole|butthole|butt|buttocks|booty|bum|derriere|anus|rear end|backside`,
} as const;

export type BodyPart = keyof typeof PART_TERMS;

const OWNED = String.raw`\b(?:your|ur|yours)\b[^.?!]{0,28}?`;
const ASKED = String.raw`\b(?:send|show|snap|take|post|share|gimme|give|see|seeing|want|wanna)\b[^.?!]{0,28}?`;

function asksFor(prompt: string, part: BodyPart): boolean {
  const terms = PART_TERMS[part];
  const owned = new RegExp(`${OWNED}\\b(?:${terms})\\b`, "i");
  const asked = new RegExp(`${ASKED}\\b(?:${terms})\\b`, "i");
  return owned.test(prompt) || asked.test(prompt);
}

export function mentionsPart(prompt: string, part: BodyPart): boolean {
  return new RegExp(`\\b(?:${PART_TERMS[part]})\\b`, "i").test(prompt ?? "");
}

export function requestedParts(prompt: string): BodyPart[] {
  const p = prompt ?? "";
  return (Object.keys(PART_TERMS) as BodyPart[]).filter((part) => asksFor(p, part));
}

const REFUSALS: Record<GenderKind, string> = {
  female: "No silly, I'm a girl! 😅 I can only send pics of my own body.",
  male: "Ha, wrong body babe 😅 I'm a guy — I can only send pics of what I've actually got.",
  "trans-female":
    "Mmm not quite babe 😏 I'm a trans girl — you get my tits AND my cock, but that's what I've got for you.",
  "trans-male":
    "Cheeky 😏 I'm a trans guy — flat chest, and what's between my legs is all mine. Ask me for that instead.",
  nb: "",
};

export function refuseWrongAnatomy(
  gender: string | null | undefined,
  prompt: string,
): string | null {
  const a = anatomyOf(gender);
  if (a.kind === "nb") return null;

  const has: Record<BodyPart, boolean> = {
    penis: a.hasPenis,
    vulva: a.hasVulva,
    breasts: a.hasBreasts,
    ass: true,
  };
  const missing = requestedParts(prompt ?? "").filter((part) => !has[part]);
  return missing.length ? REFUSALS[a.kind] || null : null;
}
