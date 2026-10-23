"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { LanguageSelect, useI18n } from "../../../shared/i18n/provider";
import { ThemeSelect } from "../../../shared/theme/provider";
import { BrandMark } from "../../../shared/presentation/primitives";
import { LEGAL_EFFECTIVE_DATE, legalContent, type LegalDocument } from "./legal-content";

export function LegalLinks({ className = "legal-links" }: { className?: string }) {
  const { t } = useI18n();
  return <nav className={className} aria-label={t("Legal")}><Link href="/privacy">{t("Privacy")}</Link><Link href="/terms">{t("Terms")}</Link></nav>;
}

export function LegalPage({ document }: { document: LegalDocument }) {
  const { language, ready, t } = useI18n();
  const content = legalContent(document, language);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return <main className="legal-page" id="main-content" tabIndex={-1}>
    <header className="legal-header"><Link className="legal-brand" href="/"><BrandMark /><span>simply<span>track</span></span></Link>{ready ? <div className="unlock-preferences"><LanguageSelect /><ThemeSelect /></div> : <div className="legal-preferences-placeholder" />}</header>
    <article className="legal-card">
      <Link className="text-button legal-back" href="/"><ArrowLeft size={16} /> {t("Back to SimplyTrack")}</Link>
      <p className="eyebrow">{t("Effective {date}", { date: new Date(`${LEGAL_EFFECTIVE_DATE}T12:00:00`).toLocaleDateString(language, { dateStyle: "long" }) })}</p>
      <h1>{content.title}</h1>
      <p className="legal-intro">{content.intro}</p>
      {content.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}
    </article>
    <LegalLinks className="legal-links legal-footer-links" />
  </main>;
}
