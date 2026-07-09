// Language foundation. USA English is the default; the rest are wired for
// selection/storage now and can be fully translated later.

export type Language = { code: string; label: string };

export const DEFAULT_LANGUAGE = "en";

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", label: "English (US)" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
];

export function isSupportedLanguage(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function languageLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function normalizeLanguage(code: string | null | undefined): string {
  return code && isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
}
