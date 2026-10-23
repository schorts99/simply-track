import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { isThemePreference, resolveTheme, themeBootstrap, themePreference, THEME_STORAGE_KEY } from "../src/shared/theme/theme";

describe("appearance preference", () => {
  it("defaults to system and accepts only the three supported choices", () => {
    for (const value of [null, "", "Dark", "undefined", "automatic"]) expect(themePreference(value)).toBe("system");
    for (const value of ["light", "dark", "system"] as const) {
      expect(isThemePreference(value)).toBe(true);
      expect(themePreference(value)).toBe(value);
    }
    expect(isThemePreference(undefined)).toBe(false);
  });
  it("follows system only when no explicit light/dark override is selected", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    for (const systemDark of [true, false]) {
      expect(resolveTheme("light", systemDark)).toBe("light");
      expect(resolveTheme("dark", systemDark)).toBe("dark");
    }
  });
  it("applies the correct theme before hydration without writing a default preference", () => {
    for (const stored of [null, "light", "dark", "system", "invalid"]) {
      for (const systemDark of [true, false]) {
        const document = { documentElement: { dataset: {} as Record<string, string> } };
        runInNewContext(themeBootstrap, {
          document, matchMedia: () => ({ matches: systemDark }),
          localStorage: { getItem: (key: string) => { expect(key).toBe(THEME_STORAGE_KEY); return stored; } },
        });
        expect(document.documentElement.dataset.theme).toBe(resolveTheme(themePreference(stored), systemDark));
      }
    }
  });
  it("does not block initial rendering when local storage is unavailable", () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(themeBootstrap, {
      document, matchMedia: () => ({ matches: true }),
      localStorage: { getItem: () => { throw new Error("Storage blocked"); } },
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
