"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "../i18n/provider";
import { isThemePreference, resolveTheme, themePreference, THEME_STORAGE_KEY, type ThemePreference } from "./theme";

interface ThemeContext {
  preference: ThemePreference;
  storageError: boolean;
  setPreference: (preference: ThemePreference) => void;
}
const Context = createContext<ThemeContext | null>(null);
const query = "(prefers-color-scheme: dark)";
function subscribeSystem(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
function systemSnapshot() { return window.matchMedia(query).matches; }
function serverSnapshot() { return false; }
function initialPreference(): { preference: ThemePreference; storageError: boolean } {
  if (typeof window === "undefined") return { preference: "system", storageError: false };
  try { return { preference: themePreference(localStorage.getItem(THEME_STORAGE_KEY)), storageError: false }; }
  catch { return { preference: "system", storageError: true }; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ preference, storageError }, update] = useState(initialPreference);
  const systemDark = useSyncExternalStore(subscribeSystem, systemSnapshot, serverSnapshot);
  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#15151e" : "#f7f8fa");
  }, [resolved]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      let storage: Storage;
      try { storage = localStorage; }
      catch { update((current) => ({ ...current, storageError: true })); return; }
      if (event.storageArea === storage) {
        update({ preference: themePreference(event.newValue), storageError: false });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  function setPreference(value: ThemePreference) {
    let storageError = false;
    try { localStorage.setItem(THEME_STORAGE_KEY, value); }
    catch { storageError = true; }
    update({ preference: value, storageError });
  }
  return <Context.Provider value={{ preference, setPreference, storageError }}>
    {children}
  </Context.Provider>;
}

export function ThemeSelect() {
  const theme = useContext(Context);
  const { t } = useI18n();
  if (!theme) throw new Error("ThemeProvider is required.");
  return <div className="theme-control"><label className="theme-select">{t("Appearance")}
    <select value={theme.preference} onChange={(event) => { if (isThemePreference(event.target.value)) theme.setPreference(event.target.value); }}>
      <option value="light">{t("Light")}</option>
      <option value="dark">{t("Dark")}</option>
      <option value="system">{t("System")}</option>
    </select>
  </label>
    {theme.storageError && <p className="alert error-alert appearance-error" role="alert">{t("Appearance preferences could not be saved or read. Your choice applies only to this session.")}</p>}
  </div>;
}
