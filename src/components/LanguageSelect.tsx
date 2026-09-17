import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  readPreferredLanguage,
  storePreferredLanguage,
} from "@/lib/languages";

// The language picker, used in the desktop sidebar and the phone menu.
//
// A native <select>: it opens the platform's own picker on a phone, which is
// the one control that never needs a tap-target fix. The label under it says
// what the choice actually changes, so nobody expects the menus to translate.
export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const [lang, setLang] = useState("en");

  useEffect(() => {
    setLang(readPreferredLanguage());
    const onChange = (e: Event) => setLang((e as CustomEvent<string>).detail);
    window.addEventListener("hc:language", onChange);
    return () => window.removeEventListener("hc:language", onChange);
  }, []);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === lang) ?? SUPPORTED_LANGUAGES[0];

  return (
    <div className={compact ? "" : "px-1"}>
      <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/80 ring-1 ring-white/10 focus-within:ring-primary/50">
        <span className="text-base leading-none" aria-hidden>
          {current.flag}
        </span>
        <select
          value={lang}
          onChange={(e) => setLang(storePreferredLanguage(e.target.value))}
          aria-label="Language"
          className="tap-exempt min-h-0 flex-1 cursor-pointer appearance-none bg-transparent text-xs text-white outline-none"
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="bg-background text-foreground">
              {l.native} — {l.label}
            </option>
          ))}
        </select>
        <Languages className="h-3.5 w-3.5 shrink-0 text-white/40" />
      </label>
      <p className="mt-1 px-1 text-[10px] leading-snug text-white/40">
        She replies in this language. Menus stay in English for now.
      </p>
    </div>
  );
}
