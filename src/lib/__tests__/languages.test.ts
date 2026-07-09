import { describe, it, expect } from "vitest";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  languageLabel,
  normalizeLanguage,
} from "../languages";

describe("languages", () => {
  it("defaults to US English", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(SUPPORTED_LANGUAGES[0].code).toBe("en");
  });
  it("includes the six foundation languages", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(["en", "es", "pt", "ja", "fr", "de"]);
  });
  it("recognizes supported codes", () => {
    expect(isSupportedLanguage("ja")).toBe(true);
    expect(isSupportedLanguage("zz")).toBe(false);
  });
  it("labels codes", () => {
    expect(languageLabel("es")).toBe("Spanish");
    expect(languageLabel("unknown")).toBe("unknown");
  });
  it("normalizes bad/empty codes to default", () => {
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage("zz")).toBe("en");
    expect(normalizeLanguage("fr")).toBe("fr");
  });
});
