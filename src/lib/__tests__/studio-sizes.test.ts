import { describe, it, expect } from "vitest";
import {
  STUDIO_SIZES,
  getStudioSizeById,
  calculateCropRect,
  CORE_AD_PACK,
} from "../studio-sizes";

describe("studio-sizes", () => {
  it("defines comprehensive sizes for both social and banner categories", () => {
    expect(STUDIO_SIZES.length).toBeGreaterThanOrEqual(15);
    const social = STUDIO_SIZES.filter((s) => s.category === "social");
    const banner = STUDIO_SIZES.filter((s) => s.category === "banner");

    expect(social.length).toBeGreaterThanOrEqual(5);
    expect(banner.length).toBeGreaterThanOrEqual(8);

    // Verify key formats exist
    expect(STUDIO_SIZES.some((s) => s.id === "9:16")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "3:4")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "1:1")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "16:9")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "300x250")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "970x250")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "728x90")).toBe(true);
    expect(STUDIO_SIZES.some((s) => s.id === "305x99")).toBe(true);
  });

  it("retrieves size by ID with fallback", () => {
    const size916 = getStudioSizeById("9:16");
    expect(size916.id).toBe("9:16");
    expect(size916.w).toBe(1080);
    expect(size916.h).toBe(1920);

    const fallback = getStudioSizeById("non-existent-id");
    expect(fallback.id).toBe("3:4");
  });

  it("calculates crop rectangle with face focal bias for wide banners", () => {
    // 3:4 portrait source (e.g. 1024 x 1365) to 970 x 250 billboard
    const rectFace = calculateCropRect({
      sWidth: 1000,
      sHeight: 1333,
      tWidth: 970,
      tHeight: 250,
      focalPoint: "face",
    });

    // Target ratio is 970/250 = 3.88. Source ratio is 1000/1333 = 0.75.
    // Source is taller than target -> height is cropped down.
    expect(rectFace.sWidthCrop).toBe(1000);
    expect(rectFace.sHeightCrop).toBe(Math.round(1000 / 3.88));
    // Face focal point has sy biased towards top (< center)
    const rectCenter = calculateCropRect({
      sWidth: 1000,
      sHeight: 1333,
      tWidth: 970,
      tHeight: 250,
      focalPoint: "center",
    });
    expect(rectFace.sy).toBeLessThan(rectCenter.sy);
    expect(rectFace.sy).toBeGreaterThanOrEqual(0);
  });

  it("calculates crop rectangle for tall story format from wide source", () => {
    // 16:9 widescreen source (1920 x 1080) to 9:16 vertical story (1080 x 1920)
    const rect = calculateCropRect({
      sWidth: 1920,
      sHeight: 1080,
      tWidth: 1080,
      tHeight: 1920,
      focalPoint: "center",
    });

    expect(rect.sHeightCrop).toBe(1080);
    expect(rect.sWidthCrop).toBe(Math.round(1080 * (1080 / 1920)));
    expect(rect.sx).toBeGreaterThan(0);
    expect(rect.sy).toBe(0);
  });

  it("contains all core ad pack sizes in STUDIO_SIZES", () => {
    for (const id of CORE_AD_PACK) {
      expect(STUDIO_SIZES.some((s) => s.id === id)).toBe(true);
    }
  });
});
