// Studio Sizes & Dimension Presets for Promo Images, Social Media, and Ad Banners.
// Covers standard IAB ad units, high-converting adult/dating network formats,
// and mainstream social media aspect ratios.

export type FocalPoint = "face" | "center" | "bottom";

export type StudioSize = {
  id: string;
  name: string;
  category: "social" | "banner";
  dimensions: string;
  w?: number;
  h?: number;
  aspectClass: string;
  nativeRatio: "9:16" | "3:4" | "1:1" | "16:9" | "4:3" | "2:3";
  ratioLabel: string;
  description: string;
  badge?: string;
  isPopular?: boolean;
};

export const STUDIO_SIZES: StudioSize[] = [
  // --- Social & Mobile Formats ---
  {
    id: "9:16",
    name: "Story / Reels / TikTok",
    category: "social",
    dimensions: "1080 × 1920",
    w: 1080,
    h: 1920,
    aspectClass: "aspect-[9/16]",
    nativeRatio: "9:16",
    ratioLabel: "9:16",
    description: "Instagram Stories, Reels, TikTok, YouTube Shorts full vertical",
    badge: "Viral",
    isPopular: true,
  },
  {
    id: "3:4",
    name: "Portrait (Standard)",
    category: "social",
    dimensions: "1080 × 1440",
    w: 1080,
    h: 1440,
    aspectClass: "aspect-[3/4]",
    nativeRatio: "3:4",
    ratioLabel: "3:4",
    description: "Classic model portrait framing for companion cards & gallery",
    badge: "Default",
    isPopular: true,
  },
  {
    id: "4:5",
    name: "Instagram Feed",
    category: "social",
    dimensions: "1080 × 1350",
    w: 1080,
    h: 1350,
    aspectClass: "aspect-[4/5]",
    nativeRatio: "3:4",
    ratioLabel: "4:5",
    description: "Maximum vertical screen estate for Instagram feed posts",
    badge: "Feed",
    isPopular: true,
  },
  {
    id: "1:1",
    name: "Square Post / Avatar",
    category: "social",
    dimensions: "1080 × 1080",
    w: 1080,
    h: 1080,
    aspectClass: "aspect-square",
    nativeRatio: "1:1",
    ratioLabel: "1:1",
    description: "Universal square for feed posts, profile avatars, and thumbnails",
    badge: "Square",
    isPopular: true,
  },
  {
    id: "16:9",
    name: "Landscape / Cinematic",
    category: "social",
    dimensions: "1920 × 1080",
    w: 1920,
    h: 1080,
    aspectClass: "aspect-[16/9]",
    nativeRatio: "16:9",
    ratioLabel: "16:9",
    description: "Cinematic widescreen for web headers, YouTube, and X feeds",
    badge: "Wide",
    isPopular: true,
  },
  {
    id: "1200x628",
    name: "Social Link Share",
    category: "social",
    dimensions: "1200 × 628",
    w: 1200,
    h: 628,
    aspectClass: "aspect-[1200/628]",
    nativeRatio: "16:9",
    ratioLabel: "1.91:1",
    description: "Meta, Twitter/X cards, WhatsApp, and OpenGraph link previews",
    badge: "OG Share",
  },
  {
    id: "2:3",
    name: "Classic Photo / Pin",
    category: "social",
    dimensions: "1000 × 1500",
    w: 1000,
    h: 1500,
    aspectClass: "aspect-[2/3]",
    nativeRatio: "2:3",
    ratioLabel: "2:3",
    description: "35mm camera portrait & Pinterest full pin format",
    badge: "Poster",
  },

  // --- Display & Performance Ad Banners ---
  {
    id: "300x250",
    name: "Medium Rectangle (MREC)",
    category: "banner",
    dimensions: "300 × 250",
    w: 300,
    h: 250,
    aspectClass: "aspect-[6/5]",
    nativeRatio: "4:3",
    ratioLabel: "6:5",
    description: "#1 highest inventory ad format across Google Ads & ad networks",
    badge: "IAB Top",
    isPopular: true,
  },
  {
    id: "728x90",
    name: "Leaderboard",
    category: "banner",
    dimensions: "728 × 90",
    w: 728,
    h: 90,
    aspectClass: "aspect-[728/90]",
    nativeRatio: "16:9",
    ratioLabel: "8.1:1",
    description: "Standard top-of-page desktop banner across news & content sites",
    badge: "IAB Standard",
    isPopular: true,
  },
  {
    id: "970x250",
    name: "Billboard / Masthead",
    category: "banner",
    dimensions: "970 × 250",
    w: 970,
    h: 250,
    aspectClass: "aspect-[97/25]",
    nativeRatio: "16:9",
    ratioLabel: "3.88:1",
    description: "Premium high-impact header unit (also compatible with 950×250)",
    badge: "Premium",
    isPopular: true,
  },
  {
    id: "300x600",
    name: "Half Page / Filmstrip",
    category: "banner",
    dimensions: "300 × 600",
    w: 300,
    h: 600,
    aspectClass: "aspect-[1/2]",
    nativeRatio: "9:16",
    ratioLabel: "1:2",
    description: "Massive high-visibility sidebar ad with top conversion rate",
    badge: "High CTR",
    isPopular: true,
  },
  {
    id: "160x600",
    name: "Wide Skyscraper",
    category: "banner",
    dimensions: "160 × 600",
    w: 160,
    h: 600,
    aspectClass: "aspect-[4/15]",
    nativeRatio: "9:16",
    ratioLabel: "1:3.75",
    description: "Standard vertical sidebar ad for blogs and publisher sites",
    badge: "Sidebar",
  },
  {
    id: "320x480",
    name: "Mobile Interstitial",
    category: "banner",
    dimensions: "320 × 480",
    w: 320,
    h: 480,
    aspectClass: "aspect-[2/3]",
    nativeRatio: "2:3",
    ratioLabel: "2:3",
    description: "Full-screen mobile interstitial and transition takeover unit",
    badge: "Mobile",
  },
  {
    id: "305x99",
    name: "Small Landscape (TJ / Exo)",
    category: "banner",
    dimensions: "305 × 99",
    w: 305,
    h: 99,
    aspectClass: "aspect-[305/99]",
    nativeRatio: "16:9",
    ratioLabel: "3.08:1",
    description: "Top performing ad unit on TrafficJunky, ExoClick & dating networks",
    badge: "Funnels",
    isPopular: true,
  },
  {
    id: "300x100",
    name: "3:1 Promo Banner",
    category: "banner",
    dimensions: "300 × 100",
    w: 300,
    h: 100,
    aspectClass: "aspect-[3/1]",
    nativeRatio: "16:9",
    ratioLabel: "3:1",
    description: "Compact promo tile, checkout tease, and funnel card header",
    badge: "Promo",
  },
  {
    id: "468x60",
    name: "Standard Banner",
    category: "banner",
    dimensions: "468 × 60",
    w: 468,
    h: 60,
    aspectClass: "aspect-[39/5]",
    nativeRatio: "16:9",
    ratioLabel: "7.8:1",
    description: "Classic affiliate, directory, and forum content header",
    badge: "Banner",
  },
  {
    id: "970x90",
    name: "Large Leaderboard",
    category: "banner",
    dimensions: "970 × 90",
    w: 970,
    h: 90,
    aspectClass: "aspect-[97/9]",
    nativeRatio: "16:9",
    ratioLabel: "10.8:1",
    description: "Super-wide expanding pushdown banner",
    badge: "Wide",
  },
  {
    id: "320x50",
    name: "Mobile Leaderboard",
    category: "banner",
    dimensions: "320 × 50",
    w: 320,
    h: 50,
    aspectClass: "aspect-[32/5]",
    nativeRatio: "16:9",
    ratioLabel: "6.4:1",
    description: "Sticky mobile bottom banner with high ad viewability",
    badge: "Mobile",
  },
  {
    id: "336x280",
    name: "Large Rectangle",
    category: "banner",
    dimensions: "336 × 280",
    w: 336,
    h: 280,
    aspectClass: "aspect-[6/5]",
    nativeRatio: "4:3",
    ratioLabel: "6:5",
    description: "Higher-impact variant of the Medium Rectangle",
    badge: "IAB",
  },
];

export const DEFAULT_STUDIO_SIZE_ID = "3:4";

export function getStudioSizeById(id: string): StudioSize {
  return STUDIO_SIZES.find((s) => s.id === id) || STUDIO_SIZES[1]; // default 3:4
}

// Popular core ad pack for 1-click batch export
export const CORE_AD_PACK: string[] = [
  "300x250",
  "970x250",
  "728x90",
  "9:16",
  "1:1",
  "305x99",
];

// Calculation of source crop coordinates with focal point bias
export function calculateCropRect({
  sWidth,
  sHeight,
  tWidth,
  tHeight,
  focalPoint = "face",
}: {
  sWidth: number;
  sHeight: number;
  tWidth: number;
  tHeight: number;
  focalPoint?: FocalPoint;
}) {
  const targetRatio = tWidth / tHeight;
  const sRatio = sWidth / sHeight;

  let sx = 0;
  let sy = 0;
  let sWidthCrop = sWidth;
  let sHeightCrop = sHeight;

  if (sRatio > targetRatio) {
    // Source is wider than target: trim left/right
    sWidthCrop = sHeight * targetRatio;
    sx = (sWidth - sWidthCrop) / 2;
  } else {
    // Source is taller than target: trim top/bottom
    sHeightCrop = sWidth / targetRatio;
    const diff = sHeight - sHeightCrop;

    if (focalPoint === "face") {
      // Face / upper body bias (usually located in top 10-30% of portrait)
      sy = Math.max(0, diff * 0.15);
    } else if (focalPoint === "bottom") {
      sy = Math.max(0, diff * 0.85);
    } else {
      // Center
      sy = Math.max(0, diff * 0.5);
    }
  }

  return {
    sx: Math.round(sx),
    sy: Math.round(sy),
    sWidthCrop: Math.round(sWidthCrop),
    sHeightCrop: Math.round(sHeightCrop),
  };
}

// Client-side high quality image crop and file saver
export async function saveCroppedFile({
  url,
  filename,
  targetWidth,
  targetHeight,
  focalPoint = "face",
}: {
  url: string;
  filename: string;
  targetWidth?: number;
  targetHeight?: number;
  focalPoint?: FocalPoint;
}): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not fetch image");

  let blob: Blob;

  if (targetWidth && targetHeight) {
    const rawBlob = await res.blob();
    const rawUrl = URL.createObjectURL(rawBlob);
    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image for cropping"));
      img.src = rawUrl;
    });

    URL.revokeObjectURL(rawUrl);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const { sx, sy, sWidthCrop, sHeightCrop } = calculateCropRect({
      sWidth: img.naturalWidth || img.width,
      sHeight: img.naturalHeight || img.height,
      tWidth: targetWidth,
      tHeight: targetHeight,
      focalPoint,
    });

    ctx.drawImage(img, sx, sy, sWidthCrop, sHeightCrop, 0, 0, targetWidth, targetHeight);

    const canvasBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95),
    );
    if (!canvasBlob) throw new Error("Canvas export failed");
    blob = canvasBlob;
  } else {
    blob = await res.blob();
  }

  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
