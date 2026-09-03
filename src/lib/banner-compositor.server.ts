// Composites a studio shot into a finished ad banner: photo, dark copy panel,
// headline, CTA pill and wordmark.
//
// The studio used to only CROP — saveCroppedFile in studio-sizes.ts draws the
// photo into a canvas at the target size and stops there. A 728x90 "banner" was
// therefore a 90px slice of a portrait with no words on it, which is not an ad
// unit, it's a photo. The layout engine that does the actual work already
// existed in scripts/generate-adult-banners.ts, but only as an offline script
// with three hardcoded headlines. This is that engine, parameterised by size and
// by copy the admin types, so the studio can call it per shot.
//
// Type is drawn as VECTOR PATHS, not as <text> for the renderer to resolve.
//
// SVG <text> is rendered by librsvg through fontconfig, which needs fonts
// installed on the machine. The deployed function has none — an ad unit whose
// copy silently disappears in production is worse than no ad unit at all. The
// obvious fix, bundling fonts and pointing FONTCONFIG_PATH at them, does not
// work either: fontconfig reads that variable when it initialises, so setting it
// from inside the process is too late and has no effect (measured, not assumed).
//
// So the glyphs are converted to paths here with opentype.js and the fonts ship
// in fonts/. Nothing resolves anything at render time, output is identical on
// every machine, and measurement becomes exact — an advance width from the font
// file rather than a render-and-trim round trip per line.

import sharp from "sharp";
// Namespace import with a default fallback: opentype.js ships a CJS bundle that
// exposes `parse` both on the namespace and on `default`, and the two module
// loaders in this repo disagree about which one a default import gets — vitest
// resolves it, vite-node hands back undefined. Taking whichever is present
// works under both.
import * as opentypeModule from "opentype.js";

const opentype: any = (opentypeModule as any).parse
  ? opentypeModule
  : ((opentypeModule as any).default ?? opentypeModule);
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateCropRect, type FocalPoint, type StudioSize } from "./studio-sizes";

const INK = "#08060c";
const PINK = "#ff3d8b";

// Fraunces is the site's display face, so banners match the page they advertise.
// Lato Bold carries the wordmark and the CTA — Inter is the site's UI sans, but
// its variable build has a GSUB lookup opentype.js cannot parse at all.
//
// Neither font's variation axes are touched, deliberately. Fraunces' default
// instance is already wght 900 and Lato-Bold.ttf is a static bold, so the
// weights are right as shipped, and opentype.js's variation support turned out
// to corrupt outlines: setting axes made its path serialiser emit NaN
// coordinates at many sizes, which librsvg then abandons mid-path — the visible
// symptom was a headline that stopped halfway through a word.
type Face = { font: any; kind: "serif" | "sans" };

let faces: { serif: Face; sans: Face } | null = null;

// The function bundle puts fonts/ beside the server entry, the same way
// vite.config.ts already places the ffmpeg binary in bin/. Locally that resolves
// to the repo directory.
function fontDir(): string {
  return join(process.cwd(), "fonts");
}

function loadFaces() {
  if (faces) return faces;
  const read = (file: string) => {
    const buf = readFileSync(join(fontDir(), file));
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };
  const serif = read("Fraunces.ttf");
  const sans = read("Lato-Bold.ttf");
  faces = { serif: { font: serif, kind: "serif" }, sans: { font: sans, kind: "sans" } };
  return faces;
}

export type BannerCopy = {
  /** One or two short lines. Two is the layout's maximum on every unit. */
  headline: string[];
  cta: string;
  wordmark?: boolean;
  /** Offer chip text. Omitted, the chip is not drawn at all. */
  chip?: string;
};

type FaceKind = "serif" | "sans";

// opentype.js's own Path.toPathData is not used.
//
// Its geometry is sound — several million coordinates across every size and
// string this renders were checked and all are finite — but its serialiser
// writes literal "NaN" into the `d` string at many sizes. librsvg stops drawing
// a path at the first unparseable number, silently, so a banner shipped with
// half a word on it and no error anywhere. Writing the numbers here is a few
// lines and removes that whole class of failure.
function pathData(path: { commands: any[] }): string {
  const n = (v: number) => {
    const r = Math.round(v * 100) / 100;
    return Number.isFinite(r) ? String(r) : "0";
  };
  const out: string[] = [];
  for (const c of path.commands) {
    switch (c.type) {
      case "M":
        out.push(`M${n(c.x)} ${n(c.y)}`);
        break;
      case "L":
        out.push(`L${n(c.x)} ${n(c.y)}`);
        break;
      case "C":
        out.push(`C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`);
        break;
      case "Q":
        out.push(`Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`);
        break;
      case "Z":
        out.push("Z");
        break;
    }
  }
  return out.join("");
}

// Width of the actual glyph outlines, which is what has to fit inside the unit.
//
// Deliberately not getAdvanceWidth: that reads hmtx, which a variable axis does
// not rewrite, so it disagrees with the shapes being drawn. The outline bounding
// box is measured from the same paths that get rendered, so what fits here fits
// on the banner.
function measure(text: string, kind: FaceKind, size: number, tracking = 0): number {
  if (!text) return 0;
  const font = loadFaces()[kind].font;
  let x1 = Infinity;
  let x2 = -Infinity;
  for (const path of font.getPaths(text, 0, 0, size)) {
    if (!path.commands.length) continue; // spaces carry no outline
    const bb = path.getBoundingBox();
    if (bb.x1 < x1) x1 = bb.x1;
    if (bb.x2 > x2) x2 = bb.x2;
  }
  const ink = Number.isFinite(x1) ? x2 - x1 : font.getAdvanceWidth(text, size);
  return tracking ? ink + tracking * Math.max(0, [...text].length - 1) : ink;
}

// Largest size at which the line still fits the space it has.
function fitSize(text: string, kind: FaceKind, maxSize: number, maxWidth: number): number {
  if (!text.trim()) return maxSize;
  const at100 = measure(text, kind, 100);
  if (!at100) return maxSize;
  return Math.max(8, Math.min(maxSize, Math.floor((100 * maxWidth) / at100)));
}

// One string as filled glyph outlines, sitting on the baseline at (x, y).
//
// With no tracking the whole string is converted in one call so the font's
// kerning pairs apply. Tracking is only used on the uppercase CTA, where the
// glyphs are placed one at a time and kerning is irrelevant.
function textPath(
  text: string,
  kind: FaceKind,
  size: number,
  x: number,
  y: number,
  fill: string,
  opts: {
    anchor?: "start" | "middle";
    tracking?: number;
    shadow?: boolean;
    opacity?: number;
  } = {},
): string {
  if (!text) return "";
  const font = loadFaces()[kind].font;
  const tracking = opts.tracking ?? 0;
  const width = measure(text, kind, size, tracking);
  const left = opts.anchor === "middle" ? x - width / 2 : x;

  let d: string;
  if (!tracking) {
    d = pathData(font.getPath(text, left, y, size));
  } else {
    let cx = left;
    const parts: string[] = [];
    for (const ch of text) {
      if (ch !== " ") parts.push(pathData(font.getPath(ch, cx, y, size)));
      cx += font.getAdvanceWidth(ch, size) + tracking;
    }
    d = parts.join(" ");
  }
  // On the full-bleed layouts the copy sits directly on the photograph, and a
  // white headline over a bright patch of skin is simply not there. The scrim
  // handles most of it; this is the backstop for whatever the scrim misses.
  const shadow = opts.shadow
    ? `<path d="${d}" fill="${INK}" opacity="0.55" transform="translate(${(size * 0.045).toFixed(2)} ${(size * 0.05).toFixed(2)})"/>`
    : "";
  const alpha = opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : "";
  return `${shadow}<path d="${d}" fill="${fill}"${alpha}/>`;
}

export type BannerStyle = "editorial" | "modern" | "bold";

// Three art directions, because creative rotation is how this vertical is run
// and because the first version only had one look — a two-tone pink serif
// headline over a gradient pill on a flat black slab, which reads as 2012
// dating spam rather than as a product worth paying for.
//
// What they share is the discipline: one message, one CTA, two typefaces at
// most, no more than three colours. What differs is register.
const STYLES: Record<
  BannerStyle,
  {
    head: FaceKind;
    upper: boolean;
    /** Extra letter-spacing on the headline, as a fraction of type size. */
    track: number;
    cta: "underline" | "ghost" | "solid";
    /** Headline size as a fraction of unit height, before fitting to width. */
    scale: number;
  }
> = {
  // Fragrance-ad register: a real serif at a restrained size, a tracked-out
  // kicker above it, and a text CTA with a rule under it instead of a button.
  editorial: { head: "serif", upper: false, track: 0, cta: "underline", scale: 0.145 },
  // Current app-marketing register: tracked uppercase sans, outlined pill.
  modern: { head: "sans", upper: true, track: 0.03, cta: "ghost", scale: 0.115 },
  // Direct-response register: the loudest of the three, solid white button.
  bold: { head: "sans", upper: true, track: 0.02, cta: "solid", scale: 0.125 },
};

// The wordmark is set as small tracked capitals rather than the old lockup.
//
// That lockup — a pink heart plus "HumanCrush" in white with ".com" in rose —
// competed with the headline for the same eye at the same weight, and two
// elements shouting inside a 300x250 is what made the unit feel cheap.
function kicker(x: number, y: number, size: number): string {
  return textPath("HUMANCRUSH.COM", "sans", size, x, y, "#fff", {
    tracking: size * 0.22,
    opacity: 0.72,
  });
}

// A hairline inside the unit's edge.
//
// An ad sits on somebody else's page, against a background nobody controls, and
// without an edge a dark creative bleeds into a dark site and stops looking like
// a placed object. It also does the thing a border always does: makes the unit
// read as designed rather than as a screenshot.
function keyline(w: number, h: number): string {
  return `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="1"/>`;
}

// A short accent rule above the headline. Cheap, and it gives the copy block a
// left edge to hang off so the type stops floating in the frame.
function accentRule(x: number, y: number, len: number, thickness: number): string {
  return `<rect x="${x}" y="${y.toFixed(2)}" width="${len.toFixed(2)}" height="${thickness.toFixed(2)}" rx="${(thickness / 2).toFixed(2)}" fill="${PINK}"/>`;
}

// A chevron after the CTA label. Direction is the cheapest way to make a button
// read as a button rather than as a box with a word in it.
function chevron(x: number, cy: number, size: number, color: string): string {
  const s = size * 0.5;
  return `<path d="M${x.toFixed(2)} ${(cy - s).toFixed(2)}L${(x + s * 0.75).toFixed(2)} ${cy.toFixed(2)}L${x.toFixed(2)} ${(cy + s).toFixed(2)}" fill="none" stroke="${color}" stroke-width="${Math.max(1, size * 0.16).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// A small offer chip. Only on units with the room for it — on a 320x50 it would
// be another thing fighting the button.
function offerChip(x: number, y: number, fs: number, label: string): string {
  const padX = fs * 0.8;
  const padY = fs * 0.55;
  const tw = measure(label, "sans", fs, fs * 0.1);
  const w = tw + padX * 2;
  const h = fs + padY * 2;
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(h / 2).toFixed(2)}" fill="${PINK}" fill-opacity="0.92"/>
    ${textPath(label, "sans", fs, x + w / 2, y + h / 2 + fs * 0.36, "#fff", { anchor: "middle", tracking: fs * 0.1 })}`;
}

// A CTA label has to fit its box: a nine-character label on a half-page unit
// ran out of both ends of the button when only the height was consulted.
function ctaFontSize(label: string, maxFs: number, innerWidth: number): number {
  const track = (f: number) => Math.max(0.5, f * 0.12);
  const natural = measure(label, "sans", maxFs, track(maxFs));
  if (natural <= innerWidth) return maxFs;
  return Math.max(7, Math.floor((maxFs * innerWidth) / natural));
}

/** Renders the CTA and reports the height it used, so copy can stack off it. */
function renderCta(
  style: BannerStyle,
  x: number,
  bottomY: number,
  maxW: number,
  unitH: number,
  label: string,
): { svg: string; height: number } {
  const text = label.toUpperCase();
  const kind = STYLES[style].cta;

  if (kind === "underline") {
    const fs = Math.max(8, Math.min(Math.round(unitH * 0.055), 15));
    const size = ctaFontSize(text, fs, maxW);
    const w = measure(text, "sans", size, size * 0.14);
    return {
      svg: `${textPath(text, "sans", size, x, bottomY, "#fff", { tracking: size * 0.14 })}
    <rect x="${x}" y="${(bottomY + size * 0.42).toFixed(2)}" width="${w.toFixed(2)}" height="${Math.max(1, size * 0.09).toFixed(2)}" fill="${PINK}"/>`,
      height: size * 1.6,
    };
  }

  const h = Math.max(18, Math.min(Math.round(unitH * 0.17), 46));
  const fs = ctaFontSize(text, Math.max(8, Math.round(h * 0.38)), maxW * 0.62);
  const ink = kind === "solid" ? INK : "#fff";
  // The chevron needs its own room, so the button is measured with it included
  // rather than having it drawn over the label's last letter.
  const gap = fs * 0.55;
  const chev = fs * 0.72;
  const textW = measure(text, "sans", fs, fs * 0.12);
  const w = Math.min(maxW, Math.round(textW + gap + chev + h * 1.3));
  const top = bottomY - h;
  const cy = top + h / 2;
  const textLeft = x + (w - (textW + gap + chev)) / 2;
  const label_ = textPath(text, "sans", fs, textLeft, cy + fs * 0.36, ink, {
    tracking: fs * 0.12,
  });
  const arrow = chevron(textLeft + textW + gap, cy, chev, ink);

  if (kind === "solid") {
    return {
      svg: `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${Math.round(h * 0.24)}" fill="#fff"/>${label_}${arrow}`,
      height: h,
    };
  }
  return {
    svg: `<rect x="${(x + 0.75).toFixed(2)}" y="${(top + 0.75).toFixed(2)}" width="${w - 1.5}" height="${h - 1.5}" rx="${((h - 1.5) / 2).toFixed(2)}" fill="none" stroke="#fff" stroke-opacity="0.9" stroke-width="1.5"/>${label_}${arrow}`,
    height: h,
  };
}

// The ramp is long and starts high up the unit on purpose. A short, steep scrim
// reads as a black band pasted across the bottom — which is half of what made
// the first version look cheap — but a scrim that is merely tasteful cannot
// carry white type over a bright photograph, and a headline nobody can read is
// worse than an ugly one. Long ramp, high start, dark base: legible without a
// visible edge. The legibility sweep over a pure white plate is what holds this
// honest; it caught exactly this being set too light.
const defs = () => `<defs>
  <linearGradient id="bottom" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="${INK}" stop-opacity="0.96"/>
    <stop offset="0.35" stop-color="${INK}" stop-opacity="0.88"/>
    <stop offset="0.7" stop-color="${INK}" stop-opacity="0.5"/>
    <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="topscrim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${INK}" stop-opacity="0.96"/>
    <stop offset="0.35" stop-color="${INK}" stop-opacity="0.88"/>
    <stop offset="0.7" stop-color="${INK}" stop-opacity="0.5"/>
    <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
  </linearGradient>
</defs>`;

export type BannerLayout = "stacked" | "side" | "strip";

// Which of the three layouts a unit gets.
//
// Portrait and square units are full-bleed photo with the copy over a bottom
// scrim. Wide units cannot do that — there is nowhere to put words on a 90px
// tall banner — so the subject sits right and the copy gets the left. Below
// 600px wide there is no room for two headline lines beside a button.
export function layoutFor(size: StudioSize): BannerLayout {
  const w = size.w ?? 1080;
  const h = size.h ?? 1080;
  // 1.5 rather than 2.2. The stacked layout lays a scrim across the bottom of
  // the frame to carry the copy, which on a landscape unit is exactly where the
  // subject's body is — so 1920x1080 and 1200x628 came back as portraits with
  // everything below the collarbone in shadow. Anything meaningfully wider than
  // square gets the side layout instead, where the copy has its own column and
  // the photograph is never covered.
  if (w / h < 1.5) return "stacked";
  return w >= 600 ? "side" : "strip";
}

// How much of a wide banner the subject occupies. The remainder is not a slab:
// composeBanner fills it with a blurred, darkened zoom of the same photograph,
// so the copy has ground to sit on and there is no vertical seam.
function photoWidthFor(layout: BannerLayout, w: number, h = 0) {
  if (layout === "stacked") return w;
  if (layout === "strip") return Math.round(w * (h && h < 70 ? 0.34 : 0.44));
  return Math.round(w * 0.56);
}

function overlaySvg(
  style: BannerStyle,
  layout: BannerLayout,
  w: number,
  h: number,
  copy: BannerCopy,
) {
  const cfg = STYLES[style];
  const pad = Math.round(Math.min(w, h) * (layout === "stacked" ? 0.07 : 0.075));
  const showMark = copy.wordmark !== false;
  const photoW = photoWidthFor(layout, w, h);

  // A 320x50 has room for a brand and a button and nothing else, which is what
  // a real mobile leaderboard carries.
  if (layout === "strip" && h < 70) {
    const ctaW = Math.round(w * 0.3);
    const ctaX = w - photoW - ctaW - pad;
    const cta = renderCta(style, ctaX, h * 0.5 + h * 0.17, ctaW, h, copy.cta);
    // The wordmark gets the room to the LEFT of the button and no more. Sized
    // by height alone it printed straight through the button on a 320x50.
    const room = Math.max(24, ctaX - pad * 2);
    let kickSize = Math.max(6, Math.round(h * 0.2));
    const natural = measure("HUMANCRUSH.COM", "sans", kickSize, kickSize * 0.22);
    if (natural > room) kickSize = Math.max(5, Math.floor((kickSize * room) / natural));
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${defs()}
    ${showMark ? kicker(pad, h / 2 + kickSize * 0.36, kickSize) : ""}
    ${cta.svg}
    ${keyline(w, h)}
  </svg>`;
  }

  const wide = layout !== "stacked";
  const boxW = wide ? w - photoW - pad * 1.4 : w - pad * 2;

  // A narrow wide unit gets one line; everything else keeps the writer's break.
  const lines = (layout === "strip" ? [copy.headline.filter(Boolean).join(" ")] : copy.headline)
    .filter(Boolean)
    .map((l) => (cfg.upper ? l.toUpperCase() : l));

  // Very tall units put the copy at the TOP.
  //
  // A square plate cropped to 9:16 keeps the whole square height, so the
  // subject's body lands in the bottom third — which is exactly where a
  // bottom-anchored copy block sits, and the result was a story format showing
  // a face and a scrim. Flipping the stack on these units leaves the lower
  // frame clear, which on explicit creative is the part that has to be visible.
  const tall = !wide && h / w >= 1.6;
  const ctaBottom = tall ? pad + h * 0.36 : h - pad;
  const cta = renderCta(style, pad, ctaBottom, boxW, h, copy.cta);

  // The kicker is sized off height, but it has to fit the copy column's WIDTH:
  // on a 300x600 half page, 4.5% of 600 is 27px and "HUMANCRUSH.COM" at 27px
  // ran off the side of a 300px unit.
  let kickSize = Math.max(7, Math.round(h * 0.045));
  const kickNatural = measure("HUMANCRUSH.COM", "sans", kickSize, kickSize * 0.22);
  if (kickNatural > boxW) kickSize = Math.max(6, Math.floor((kickSize * boxW) / kickNatural));
  const markH = showMark ? kickSize * 2.1 : 0;

  // The headline gets the band between the wordmark and the CTA and is sized to
  // fit it, so it can never be scaled into either.
  const bandH = Math.max(h * 0.2, h - pad * 2 - cta.height - markH);
  // A wide unit's headline sits beside the photo rather than under it, so the
  // full height of the copy column is available and the portrait cap is far too
  // conservative — at 14.5% of a 90px leaderboard the headline came out 13px and
  // sat in a sea of empty panel. The band still bounds it, so it cannot collide
  // with the kicker or the button.
  const scale = wide ? cfg.scale * 1.9 : cfg.scale;
  const hs = Math.min(
    ...lines.map((l) => fitSize(l, cfg.head, Math.round(h * scale), boxW)),
    Math.floor(bandH / (lines.length * 1.2)),
  );
  const blockH = (lines.length - 1) * hs * 1.2;
  const headBottom = ctaBottom - cta.height - Math.round(h * 0.035);
  const firstBaseline = headBottom - blockH;

  // The scrim covers the copy block and a ramp above it — not a fixed fraction
  // of the unit.
  //
  // It used to start at 18% of the height, which is fine on a 250px MREC and
  // absurd on a 1920px story: it laid a gradient over 82% of the frame and hid
  // everything below her collarbone. Anchoring it to where the type actually
  // starts means a tall unit shows the photograph and a short one still gets
  // the contrast it needs, with no per-size special casing.
  // Uses the rule's full allowance whether or not it ends up drawn — a scrim a
  // few pixels taller than it strictly needs is invisible, and reordering the
  // block just to know would gain nothing.
  const copyTop = firstBaseline - hs - markH - kickSize * 2;
  const scrimTop = Math.max(0, Math.min(Math.round(h * 0.18), Math.round(copyTop - h * 0.12)));
  const scrimH = Math.round(ctaBottom + h * 0.12);
  const scrim = wide
    ? ""
    : tall
      ? `<rect x="0" y="0" width="${w}" height="${scrimH}" fill="url(#topscrim)"/>`
      : `<rect x="0" y="${scrimTop}" width="${w}" height="${h - scrimTop}" fill="url(#bottom)"/>`;

  // The accent rule sits above the kicker and marks the top of the copy block.
  const kickBaseline = firstBaseline - hs - kickSize * 0.6;
  const ruleY = kickBaseline - kickSize * 1.9;
  const ruleLen = Math.min(boxW * 0.3, Math.max(18, hs * 0.9));
  const showRule = ruleY > pad * 0.5 && h >= 90;

  // The chip only appears where it has room to be a second hook rather than
  // clutter — never on a leaderboard, never over the copy column.
  const chipFs = Math.max(7, Math.round(Math.min(w, h) * 0.045));
  const showChip = Boolean(copy.chip) && !wide && w >= 250 && h >= 250;

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${defs()}
    ${scrim}
    ${showChip ? offerChip(pad, tall ? h - pad - chipFs * 2.1 : pad, chipFs, copy.chip as string) : ""}
    ${showRule ? accentRule(pad, ruleY, ruleLen, Math.max(2, hs * 0.07)) : ""}
    ${showMark ? kicker(pad, kickBaseline, kickSize) : ""}
    ${lines
      .map((line, i) =>
        textPath(line, cfg.head, hs, pad, firstBaseline + i * hs * 1.2, "#fff", {
          tracking: hs * cfg.track,
          shadow: !wide,
        }),
      )
      .join("\n    ")}
    ${cta.svg}
    ${keyline(w, h)}
  </svg>`;
}

/**
 * Render one finished banner.
 *
 * `imageUrl` is a studio shot; it is cropped to the photo region with the same
 * focal-point maths the download path uses, so what the crop preview shows is
 * what ends up under the copy.
 */
export async function composeBanner({
  imageUrl,
  image,
  size,
  copy,
  focalPoint = "face",
  style = "modern",
}: {
  /** Hosted or data: URL of the shot. Ignored when `image` is given. */
  imageUrl?: string;
  /** The shot's bytes, for callers that already hold them — a local script has
   *  no reason to base64 a megabyte of PNG just so this can fetch it back. */
  image?: Buffer;
  size: StudioSize;
  copy: BannerCopy;
  focalPoint?: FocalPoint;
  style?: BannerStyle;
}): Promise<Buffer> {
  const w = size.w;
  const h = size.h;
  if (!w || !h) throw new Error(`Size ${size.id} has no pixel dimensions to composite into`);

  let src: Buffer;
  if (image) {
    src = image;
  } else {
    if (!imageUrl) throw new Error("composeBanner needs either `image` or `imageUrl`");
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Could not fetch the shot (${res.status})`);
    src = Buffer.from(await res.arrayBuffer());
  }

  const meta = await sharp(src).metadata();
  const sWidth = meta.width ?? 0;
  const sHeight = meta.height ?? 0;
  if (!sWidth || !sHeight) throw new Error("Could not read the shot's dimensions");

  const layout = layoutFor(size);
  const photoW = photoWidthFor(layout, w, h);

  const { sx, sy, sWidthCrop, sHeightCrop } = calculateCropRect({
    sWidth,
    sHeight,
    tWidth: photoW,
    tHeight: h,
    focalPoint,
  });

  const photo = await gradePhoto(
    await sharp(src)
      .extract({
        left: Math.min(sx, sWidth - 1),
        top: Math.min(sy, sHeight - 1),
        width: Math.max(1, Math.min(sWidthCrop, sWidth - sx)),
        height: Math.max(1, Math.min(sHeightCrop, sHeight - sy)),
      })
      .resize(photoW, h, { fit: "cover", kernel: "lanczos3" })
      .toBuffer(),
    photoW,
    h,
  );

  // Wide units get a blurred, darkened zoom of the same photograph behind the
  // copy instead of a flat slab. A square plate cannot fill a 3.9:1 frame, and
  // the flat panel it used to sit on left a hard vertical seam down the middle
  // of the unit.
  const backdrop =
    layout === "stacked"
      ? null
      : await sharp(src)
          .resize(w, h, { fit: "cover", kernel: "lanczos3" })
          .blur(30)
          .modulate({ brightness: 0.42, saturation: 0.7 })
          .toBuffer();

  const svg = overlaySvg(style, layout, w, h, copy);

  // librsvg gives up on a path at the first number it cannot parse and reports
  // nothing, so a single bad coordinate ships as a banner with half a word on
  // it. Cheaper to refuse the render than to discover it in an ad account.
  if (svg.includes("NaN") || svg.includes("Infinity"))
    throw new Error(`Banner ${size.id}: generated overlay contains an invalid coordinate`);

  // The blend runs the backdrop into the subject's left edge over a wide
  // feather, so the two read as one photograph rather than as a photo pasted
  // onto a panel.
  const feather = Math.round(photoW * 0.5);
  const blend =
    layout === "stacked"
      ? []
      : [
          {
            input: Buffer.from(
              `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs>
                <linearGradient id="b" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stop-color="${INK}" stop-opacity="1"/>
                  <stop offset="${((w - photoW) / w).toFixed(3)}" stop-color="${INK}" stop-opacity="0.97"/>
                  <stop offset="${Math.min(1, (w - photoW + feather) / w).toFixed(3)}" stop-color="${INK}" stop-opacity="0"/>
                </linearGradient></defs>
              <rect width="${w}" height="${h}" fill="url(#b)"/></svg>`,
            ),
            left: 0,
            top: 0,
          },
        ];

  const canvas = backdrop
    ? sharp(backdrop)
    : sharp({ create: { width: w, height: h, channels: 3, background: INK } });

  return canvas
    .composite([
      { input: photo, left: w - photoW, top: 0 },
      ...blend,
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// What makes a generated still read as a photograph rather than a render:
// contrast and a touch of warmth, then unsharp to undo the softness a resize
// leaves, then film grain to break up the plastic smoothness, then a light
// vignette so the eye lands on the subject. All four are subtle on purpose —
// the first pass over-graded and buried her in shadow.
async function gradePhoto(buf: Buffer, w: number, h: number): Promise<Buffer> {
  const base = await sharp(buf)
    // Order matters. normalise stretches the frame to the full range first —
    // these stills come off the endpoint flat and dim, sitting in the middle of
    // the histogram. clahe then works LOCALLY, which is what actually separates
    // the subject from a dark background; a global curve just lifts everything
    // together and stays murky. gamma and saturation put warmth back into skin
    // afterwards, and the unsharp goes last so it sharpens the final contrast
    // rather than the flat original.
    .normalise({ lower: 1, upper: 99 })
    // The window has to fit inside the image or libvips refuses the operation
    // outright ("hist_local: window too large") — a 320x50's photo region is
    // only about 109x50, well under the 80px window the larger units want.
    .clahe({
      width: Math.max(3, Math.min(80, Math.floor(w / 2))),
      height: Math.max(3, Math.min(80, Math.floor(h / 2))),
      maxSlope: 2,
    })
    .gamma(1.08)
    .modulate({ saturation: 1.12, brightness: 1.04 })
    .sharpen({ sigma: 1.3, m1: 0.8, m2: 2.6 })
    .toBuffer();

  // The grain's strength is carried in its own alpha channel: sharp's composite
  // has no `opacity` option in this version, so a full-strength noise layer
  // would blow the image out.
  const grain = await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: "gaussian", mean: 128, sigma: 8 },
    },
  })
    .ensureAlpha(0.13)
    .png()
    .toBuffer();

  const vignette = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs>
      <radialGradient id="v" cx="50%" cy="45%" r="75%">
        <stop offset="58%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.26"/>
      </radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#v)"/></svg>`,
  );

  return sharp(base)
    .composite([
      { input: grain, blend: "overlay" },
      { input: vignette, blend: "over" },
    ])
    .toBuffer();
}
