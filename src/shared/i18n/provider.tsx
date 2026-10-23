"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { detectLanguage, isLanguage, LANGUAGE_STORAGE_KEY, type Language } from "./language";
import { translate, type TranslationValues } from "./messages";

// Server-rendered in English so crawlers and visitors without JavaScript can read them.
const PUBLIC_PAGES = new Set(["/privacy", "/terms"]);
const PAGE_META: Record<string, { title: string; description: string }> = {
  "/": { title: "SimplyTrack | A little more clarity", description: "A private, local-first space to track your money, plan your spending, and save for what matters." },
  "/privacy": { title: "Privacy Policy | SimplyTrack", description: "How SimplyTrack stores, encrypts and syncs your financial information." },
  "/terms": { title: "Terms and Conditions | SimplyTrack", description: "The terms for using SimplyTrack, its estimates and optional services." },
};

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (message: string, values?: TranslationValues) => string;
  ready: boolean;
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
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.lang = language;
    const page = PAGE_META[pathname] ?? PAGE_META["/"];
    const title = translate(language, page.title);
    const description = translate(language, page.description);
    const apply = () => {
      if (document.title !== title) document.title = title;
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.getAttribute("content") !== description) meta.setAttribute("content", description);
    };
    apply();
    // Next can re-commit server metadata after hydration; keep the selected language applied.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [language, pathname]);
  function setLanguage(value: Language) {
    let storageError = false;
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, value); }
    catch { storageError = true; }
    setPreference({ language: value, storageError });
  }
  const t = (message: string, values?: TranslationValues) => translate(language, message, values);
  if (!ready && PUBLIC_PAGES.has(pathname)) {
    return <Context.Provider value={{ language: "en", setLanguage, t: (message, values) => translate("en", message, values), ready }}>{children}</Context.Provider>;
  }
  return <Context.Provider value={{ language, setLanguage, t, ready }}>
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
