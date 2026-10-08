import { useEffect, useState } from "react";
import { Globe, ChevronDown } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  readPreferredLanguage,
  storePreferredLanguage,
} from "@/lib/languages";

export function LanguageSelect({
  compact = false,
  flagOnly = false,
}: {
  compact?: boolean;
  // Just the flag in a small circle, for the one-line phone header where the
  // "EN ⌄" pill doesn't fit next to Login and Join Free. Same native picker.
  flagOnly?: boolean;
}) {
  const [lang, setLang] = useState("en");

  useEffect(() => {
    setLang(readPreferredLanguage());
    const onChange = (e: Event) => setLang((e as CustomEvent<string>).detail);
    window.addEventListener("hc:language", onChange);
    return () => window.removeEventListener("hc:language", onChange);
  }, []);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === lang) ?? SUPPORTED_LANGUAGES[0];

  if (flagOnly) {
    return (
      <label className="relative flex h-8 w-8 shrink-0 overflow-hidden items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm leading-none cursor-pointer transition hover:bg-white/10">
        <span aria-hidden>{current.flag}</span>
        <select
          value={lang}
          onChange={(e) => setLang(storePreferredLanguage(e.target.value))}
          aria-label="Select Language"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="bg-neutral-900 text-white">
              {l.flag} {l.native} ({l.short})
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (compact) {
    return (
      <div className="relative inline-flex items-center">
        <label className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 px-2.5 py-1 text-xs text-white/90 cursor-pointer transition shadow-sm">
          <span className="text-xs leading-none" aria-hidden>
            {current.flag}
          </span>
          <span className="font-semibold text-[11px] uppercase tracking-wider text-white/90">
            {current.short}
          </span>
          <ChevronDown className="h-3 w-3 text-white/50 shrink-0" />
          <select
            value={lang}
            onChange={(e) => setLang(storePreferredLanguage(e.target.value))}
            aria-label="Select Language"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-xs"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} className="bg-neutral-900 text-white">
                {l.flag} {l.native} ({l.short})
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="px-1">
      <label className="relative flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/80 ring-1 ring-white/10 hover:ring-primary/40 focus-within:ring-primary/50 cursor-pointer transition">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-none" aria-hidden>
            {current.flag}
          </span>
          <span className="font-medium text-white text-xs">
            {current.native} ({current.label})
          </span>
        </div>
        <Globe className="h-3.5 w-3.5 shrink-0 text-primary" />
        <select
          value={lang}
          onChange={(e) => setLang(storePreferredLanguage(e.target.value))}
          aria-label="Language"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-xs"
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="bg-neutral-900 text-white">
              {l.flag} {l.native} — {l.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

