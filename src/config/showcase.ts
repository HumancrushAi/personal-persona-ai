export type ShowcaseMedia = {
  type: "image" | "video";
  /** Filled from the live companion record at render time. */
  src?: string;
  poster?: string;
  alt: string;
  label: string;
};

/** Social-safe editorial prompts used to label live companion showcase media. */
export const showcaseConfig: readonly ShowcaseMedia[] = [
  { type: "image", alt: "Editorial portrait in warm window light", label: "Window light" },
  { type: "image", alt: "Relaxed portrait outside at golden hour", label: "Golden hour" },
  { type: "image", alt: "Fashion portrait in a modern room", label: "Studio portrait" },
  { type: "image", alt: "Candid portrait at a coffee shop", label: "Coffee run" },
  { type: "image", alt: "Poolside summer portrait", label: "Poolside" },
  { type: "image", alt: "City lights evening portrait", label: "City night" },
  { type: "image", alt: "Soft bedroom morning portrait", label: "Morning light" },
  { type: "image", alt: "Street style portrait", label: "Street style" },
  { type: "image", alt: "Clean fashion editorial portrait", label: "Editorial" },
  { type: "image", alt: "Natural portrait on a park bench", label: "Park bench" },
  { type: "image", alt: "Coastal portrait in summer light", label: "Coastal" },
  { type: "image", alt: "Evening portrait beside warm lamps", label: "Evening" },
] as const;

