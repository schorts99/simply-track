"use client";

import { useI18n } from "../../../shared/i18n/provider";
import { translateError } from "../../../shared/i18n/messages";

import { useState, type FormEvent } from "react";
import { defaultSettings, localDate, money, type BudgetData, type Command, type GoalData, type ScenarioData, type Settings, type TransactionData } from "../domain/finance";
import { amountInput } from "../../../shared/presentation/primitives";
import { catalogName, PreferencesForm } from "./preferences-form";
import type { DebtData, DebtPayment, PaymentInterval } from "../domain/debts";

export type Editor =
  | { kind: "transaction"; data?: TransactionData }
  | { kind: "budget"; data?: BudgetData }
  | { kind: "goal"; data?: GoalData }
  | { kind: "scenario"; data?: ScenarioData }
  | { kind: "debt"; data?: DebtData }
  | { kind: "repayment"; debtId: string; data?: DebtPayment }
  | { kind: "preferences"; data: Settings };
export function FinanceForm({ editor, onSave, busy, settings = defaultSettings(), month }: { editor: Editor; onSave: (command: Command) => Promise<void>; busy: boolean; settings?: Settings; month?: string }) {
  const { t, language } = useI18n();
  const [type, setType] = useState(editor.kind === "transaction" ? editor.data?.type ?? "expense" : "expense");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const data = editor.data;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(""); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const str = (key: string) => String(form.get(key) ?? "");
    const id = data && "id" in data ? data.id : crypto.randomUUID();
    try {
      let command: Command;
      switch (editor.kind) {
        case "transaction":
          command = { type: "transaction.save", data: { id, title: str("title"), amount: money(str("amount")), type, category: str("category"), date: str("date"), paymentMethod: str("paymentMethod"), notes: str("notes"), recurring: form.has("recurring") } }; break;
        case "budget": command = { type: "budget.save", data: { id, category: str("category"), limit: money(str("limit")) } }; break;
        case "goal": command = { type: "goal.save", data: { id, name: str("name"), target: money(str("target")), saved: money(str("saved")), date: str("date") } }; break;
        case "scenario": command = { type: "scenario.save", data: { id, name: str("name"), incomeChange: money(str("incomeChange")), expensePercent: Number(str("expensePercent")) } }; break;
        case "debt": command = { type: "debt.save", data: { id, name: str("name"), direction: str("direction") as DebtData["direction"], principal: money(str("principal")), annualRate: money(str("annualRate")), startDate: str("startDate"), firstDueDate: str("firstDueDate"), installments: Number(str("installments")), interval: str("interval") as PaymentInterval, payments: editor.data?.payments ?? [] } }; break;
        case "repayment": command = { type: "debt.payment.save", debtId: editor.debtId, data: { id, amount: money(str("amount")), date: str("date") } }; break;
        case "preferences": return;
      }
      await onSave(command);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save this record."); }
    finally { setSubmitting(false); }
  }
  const cashField = (name: string, label: string, value = 0, signed = false) => <label>{t(label)}<input name={name} type="number" step="0.01" min={signed ? undefined : "0"} max="10000000000" inputMode="decimal" required defaultValue={amountInput(value)} /></label>;
  if (editor.kind === "preferences") return <PreferencesForm settings={editor.data} onSave={onSave} busy={busy} />;
  const available = (items: Settings["expenseCategories"], current?: string) => items.filter((item) => item.active || item.id === current);
  const transactionCategories = type === "expense" ? settings.expenseCategories : settings.incomeCategories;
  const today = localDate();
  const selectedDate = month && !today.startsWith(month) ? `${month}-01` : today;
  return <form className="stack" onSubmit={submit}>
    {editor.kind === "transaction" && <>
      <div className="segmented" role="group" aria-label={t("Transaction type")}><button type="button" aria-pressed={type === "expense"} className={type === "expense" ? "selected" : ""} onClick={() => setType("expense")}>{t("Expense")}</button><button type="button" aria-pressed={type === "income"} className={type === "income" ? "selected" : ""} onClick={() => setType("income")}>{t("Income")}</button></div>
      <label>{t("Description")}<input name="title" autoFocus required maxLength={120} placeholder={t("What was it for?")} defaultValue={editor.data?.title} /></label>
      <div className="form-grid">{cashField("amount", "Amount", editor.data?.amount)}<label>{t("Date")}<input name="date" type="date" required defaultValue={editor.data?.date ?? selectedDate} /></label></div>
      <div className="form-grid"><label>{t("Category")}<select key={type} name="category" defaultValue={editor.data?.type === type ? editor.data.category : transactionCategories.find((item) => item.active)?.id}>{available(transactionCategories, editor.data?.type === type ? editor.data.category : undefined).map((item) => <option key={item.id} value={item.id}>{catalogName(transactionCategories, item.id, t)}</option>)}</select></label>
        <label>{t("Payment method")}<select name="paymentMethod" defaultValue={editor.data?.paymentMethod ?? settings.paymentMethods.find((item) => item.active)?.id}>{available(settings.paymentMethods, editor.data?.paymentMethod).map((item) => <option key={item.id} value={item.id}>{catalogName(settings.paymentMethods, item.id, t)}</option>)}</select></label></div>
      <label>{t("Notes")} <span className="muted">{t("(optional)")}</span><textarea name="notes" maxLength={1000} defaultValue={editor.data?.notes} rows={2} /></label>
      <label className="checkbox"><input type="checkbox" name="recurring" defaultChecked={editor.data?.recurring} /> {t("Monthly recurring item")}</label>
      <p className="help">{t("Recurring items inform forecasts; they do not create future transactions automatically.")}</p>
    </>}
    {editor.kind === "budget" && <>
      <label>{t("Expense category")}<select name="category" defaultValue={editor.data?.category ?? settings.expenseCategories.find((item) => item.active)?.id}>{available(settings.expenseCategories, editor.data?.category).map((item) => <option key={item.id} value={item.id}>{catalogName(settings.expenseCategories, item.id, t)}</option>)}</select></label>
      {cashField("limit", "Monthly limit", editor.data?.limit)}
      <p className="help">{t("Applies each month. A category can have one budget.")}</p>
    </>}
    {editor.kind === "goal" && <>
      <label>{t("Goal name")}<input name="name" required maxLength={120} defaultValue={editor.data?.name} placeholder={t("A little something to look forward to")} /></label>
      <div className="form-grid">{cashField("target", "Target amount", editor.data?.target)}{cashField("saved", "Already set aside", editor.data?.saved)}</div>
      <label>{t("Target date")}<input type="date" name="date" required defaultValue={editor.data?.date ?? localDate()} /></label>
      <p className="help">{t("Goal allocations track savings, but do not move money or change your cash balance.")}</p>
    </>}
    {editor.kind === "scenario" && <>
      <label>{t("Scenario name")}<input name="name" required maxLength={120} defaultValue={editor.data?.name} placeholder={t("What if I cut back a little?")} /></label>
      {cashField("incomeChange", "Monthly income change (+ or -)", editor.data?.incomeChange, true)}
      <label>{t("Expense change (%)")}<input name="expensePercent" type="number" step="0.1" min="-100" max="1000" required defaultValue={editor.data?.expensePercent ?? -10} /></label>
      <p className="help">{t("Applied to all projected expenses. Scenarios never change actual transactions.")}</p>
    </>}
    {editor.kind === "debt" && <>
      <label>{t("Debt or loan name")}<input name="name" required maxLength={120} defaultValue={editor.data?.name} autoFocus /></label>
      <label>{t("Direction")}<select name="direction" defaultValue={editor.data?.direction ?? "owed"}><option value="owed">{t("I owe money")}</option><option value="lent">{t("I lent money")}</option></select></label>
      <div className="form-grid">{cashField("principal", "Principal", editor.data?.principal)}<label>{t("Annual simple interest (%)")}<input name="annualRate" type="number" step="0.01" min="0" max="1000" required defaultValue={amountInput(editor.data?.annualRate ?? 0)} /></label></div>
      <div className="form-grid"><label>{t("Start date")}<input name="startDate" type="date" required defaultValue={editor.data?.startDate ?? today} /></label><label>{t("First due date")}<input name="firstDueDate" type="date" required defaultValue={editor.data?.firstDueDate ?? today} /></label></div>
      <div className="form-grid"><label>{t("Number of payments")}<input name="installments" type="number" min="1" max="600" step="1" required defaultValue={editor.data?.installments ?? 1} /></label><label>{t("Payment interval")}<select name="interval" defaultValue={editor.data?.interval ?? "monthly"}><option value="weekly">{t("Weekly")}</option><option value="biweekly">{t("Every two weeks")}</option><option value="monthly">{t("Monthly")}</option><option value="quarterly">{t("Quarterly")}</option><option value="yearly">{t("Yearly")}</option></select></label></div>
      <p className="help">{t("Interest is calculated on the original principal from the start date through the final due date, using actual days and a 365-day year. Payments are divided as evenly as possible. Repayments do not create transactions or change forecasts.")}</p>
    </>}
    {editor.kind === "repayment" && <>
      <div className="form-grid">{cashField("amount", "Amount", editor.data?.amount)}<label>{t("Date")}<input name="date" type="date" required defaultValue={editor.data?.date ?? today} /></label></div>
      <p className="help">{t("Repayments are tracked separately and do not create transactions.")}</p>
    </>}
    {error && <p role="alert" className="error">{translateError(language, error)}</p>}
    <div className="form-submit"><button className="button primary" disabled={busy || submitting}>{busy || submitting ? t("Saving...") : t("Save changes")}</button></div>
  </form>;
}
