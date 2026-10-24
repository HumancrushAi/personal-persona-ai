// Map companion image filenames to their bundled URLs.
const modules = import.meta.glob("../assets/companions/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const map: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const file = path.split("/").pop()!;
  map[file] = url;
}

export function companionImage(filename: string): string {
  if (!filename) return "";
  if (filename.startsWith("data:") || filename.startsWith("http") || filename.startsWith("/")) {
    return filename;
  }
  return map[filename] ?? "";
}

/**
 * A resized copy of a Supabase Storage image, via the image render endpoint
 * (a 290 KB portrait PNG becomes ~40 KB at card size). Anything that is not a
 * public Storage URL comes back untouched.
 */
export function resizedImage(url: string, width: number, quality = 70): string {
  if (!url || !url.includes("/storage/v1/object/public/")) return url;
  const resized = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  return `${resized}${resized.includes("?") ? "&" : "?"}width=${width}&quality=${quality}`;
}
