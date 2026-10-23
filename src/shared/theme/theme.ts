export const THEME_STORAGE_KEY = "simply-track-theme";
export type ThemePreference = "light" | "dark" | "system";
export type ColorTheme = Exclude<ThemePreference, "system">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function themePreference(stored: string | null): ThemePreference {
  return isThemePreference(stored) ? stored : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ColorTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

// Run before paint so a saved override never flashes the opposite theme.
export const themeBootstrap = `(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {}
  document.documentElement.dataset.theme = preference === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
})();`;
