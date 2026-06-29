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
  return map[filename] ?? "";
}
