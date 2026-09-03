import { describe, it, expect } from "vitest";
import { layoutFor, composeBanner } from "../banner-compositor.server";
import { getStudioSizeById, STUDIO_SIZES, CORE_AD_PACK } from "../studio-sizes";
import sharp from "sharp";

// Sources are generated in-process so the tests need no network and no fixture.
async function plate(
  w = 900,
  h = 1200,
  rgb: { r: number; g: number; b: number } = { r: 120, g: 60, b: 90 },
): Promise<string> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: rgb } })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const COPY = { headline: ["She'll send you", "anything."], cta: "Chat free" };

describe("banner layout selection", () => {
  it("puts portrait and square units on the full-bleed stacked layout", () => {
    expect(layoutFor(getStudioSizeById("300x250"))).toBe("stacked");
    expect(layoutFor(getStudioSizeById("336x280"))).toBe("stacked");
    expect(layoutFor(getStudioSizeById("300x600"))).toBe("stacked");
    expect(layoutFor(getStudioSizeById("9:16"))).toBe("stacked");
    expect(layoutFor(getStudioSizeById("1:1"))).toBe("stacked");
  });

  it("puts wide units at least 600px across on the two-line side panel", () => {
    expect(layoutFor(getStudioSizeById("728x90"))).toBe("side");
    expect(layoutFor(getStudioSizeById("970x250"))).toBe("side");
    expect(layoutFor(getStudioSizeById("970x90"))).toBe("side");
  });

  it("drops narrow wide units to the one-line strip", () => {
    expect(layoutFor(getStudioSizeById("305x99"))).toBe("strip");
    expect(layoutFor(getStudioSizeById("300x100"))).toBe("strip");
    expect(layoutFor(getStudioSizeById("468x60"))).toBe("strip");
    expect(layoutFor(getStudioSizeById("320x50"))).toBe("strip");
  });

  it("assigns a layout to every preset that has pixel dimensions", () => {
    for (const size of STUDIO_SIZES) {
      if (!size.w || !size.h) continue;
      expect(["stacked", "side", "strip"]).toContain(layoutFor(size));
    }
  });
});

describe("composeBanner", () => {
  it("renders every ad unit at exactly its declared pixel size", async () => {
    const url = await plate();
    for (const size of STUDIO_SIZES) {
      if (!size.w || !size.h) continue;
      const out = await composeBanner({ imageUrl: url, size, copy: COPY, focalPoint: "face" });
      const meta = await sharp(out).metadata();
      expect(`${size.id}:${meta.width}x${meta.height}`).toBe(`${size.id}:${size.w}x${size.h}`);
    }
  }, 120_000);

  // opentype.js's own path serialiser emits literal "NaN" coordinates at many
  // sizes. librsvg abandons a path at the first one without reporting anything,
  // so the failure shipped as a headline cut off mid-word. composeBanner refuses
  // to render an overlay containing one, and this is the sweep that would catch
  // a regression in the replacement serialiser.
  it("never produces an invalid coordinate, across units and copy lengths", async () => {
    const url = await plate();
    const copies = [
      COPY,
      { headline: ["Your AI girl.", "Your rules."], cta: "Start free" },
      { headline: ["She always", "texts back."], cta: "Try free" },
      { headline: ["W"], cta: "Go" },
      {
        headline: ["A much longer headline than fits", "and a second long line too"],
        cta: "Meet her now",
      },
    ];
    for (const id of CORE_AD_PACK.concat(["300x600", "160x600", "320x50", "468x60"])) {
      const size = getStudioSizeById(id);
      if (!size.w || !size.h) continue;
      for (const copy of copies) {
        await expect(
          composeBanner({ imageUrl: url, size, copy, focalPoint: "face" }),
        ).resolves.toBeInstanceOf(Buffer);
      }
    }
  }, 180_000);

  // A white headline drawn straight onto a bright photograph is invisible. The
  // scrims and the drop shadow are what stop that, so the check is made against
  // the worst case: a pure white source.
  it("keeps the copy legible over a white photo", async () => {
    const url = await plate(900, 1200, { r: 255, g: 255, b: 255 });
    for (const id of ["300x250", "970x250", "305x99"]) {
      const size = getStudioSizeById(id);
      const out = await composeBanner({ imageUrl: url, size, copy: COPY, focalPoint: "face" });
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

      let dark = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dark++;
      }
      const total = info.width * info.height;
      // A scrim dark enough to carry white type covers a real share of the unit.
      expect(`${id}: ${dark > total * 0.15}`).toBe(`${id}: true`);
    }
  }, 60_000);

  it("rejects a size with no fixed pixel dimensions", async () => {
    await expect(
      composeBanner({
        imageUrl: await plate(200, 200),
        size: { ...getStudioSizeById("300x250"), w: undefined, h: undefined },
        copy: { headline: ["a"], cta: "go" },
      }),
    ).rejects.toThrow(/no pixel dimensions/i);
  });
});
