"use client";

import { useState, type FormEvent } from "react";
import type { CatalogItem, Settings } from "../domain/settings";
import { defaultSettings } from "../domain/settings";
import { money, type Command } from "../domain/finance";
import { useI18n } from "../../../shared/i18n/provider";
import { translateError } from "../../../shared/i18n/messages";
import { amountInput } from "../../../shared/presentation/primitives";

export function catalogName(items: CatalogItem[], id: string, t: (message: string) => string): string {
  const item = items.find((item) => item.id === id);
  if (!item) return id;
  const defaults = defaultSettings();
  const builtin = [...defaults.expenseCategories, ...defaults.incomeCategories, ...defaults.paymentMethods].some((entry) => entry.id === id && entry.name === item.name);
  return builtin ? t(item.name) : item.name;
}

export function PreferencesForm({ settings, onSave, busy }: { settings: Settings; onSave: (command: Command) => Promise<void>; busy: boolean }) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState(() => structuredClone(settings));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  type CatalogKey = "expenseCategories" | "incomeCategories" | "paymentMethods";
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || busy) return;
    setSubmitting(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await onSave({ type: "settings.save", data: {
        ...draft, profileName: draft.profileName.trim(), workspaceName: draft.workspaceName.trim(),
        incomeBaseline: money(String(form.get("incomeBaseline"))),
        expenseBaseline: form.get("expenseBaseline") === "" ? null : money(String(form.get("expenseBaseline"))),
        openingBalance: money(String(form.get("openingBalance"))),
        quickActions: draft.quickActions.map((item) => ({ ...item, title: item.title.trim(), amount: money(String(form.get(`quick-${item.id}`))) })),
        expenseCategories: draft.expenseCategories.map((item) => ({ ...item, name: item.name.trim() })),
        incomeCategories: draft.incomeCategories.map((item) => ({ ...item, name: item.name.trim() })),
        paymentMethods: draft.paymentMethods.map((item) => ({ ...item, name: item.name.trim() })),
      } });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save this record."); }
    finally { setSubmitting(false); }
  }
  function catalog(key: CatalogKey, label: string) {
    return <details className="preferences-section"><summary>{t(label)}</summary>
      <p className="help">{t("Rename freely. Archive unused options to hide them from new records; existing records keep their history. Quick actions must use active options.")}</p>
      <div className="stack">{draft[key].map((item, index) => <div className="catalog-row" key={item.id}>
        <label><span className="sr-only">{t(label)} {index + 1}</span><input required maxLength={80} value={item.name} onChange={(event) => patch(key, draft[key].map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry))} /></label>
        <label className="checkbox"><input type="checkbox" checked={item.active} onChange={(event) => patch(key, draft[key].map((entry) => entry.id === item.id ? { ...entry, active: event.target.checked } : entry))} />{t("Active")}<span className="sr-only"> {item.name}</span></label>
        {key === "expenseCategories" && <label className="checkbox"><input type="checkbox" checked={draft.needsCategories.includes(item.id)} onChange={(event) => patch("needsCategories", event.target.checked ? [...draft.needsCategories, item.id] : draft.needsCategories.filter((id) => id !== item.id))} />{t("Need")}<span className="sr-only"> {item.name}</span></label>}
      </div>)}</div>
      <button type="button" className="button secondary" disabled={draft[key].length >= 100} onClick={() => patch(key, [...draft[key], { id: crypto.randomUUID(), name: "", active: true }])}>{t("Add option")}</button>
    </details>;
  }
  return <form className="stack preferences-form" onSubmit={submit} onInvalidCapture={(event) => {
    const input = event.target;
    if (!(input instanceof HTMLElement)) return;
    let parent = input.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
  }}>
    <h3>{t("Make this space yours")}</h3>
    <label>{t("Your name")}<input maxLength={80} value={draft.profileName} onChange={(event) => patch("profileName", event.target.value)} /></label>
    <label>{t("Workspace name")}<input maxLength={80} placeholder={t("Your workspace")} value={draft.workspaceName} onChange={(event) => patch("workspaceName", event.target.value)} /></label>
    <label>{t("Currency")}<select value={draft.currency} onChange={(event) => patch("currency", event.target.value)}>{Intl.supportedValuesOf("currency").map((currency) => <option key={currency}>{currency}</option>)}</select></label>
    <p className="help">{t("Currency changes the display label only; it does not convert existing amounts. Values use two decimal places.")}</p>
    <details className="preferences-section" open><summary>{t("Forecast assumptions")}</summary>
      <label>{t("Expected monthly income")}<input name="incomeBaseline" type="number" step="0.01" min="0" required defaultValue={amountInput(draft.incomeBaseline)} /></label>
      <p className="help">{t("Used in forecasts. Leave at zero to use the selected month's recorded income.")}</p>
      <label>{t("Expected monthly expenses")}<input name="expenseBaseline" type="number" step="0.01" min="0" defaultValue={draft.expenseBaseline === null ? "" : amountInput(draft.expenseBaseline)} /></label>
      <p className="help">{t("Leave blank to estimate expenses from recorded spending and recurring items. Zero explicitly projects no expenses.")}</p>
      <label>{t("Opening balance")}<input name="openingBalance" type="number" step="0.01" required defaultValue={amountInput(draft.openingBalance)} /></label>
      <label>{t("Forecast months")}<input type="number" min="1" max="24" step="1" required value={draft.forecastMonths} onChange={(event) => patch("forecastMonths", Number(event.target.value))} /></label>
    </details>
    {catalog("expenseCategories", "Expense categories")}
    {catalog("incomeCategories", "Income categories")}
    {catalog("paymentMethods", "Payment methods")}
    <details className="preferences-section"><summary>{t("Quick actions")}</summary>
      <p className="help">{t("Create up to 12 shortcuts, or remove all of them to hide quick actions.")}</p>
      {draft.quickActions.map((item, index) => {
        const change = (value: Partial<typeof item>) => patch("quickActions", draft.quickActions.map((entry) => entry.id === item.id ? { ...entry, ...value } : entry));
        return <fieldset className="quick-editor" key={item.id}><legend>{t("Quick action")} {index + 1}</legend>
          <label>{t("Description")}<input required maxLength={120} value={item.title} onChange={(event) => change({ title: event.target.value })} /></label>
          <label>{t("Amount")}<input name={`quick-${item.id}`} type="number" step="0.01" min="0.01" required defaultValue={amountInput(item.amount)} /></label>
          <label>{t("Category")}<select value={item.category} onChange={(event) => change({ category: event.target.value })}>{draft.expenseCategories.map((entry) => <option key={entry.id} value={entry.id} disabled={!entry.active}>{entry.name}{!entry.active ? ` (${t("Archived")})` : ""}</option>)}</select></label>
          <label>{t("Payment method")}<select value={item.paymentMethod} onChange={(event) => change({ paymentMethod: event.target.value })}>{draft.paymentMethods.map((entry) => <option key={entry.id} value={entry.id} disabled={!entry.active}>{entry.name}{!entry.active ? ` (${t("Archived")})` : ""}</option>)}</select></label>
          <button type="button" className="text-button" onClick={() => patch("quickActions", draft.quickActions.filter((entry) => entry.id !== item.id))}>{t("Remove quick action")}</button>
        </fieldset>;
      })}
      <button type="button" className="button secondary" disabled={draft.quickActions.length >= 12} onClick={() => patch("quickActions", [...draft.quickActions, { id: crypto.randomUUID(), title: "", amount: 100, category: draft.expenseCategories.find((item) => item.active)?.id ?? "", paymentMethod: draft.paymentMethods.find((item) => item.active)?.id ?? "" }])}>{t("Add quick action")}</button>
    </details>
    {error && <p role="alert" className="error">{translateError(language, error)}</p>}
    <div className="form-submit"><button className="button primary" disabled={busy || submitting}>{submitting ? t("Saving...") : t("Save changes")}</button></div>
  </form>;
}
