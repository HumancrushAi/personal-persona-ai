/**
 * A soft foreground placement area for a companion added to an uploaded room.
 * Pixels outside the mask stay in the room photograph through Comfy's
 * VAEEncodeForInpaint latent. The generous lower-centre region works for beds,
 * sofas and standing poses while leaving walls, furniture and room edges intact.
 */
export async function roomPlacementMask(width: number, height: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const rx = Math.round(width * 0.17);
  const ry = Math.round(height * 0.12);
  const rw = Math.round(width * 0.66);
  const rh = Math.round(height * 0.84);
  const radius = Math.round(Math.min(width, height) * 0.12);
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="black"/><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${radius}" fill="white"/></svg>`;
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}
