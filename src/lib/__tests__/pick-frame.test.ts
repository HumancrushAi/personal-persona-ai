import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { pickSharpest, enhanceStill, trimBackdrop } from "../media-finalize.server";

// A photo in this app is one frame cut out of a generated clip, and the frame
// used to be chosen by the clock. Objects smear and re-form across the last
// second, so the picture the user paid for was whichever of those it landed on.
async function detailedFrame(): Promise<Buffer> {
  // Hard edges: a grid of black squares on white gives a large Laplacian spread.
  const size = 160;
  const squares = Array.from({ length: 8 }, (_, i) =>
    Array.from(
      { length: 8 },
      (_, j) =>
        `<rect x="${i * 20}" y="${j * 20}" width="10" height="10" fill="${
          (i + j) % 2 ? "#000" : "#fff"
        }"/>`,
    ).join(""),
  ).join("");
  return sharp(Buffer.from(`<svg width="${size}" height="${size}">${squares}</svg>`))
    .png()
    .toBuffer();
}

describe("pickSharpest", () => {
  it("keeps the crisp frame over the smeared one", async () => {
    const crisp = await detailedFrame();
    const smeared = await sharp(crisp).blur(6).png().toBuffer();

    const picked = await pickSharpest([smeared, crisp]);
    expect(picked?.equals(crisp)).toBe(true);
  });

  it("is not fooled by the order they arrive in", async () => {
    const crisp = await detailedFrame();
    const smeared = await sharp(crisp).blur(6).png().toBuffer();

    const picked = await pickSharpest([crisp, smeared]);
    expect(picked?.equals(crisp)).toBe(true);
  });

  it("picks the least blurred of several", async () => {
    const crisp = await detailedFrame();
    const candidates = await Promise.all([
      sharp(crisp).blur(10).png().toBuffer(),
      sharp(crisp).blur(4).png().toBuffer(),
      sharp(crisp).blur(1.5).png().toBuffer(),
    ]);
    const picked = await pickSharpest(candidates);
    expect(picked?.equals(candidates[2])).toBe(true);
  });

  it("returns nothing when no frames were extracted", async () => {
    expect(await pickSharpest([])).toBe(null);
  });
});

// A chat photo is delivered at 640x640, which is a small picture on a phone that
// draws it at three device pixels per CSS pixel. Most of the softness people
// read as "AI-looking" is the browser upscaling it, badly.
describe("enhanceStill", () => {
  const square = (side: number) =>
    sharp({
      create: { width: side, height: side, channels: 3, background: "#7a5c48" },
    })
      .png()
      .toBuffer();

  it("brings a 640 render up to something worth looking at", async () => {
    const out = await enhanceStill(await square(640));
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(1280);
    expect(out.ext).toBe("jpg");
    expect(out.mime).toBe("image/jpeg");
  });

  it("leaves a render that is already big alone", async () => {
    const out = await enhanceStill(await square(1536));
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(1536);
  });

  it("never enlarges past 2x, where it would be inventing pixels", async () => {
    const out = await enhanceStill(await square(400));
    const meta = await sharp(out.buf).metadata();
    expect(meta.width).toBe(800);
  });

  // The picture reaching the user matters more than the picture being crisp.
  it("hands back the original when it cannot read the image", async () => {
    const junk = Buffer.from("not an image at all");
    const out = await enhanceStill(junk);
    expect(out.buf).toBe(junk);
    expect(out.ext).toBe("png");
  });
});

// "It's only a partial pic": the clip held its start frame, so the photo was the
// padded composite — a narrow strip of her top-centre in a blurry square.
describe("trimBackdrop", () => {
  const noise = (width: number, height: number) =>
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: "#806050",
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();

  // The same construction as squareStartFrame, step for step, then brought down
  // to the 640 square the endpoint renders. Built here rather than imported
  // because the real one uploads to storage.
  async function startFrameComposite(portraitW: number, portraitH: number): Promise<Buffer> {
    const SIDE = 768;
    const portrait = await noise(portraitW, portraitH);
    const wash = await sharp(portrait).resize(12, 12, { fit: "cover" }).toBuffer();
    const backdrop = await sharp(wash)
      .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
      .blur(40)
      .modulate({ brightness: 0.75 })
      .toBuffer();
    const inner = Math.round(SIDE * 0.62);
    const subject = await sharp(portrait)
      .resize(inner, inner, { fit: "inside", withoutEnlargement: false })
      .toBuffer();
    const squared = await sharp(backdrop)
      .composite([{ input: subject, gravity: "north" }])
      .png()
      .toBuffer();
    return sharp(squared).resize(640, 640).png().toBuffer();
  }

  // A 9:16 portrait fits the 476px box as 268x476 at 768, which is 223x397 in
  // the 640 output — the strip in the reported screenshot, which filled 35% of
  // the width and 62% of the height.
  const SUBJECT_W = 223;
  const SUBJECT_H = 397;

  it("cuts a held start frame down to her", async () => {
    const out = await trimBackdrop(await startFrameComposite(540, 960));
    const { width = 0, height = 0 } = await sharp(out).metadata();
    // Within a few percent: the trim comes in slightly past the edge on purpose.
    expect(width).toBeGreaterThan(SUBJECT_W * 0.85);
    expect(width).toBeLessThanOrEqual(SUBJECT_W);
    expect(height).toBeGreaterThan(SUBJECT_H * 0.94);
    expect(height).toBeLessThanOrEqual(SUBJECT_H);
  });

  // Real frames come out of an H.264 clip, not a clean PNG. Compression noise in
  // the wash must not read as detail and stop the trim at the edge.
  it("still finds the padding through compression artefacts", async () => {
    const lossy = await sharp(await startFrameComposite(540, 960)).jpeg({ quality: 55 }).toBuffer();
    const out = await trimBackdrop(lossy);
    const { width = 0 } = await sharp(out).metadata();
    expect(width).toBeLessThan(640 * 0.5);
  });

  it("leaves a frame the model filled edge to edge exactly as it was", async () => {
    const full = await noise(640, 640);
    expect(await trimBackdrop(full)).toBe(full);
  });

  // A real photograph with a soft background on one side is not padding. The
  // composite always pads both sides; this only pads one.
  it("leaves a frame flat on only one side alone", async () => {
    const plain = await sharp({
      create: { width: 640, height: 640, channels: 3, background: "#403028" },
    })
      .png()
      .toBuffer();
    const oneSided = await sharp(plain)
      .composite([{ input: await noise(400, 640), gravity: "east" }])
      .png()
      .toBuffer();
    expect(await trimBackdrop(oneSided)).toBe(oneSided);
  });

  // Wherever the clip generated into the padding, that band has detail. Here
  // the bottom has been filled, so only the sides may go.
  it("keeps a band the model generated into", async () => {
    const composite = await startFrameComposite(540, 960);
    const legs = await noise(223, 243);
    const filled = await sharp(composite)
      .composite([{ input: legs, top: 397, left: 208 }])
      .png()
      .toBuffer();
    const { height = 0 } = await sharp(await trimBackdrop(filled)).metadata();
    expect(height).toBe(640);
  });

  it("leaves a blank frame alone rather than cropping it to nothing", async () => {
    const blank = await sharp({
      create: { width: 640, height: 640, channels: 3, background: "#222" },
    })
      .png()
      .toBuffer();
    expect(await trimBackdrop(blank)).toBe(blank);
  });

  it("hands back the original when it cannot read the image", async () => {
    const junk = Buffer.from("not an image at all");
    expect(await trimBackdrop(junk)).toBe(junk);
  });
});
