"use client";

import { useI18n } from "../i18n/provider";
import { translateError } from "../i18n/messages";
import type { Language } from "../i18n/language";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import Image from "next/image";

export function BrandMark() {
  return <Image src="/icon.svg" width={28} height={28} alt="" unoptimized aria-hidden="true" />;
}

export function formatMoney(cents: number, currency: string, language: Language = "en") {
  return new Intl.NumberFormat(language, { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}
export function amountInput(cents: number) { return (cents / 100).toFixed(2); }
export function Modal({ title, children, onClose, error }: { title: string; children: ReactNode; onClose: () => void; error?: string }) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      const target = previous instanceof HTMLElement && previous.isConnected ? previous : document.getElementById("main-content");
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);
  return <dialog ref={ref} className="modal" aria-labelledby={headingId} onCancel={onClose} onClose={(event) => {
    // Strict Mode can dispatch a queued cleanup close after showModal reopens it.
    if (!event.currentTarget.open) onClose();
  }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="modal-heading"><h2 id={headingId}>{title}</h2><button className="icon-button" type="button" aria-label={t("Close dialog")} onClick={onClose}><X size={20} /></button></div>
    <div className="modal-body">
      {error && <p ref={errorRef} tabIndex={-1} className="alert error-alert" role="alert">{translateError(language, error)}</p>}
      {children}
    </div>
  </dialog>;
}
export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty">{action && <span className="empty-mark" aria-hidden="true">+</span>}<h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Progress({ value, label, intent = "budget" }: { value: number; label: string; intent?: "budget" | "neutral" | "goal" }) {
  return <div className={`progress ${intent} ${value >= 100 ? "full" : value >= 80 ? "warning" : ""}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={Math.max(100, Math.round(value))}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}
