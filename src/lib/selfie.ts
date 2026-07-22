// Builds the image prompt for a companion selfie. Shared by the camera button
// (media.functions) and the auto-selfie when a user asks for a pic in chat.
export function selfiePrompt(
  c: { name: string; age: number; ethnicity: string; short_bio?: string | null },
  userPrompt?: string | null,
  styleBackstory?: string | null,
): string {
  const req = (userPrompt ?? "").trim();
  return [
    `Photorealistic amateur selfie photo of ${c.name}, a ${c.age}-year-old ${c.ethnicity} woman who clearly looks exactly ${c.age}.`,
    `Soft warm lighting, intimate bedroom or apartment, shot on an iPhone, natural skin texture, highly detailed, realistic, not illustrated.`,
    styleBackstory ? `Her look/vibe: ${styleBackstory}.` : "",
    req
      ? `She is doing EXACTLY this — this is the MAIN subject of the photo, follow it precisely: ${req}.`
      : "She smiles seductively at the camera, sexy and inviting.",
    `Frame and pose to match the request (full body, close-up, or explicit as asked). Sexy and provocative; explicit nudity is allowed when the request calls for it.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// True when the user's message is asking her to send a picture/selfie/nude.
export function wantsSelfie(t: string): boolean {
  const s = t.toLowerCase();
  if (/\b(selfie|nudes?|send me a pic|send a pic|send pic|show me your)\b/.test(s)) return true;
  return /(send|show|snap|take|lemme see|let me see|can i see|wanna see|i wanna see|i want to see|i want a)\b[^.]{0,30}\b(pic|picture|photo|image|body|tits|boobs|breasts|pussy|ass|butt|naked|nude|you)\b/.test(
    s,
  );
}
