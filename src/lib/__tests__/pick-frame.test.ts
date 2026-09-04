import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { pickSharpest, enhanceStill } from "../media-finalize.server";

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
