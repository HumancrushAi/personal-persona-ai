// Language foundation. USA English is the default; the rest are wired for
// selection/storage now and can be fully translated later.
//
// What the preference DOES today: the companion replies in that language. The
// interface itself is still English. That is stated plainly next to the
// selector rather than implied away, because a control that looks like a
// translation switch and only changes chat replies reads as broken.

export type Language = { code: string; label: string; flag: string; native: string };

export const DEFAULT_LANGUAGE = "en";

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", label: "English (US)", flag: "🇺🇸", native: "English" },
  { code: "es", label: "Spanish", flag: "🇪🇸", native: "Español" },
  { code: "pt", label: "Portuguese", flag: "🇧🇷", native: "Português" },
  { code: "ja", label: "Japanese", flag: "🇯🇵", native: "日本語" },
  { code: "fr", label: "French", flag: "🇫🇷", native: "Français" },
  { code: "de", label: "German", flag: "🇩🇪", native: "Deutsch" },
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

// ── The visitor's choice ────────────────────────────────────────────────────
//
// Kept in localStorage rather than on the profile: a visitor picks a language
// before they have an account, and the profile has no column for it. The chat
// page reads it and sends it with every message, which is the one place it
// has an effect.

export const LANGUAGE_STORAGE_KEY = "hc_lang";

export function readPreferredLanguage(): string {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function storePreferredLanguage(code: string): string {
  const lang = normalizeLanguage(code);
  if (typeof window === "undefined") return lang;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* private mode: the choice lasts for the page, which is still something */
  }
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent("hc:language", { detail: lang }));
  return lang;
}

/** The instruction a companion gets, or nothing for English. */
export function replyLanguageInstruction(code: string | null | undefined): string {
  const lang = normalizeLanguage(code);
  if (lang === DEFAULT_LANGUAGE) return "";
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === lang)!;
  return `The user has chosen ${l.label}. Write EVERY reply in ${l.native} — natural, fluent, native-speaker ${l.label}, keeping exactly the same voice, warmth and explicitness. Never switch back to English unless the user does.`;
}
