"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { detectLanguage, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from "./language";
import { translate, type TranslationValues } from "./messages";

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (message: string, values?: TranslationValues) => string;
}
const Context = createContext<I18n | null>(null);
const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function initialPreference(): { language: Language; storageError: boolean } {
  if (typeof window === "undefined") return { language: "en", storageError: false };
  let stored: string | null = null;
  let storageError = false;
  try { stored = localStorage.getItem(LANGUAGE_STORAGE_KEY); }
  catch { storageError = true; }
  return { language: detectLanguage(navigator.languages.length ? navigator.languages : [navigator.language], stored), storageError };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [{ language, storageError }, setPreference] = useState(initialPreference);
  const ready = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
        setPreference({ language: detectLanguage(navigator.languages, event.newValue), storageError: false });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, "SimplyTrack | A little more clarity");
    document.querySelector('meta[name="description"]')?.setAttribute("content", translate(language, "A private, local-first space to track your money, plan your spending, and save for what matters."));
  }, [language]);
  function setLanguage(value: Language) {
    let storageError = false;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, value); }
    catch { storageError = true; }
    setPreference({ language: value, storageError });
  }
  const t = (message: string, values?: TranslationValues) => translate(language, message, values);
  return <Context.Provider value={{ language, setLanguage, t }}>
    {ready ? <><a className="skip-link" href="#main-content">{t("Skip to content")}</a>
      {storageError && <p className="alert error-alert language-error" role="alert">{t("Language preferences could not be saved or read. Your choice applies only to this session.")}</p>}
      {children}</> : <main className="unlock-page"><p>SimplyTrack</p></main>}
  </Context.Provider>;
}

export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error("I18nProvider is required.");
  return value;
}

export function LanguageSelect() {
  const { language, setLanguage, t } = useI18n();
  return <label className="language-select">{t("Language")}
    <select value={language} onChange={(event) => { if (isLanguage(event.target.value)) setLanguage(event.target.value); }}>
      <option value="en" lang="en">English</option>
      <option value="es" lang="es">Español</option>
    </select>
  </label>;
}
