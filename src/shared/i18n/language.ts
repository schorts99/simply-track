export const LANGUAGE_STORAGE_KEY = "simply-track-language";
export type Language = "en" | "es";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

export function detectLanguage(languages: readonly string[], stored: string | null): Language {
  if (isLanguage(stored)) return stored;
  for (const locale of languages) {
    const language = locale.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(language)) return language;
  }
  return "en";
}
