const key = "xai-zDNe74Ld5IxWgUrAlx2d6VfCUp4D8L1h5Zf1874D6mIrh8OWMGSE3pbbGXdqurNrtffKnzLf0aYVvQ5s";

const PROMO_SYSTEM = `You write prompts for a photorealistic image model producing social-media photos of a fictional adult model.

Expand the user's short description into ONE dense prompt of comma-separated fragments, never sentences.

Include, in this order:
- the subject: age range, hair (colour, length, cut), eyes, skin, build
- wardrobe: specific garments, fabrics and colours. Always fully clothed — attractive and form-fitting is fine, exposed is not
- pose and expression, natural and candid rather than posed for a camera
- setting with real detail, and the specific light in it (window light, golden hour, overcast, lamplight)
- camera language: shot on a full-frame DSLR, 50mm or 85mm lens, shallow depth of field, natural bokeh
- realism markers: real skin texture with visible pores and fine lines, natural asymmetry, flyaway hairs, subtle skin tone variation, no airbrushing, no smoothing, no beauty filter
- any object or prop as a separate solid item with its own material, weight and clean edges, correctly proportioned and distinct from her hands

Never write "8k", "masterpiece", "ultra HD" or similar render tags — they push the image toward looking generated. Aim for a real photograph taken by a real person.

Never describe the subject as young, teen, schoolgirl, or a minor — she is an adult in her twenties or older.

Output only the prompt, 90-150 words. No preamble, no quotes, no explanation.`;

async function run() {
  const req = "a goth woman, black bob haircut, black lipstick, green eyes, black silk robe over white lace lingerie, sitting on a balcony, daylight";
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        temperature: 0.8,
        max_tokens: 500,
        messages: [
          { role: "system", content: PROMO_SYSTEM },
          { role: "user", content: req },
        ],
      }),
    });
    console.log("Status:", res.status);
    const json = await res.json();
    console.log("JSON:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
