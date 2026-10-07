// Language foundation. USA English is default; site-wide translation via Google Translate + AI replies.

export type Language = { code: string; label: string; flag: string; native: string; short: string };

export const DEFAULT_LANGUAGE = "en";

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", label: "English (US)", flag: "🇺🇸", native: "English", short: "EN" },
  { code: "es", label: "Spanish", flag: "🇪🇸", native: "Español", short: "ES" },
  { code: "pt", label: "Portuguese", flag: "🇧🇷", native: "Português", short: "PT" },
  { code: "ja", label: "Japanese", flag: "🇯🇵", native: "日本語", short: "JA" },
  { code: "fr", label: "French", flag: "🇫🇷", native: "Français", short: "FR" },
  { code: "de", label: "German", flag: "🇩🇪", native: "Deutsch", short: "DE" },
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
    /* private mode */
  }

  // Set Google Translate cookies so the entire DOM UI translates
  const cookieVal = lang === "en" ? "" : `/en/${lang}`;
  const domain = window.location.hostname;
  document.cookie = `googtrans=${cookieVal}; path=/; domain=${domain}`;
  document.cookie = `googtrans=${cookieVal}; path=/`;

  // Trigger Google Translate widget combo if available
  const combo = document.querySelector(".goog-te-combo") as HTMLSelectElement | null;
  if (combo) {
    if (combo.value !== lang) {
      combo.value = lang;
      combo.dispatchEvent(new Event("change"));
    }
  }

  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent("hc:language", { detail: lang }));
  return lang;
}

/** Injects Google Translate script for full site UI translation */
export function initGoogleTranslate(): void {
  if (typeof window === "undefined") return;
  if (document.getElementById("google-translate-script")) return;

  // Create hidden container element
  if (!document.getElementById("google_translate_element")) {
    const div = document.createElement("div");
    div.id = "google_translate_element";
    div.style.display = "none";
    document.body.appendChild(div);
  }

  (window as any).googleTranslateElementInit = () => {
    if ((window as any).google?.translate?.TranslateElement) {
      new (window as any).google.translate.TranslateElement(
        {
          pageLanguage: "en",
          includedLanguages: "en,es,pt,ja,fr,de",
          autoDisplay: false,
        },
        "google_translate_element",
      );

      // Apply initial saved language
      const savedLang = readPreferredLanguage();
      if (savedLang !== "en") {
        setTimeout(() => {
          const combo = document.querySelector(".goog-te-combo") as HTMLSelectElement | null;
          if (combo) {
            combo.value = savedLang;
            combo.dispatchEvent(new Event("change"));
          }
        }, 500);
      }
    }
  };

  const script = document.createElement("script");
  script.id = "google-translate-script";
  script.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  document.head.appendChild(script);
}

/** The instruction a companion gets, or nothing for English. */
export function replyLanguageInstruction(code: string | null | undefined): string {
  const lang = normalizeLanguage(code);
  if (lang === DEFAULT_LANGUAGE) return "";
  const l = SUPPORTED_LANGUAGES.find((x) => x.code === lang)!;
  return `The user has chosen ${l.label}. Write EVERY reply in ${l.native} — natural, fluent, native-speaker ${l.label}, keeping exactly the same voice, warmth and explicitness. Never switch back to English unless the user does.`;
}

