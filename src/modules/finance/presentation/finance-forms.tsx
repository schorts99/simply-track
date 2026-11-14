"use client";

import { useI18n } from "../../../shared/i18n/provider";
import { translateError } from "../../../shared/i18n/messages";

import { useState, type FormEvent } from "react";
import { defaultSettings, localDate, money, type BudgetData, type Command, type FinanceState, type GoalData, type ScenarioData, type Settings, type TransactionData } from "../domain/finance";
import { amountInput } from "../../../shared/presentation/primitives";
import { catalogName, PreferencesForm } from "./preferences-form";
import type { DebtData, DebtPayment, InterestMode, PaymentInterval } from "../domain/debts";
import type { AccountData, TransferData } from "../domain/accounts";
import type { ScheduleData } from "../domain/schedules";

export type Editor =
  | { kind: "transaction"; data?: TransactionData }
  | { kind: "budget"; data?: BudgetData }
  | { kind: "goal"; data?: GoalData }
  | { kind: "scenario"; data?: ScenarioData }
  | { kind: "debt"; data?: DebtData }
  | { kind: "repayment"; debtId: string; data?: DebtPayment }
  | { kind: "account"; data?: AccountData }
  | { kind: "transfer"; data?: TransferData }
  | { kind: "schedule"; data?: ScheduleData }
  | { kind: "preferences"; data: Settings };
export function FinanceForm({ editor, onSave, busy, settings = defaultSettings(), month, state }: { editor: Editor; onSave: (command: Command) => Promise<void>; busy: boolean; settings?: Settings; month?: string; state?: FinanceState }) {
  const { t, language } = useI18n();
  const [type, setType] = useState(editor.kind === "transaction" || editor.kind === "schedule" ? editor.data?.type ?? "expense" : "expense");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customSchedule, setCustomSchedule] = useState(editor.kind === "debt" && !!editor.data?.customSchedule);
  const [rows, setRows] = useState(() => editor.kind === "debt" && editor.data?.customSchedule
    ? editor.data.customSchedule.map((payment) => ({ key: crypto.randomUUID(), date: payment.date, amount: amountInput(payment.amount) }))
    : [{ key: crypto.randomUUID(), date: editor.kind === "debt" ? editor.data?.firstDueDate ?? localDate() : localDate(), amount: "0" }]);
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
          command = { type: "transaction.save", data: { ...editor.data, id, title: str("title"), amount: money(str("amount")), type, category: str("category"), date: str("date"), paymentMethod: str("paymentMethod"), notes: str("notes"), recurring: form.has("recurring"), accountId: str("accountId") || undefined } }; break;
        case "account": command = { type: "account.save", data: { id, name: str("name"), openingBalance: money(str("openingBalance")), openingDate: str("openingDate") } }; break;
        case "transfer": command = { type: "transfer.save", data: { id, fromAccountId: str("fromAccountId"), toAccountId: str("toAccountId"), amount: money(str("amount")), date: str("date"), notes: str("notes") } }; break;
        case "schedule": command = { type: "schedule.save", data: { id, title: str("title"), amount: money(str("amount")), type, category: str("category"), paymentMethod: str("paymentMethod"), accountId: str("accountId") || undefined, firstDate: str("firstDate"), endDate: str("endDate") || undefined, interval: str("interval") as PaymentInterval, active: form.has("active") } }; break;
        case "budget": command = { type: "budget.save", data: { id, category: str("category"), limit: money(str("limit")) } }; break;
        case "goal": command = { type: "goal.save", data: { id, name: str("name"), target: money(str("target")), saved: money(str("saved")), date: str("date") } }; break;
        case "scenario": command = { type: "scenario.save", data: { id, name: str("name"), incomeChange: money(str("incomeChange")), expensePercent: Number(str("expensePercent")) } }; break;
        case "debt": {
          const schedule = customSchedule ? form.getAll("customDate").map((date, index) => ({ date: String(date), amount: money(String(form.getAll("customAmount")[index])) })) : undefined;
          command = { type: "debt.save", data: { id, name: str("name"), direction: str("direction") as DebtData["direction"], principal: money(str("principal")), annualRate: money(str("annualRate")), interestMode: str("interestMode") as InterestMode, startDate: str("startDate"), firstDueDate: schedule ? schedule[0].date : str("firstDueDate"), installments: schedule ? schedule.length : Number(str("installments")), interval: schedule ? editor.data?.interval ?? "monthly" : str("interval") as PaymentInterval, payments: editor.data?.payments ?? [], customSchedule: schedule } }; break;
        }
        case "repayment": command = { type: "debt.payment.save", debtId: editor.debtId, data: { id, amount: money(str("amount")), date: str("date"), ...(str("transactionId") ? { transactionId: str("transactionId") } : {}) } }; break;
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
      <label>{t("Account (optional)")}<select name="accountId" defaultValue={editor.data?.accountId ?? ""}><option value="">{t("Unassigned")}</option>{state?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label>{t("Notes")} <span className="muted">{t("(optional)")}</span><textarea name="notes" maxLength={1000} defaultValue={editor.data?.notes} rows={2} /></label>
      <label className="checkbox"><input type="checkbox" name="recurring" defaultChecked={editor.data?.recurring} /> {t("Monthly recurring item")}</label>
      <p className="help">{t("Recurring items inform forecasts; they do not create future transactions automatically.")}</p>
    </>}
    {editor.kind === "account" && <>
      <label>{t("Account name")}<input name="name" required maxLength={120} defaultValue={editor.data?.name} autoFocus /></label>
      <div className="form-grid">{cashField("openingBalance", "Account opening balance", editor.data?.openingBalance, true)}<label>{t("Account opening date")}<input type="date" name="openingDate" required defaultValue={editor.data?.openingDate ?? today} /></label></div>
      <p className="help">{t("Use a negative opening balance for money owed, such as a credit card balance.")}</p>
    </>}
    {editor.kind === "transfer" && <>
      <div className="form-grid"><label>{t("From account")}<select name="fromAccountId" required defaultValue={editor.data?.fromAccountId ?? ""}><option value="" disabled>{t("Choose an account")}</option>{state?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>{t("To account")}<select name="toAccountId" required defaultValue={editor.data?.toAccountId ?? ""}><option value="" disabled>{t("Choose an account")}</option>{state?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
      <div className="form-grid">{cashField("amount", "Amount", editor.data?.amount)}<label>{t("Date")}<input name="date" type="date" required defaultValue={editor.data?.date ?? today} /></label></div>
      <label>{t("Notes")} <span className="muted">{t("(optional)")}</span><textarea name="notes" maxLength={1000} defaultValue={editor.data?.notes} rows={2} /></label>
      <p className="help">{t("Transfers move money between accounts without changing income or expenses.")}</p>
    </>}
    {editor.kind === "schedule" && <>
      <div className="segmented" role="group" aria-label={t("Transaction type")}><button type="button" aria-pressed={type === "expense"} className={type === "expense" ? "selected" : ""} onClick={() => setType("expense")}>{t("Expense")}</button><button type="button" aria-pressed={type === "income"} className={type === "income" ? "selected" : ""} onClick={() => setType("income")}>{t("Income")}</button></div>
      <label>{t("Description")}<input name="title" autoFocus required maxLength={120} defaultValue={editor.data?.title} /></label>
      <div className="form-grid">{cashField("amount", "Amount", editor.data?.amount)}<label>{t("First due date")}<input name="firstDate" type="date" required defaultValue={editor.data?.firstDate ?? today} /></label></div>
      <div className="form-grid"><label>{t("Category")}<select key={type} name="category" defaultValue={editor.data?.type === type ? editor.data.category : transactionCategories.find((item) => item.active)?.id}>{available(transactionCategories, editor.data?.type === type ? editor.data.category : undefined).map((item) => <option key={item.id} value={item.id}>{catalogName(transactionCategories, item.id, t)}</option>)}</select></label><label>{t("Payment method")}<select name="paymentMethod" defaultValue={editor.data?.paymentMethod ?? settings.paymentMethods.find((item) => item.active)?.id}>{available(settings.paymentMethods, editor.data?.paymentMethod).map((item) => <option key={item.id} value={item.id}>{catalogName(settings.paymentMethods, item.id, t)}</option>)}</select></label></div>
      <label>{t("Account (optional)")}<select name="accountId" defaultValue={editor.data?.accountId ?? ""}><option value="">{t("Unassigned")}</option>{state?.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <div className="form-grid"><label>{t("Payment interval")}<select name="interval" defaultValue={editor.data?.interval ?? "monthly"}><option value="weekly">{t("Weekly")}</option><option value="biweekly">{t("Every two weeks")}</option><option value="monthly">{t("Monthly")}</option><option value="quarterly">{t("Quarterly")}</option><option value="yearly">{t("Yearly")}</option></select></label><label>{t("End date (optional)")}<input name="endDate" type="date" defaultValue={editor.data?.endDate ?? ""} /></label></div>
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={editor.data?.active ?? true} /> {t("Active")}</label>
      <p className="help">{t("Occurrences create transactions only when confirmed. Editing the schedule does not change recorded transactions.")}</p>
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
      <p className="help">{t("Applied to baseline projected expenses; scheduled debt payments are unchanged. Scenarios never change actual transactions.")}</p>
    </>}
    {editor.kind === "debt" && <>
      <label>{t("Debt or loan name")}<input name="name" required maxLength={120} defaultValue={editor.data?.name} autoFocus /></label>
      <label>{t("Direction")}<select name="direction" defaultValue={editor.data?.direction ?? "owed"}><option value="owed">{t("I owe money")}</option><option value="lent">{t("I lent money")}</option></select></label>
      <div className="form-grid">{cashField("principal", "Principal", editor.data?.principal)}<label>{t("Annual interest (%)")}<input name="annualRate" type="number" step="0.01" min="0" max="1000" required defaultValue={amountInput(editor.data?.annualRate ?? 0)} /></label></div>
      <label>{t("Interest method")}<select name="interestMode" defaultValue={editor.data?.interestMode ?? "fixed"}><option value="fixed">{t("Fixed simple interest")}</option><option value="declining">{t("Declining-balance simple interest")}</option><option value="compound">{t("Monthly compound interest")}</option></select></label>
      <label>{t("Start date")}<input name="startDate" type="date" required defaultValue={editor.data?.startDate ?? today} /></label>
      <label>{t("Schedule type")}<select value={customSchedule ? "custom" : "regular"} onChange={(event) => setCustomSchedule(event.target.value === "custom")}><option value="regular">{t("Regular installments")}</option><option value="custom">{t("Custom payments")}</option></select></label>
      {customSchedule ? <><div className="stack">{rows.map((row, index) => <div className="form-grid" key={row.key}><label>{t("Payment {count} date", { count: index + 1 })}<input name="customDate" type="date" required value={row.date} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, date: event.target.value } : item))} /></label><label>{t("Payment {count} amount", { count: index + 1 })}<input name="customAmount" type="number" min="0.01" max="10000000000" step="0.01" required value={row.amount} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, amount: event.target.value } : item))} /></label>{rows.length > 1 && <button type="button" className="text-button" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>{t("Remove payment {count}", { count: index + 1 })}</button>}</div>)}</div><button type="button" className="button secondary" disabled={rows.length >= 600} onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), date: "", amount: "" }])}>{t("Add scheduled payment")}</button></> : <>
        <label>{t("First due date")}<input name="firstDueDate" type="date" required defaultValue={editor.data?.firstDueDate ?? today} /></label>
        <div className="form-grid"><label>{t("Number of payments")}<input name="installments" type="number" min="1" max="600" step="1" required defaultValue={editor.data?.installments ?? 1} /></label><label>{t("Payment interval")}<select name="interval" defaultValue={editor.data?.interval ?? "monthly"}><option value="weekly">{t("Weekly")}</option><option value="biweekly">{t("Every two weeks")}</option><option value="monthly">{t("Monthly")}</option><option value="quarterly">{t("Quarterly")}</option><option value="yearly">{t("Yearly")}</option></select></label></div>
      </>}
      <p className="help">{t("Fixed interest uses the original principal through the final due date. Balance-based interest accrues daily on a 365-day year and continues after the due date; compound interest capitalizes monthly on the start-date anniversary. Repayments pay interest first. Custom schedules may leave a final balloon.")}</p>
    </>}
    {editor.kind === "repayment" && <>
      <div className="form-grid">{cashField("amount", "Amount", editor.data?.amount)}<label>{t("Date")}<input name="date" type="date" required defaultValue={editor.data?.date ?? today} /></label></div>
      <label>{t("Link existing transaction (optional)")}<select name="transactionId" defaultValue={editor.data?.transactionId ?? ""}><option value="">{t("No linked transaction")}</option>{state?.transactions.filter((transaction) => transaction.type === (state.debts.find((debt) => debt.id === editor.debtId)?.direction === "owed" ? "expense" : "income")).map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.date} &middot; {transaction.title} &middot; {amountInput(transaction.amount)}</option>)}</select></label>
      <p className="help">{t("Repayments are tracked separately and do not create transactions.")}</p>
    </>}
    {error && <p role="alert" className="error">{translateError(language, error)}</p>}
    <div className="form-submit"><button className="button primary" disabled={busy || submitting}>{busy || submitting ? t("Saving...") : t("Save changes")}</button></div>
  </form>;
}
