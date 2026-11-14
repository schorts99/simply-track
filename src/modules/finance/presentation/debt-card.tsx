"use client";

import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { debtBalance, debtPlanOutstanding, debtSchedule, lastDueDate, type DebtData } from "../domain/debts";
import { localDate, type FinanceState } from "../domain/finance";
import { translateError } from "../../../shared/i18n/messages";
import { useI18n } from "../../../shared/i18n/provider";
import { formatMoney, Progress } from "../../../shared/presentation/primitives";
import type { Editor } from "./finance-forms";
import { DebtPayoff } from "./debt-payoff";

export function DebtCard({ debt, state, edit, remove }: {
  debt: DebtData; state: FinanceState; edit: (editor: Editor) => void;
  remove: (kind: "debt" | "repayment", id: string, debtId?: string) => void;
}) {
  const { t, language } = useI18n();
  const today = localDate();
  const fmt = (value: number) => formatMoney(value, state.settings.currency, language);
  const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(language);
  let calculation: { balance: number; overdue: number; balloon: number; schedule: ReturnType<typeof debtSchedule> } | undefined;
  let error = "";
  try {
    const balance = debtBalance(debt, today);
    const plan = debtPlanOutstanding(debt, today);
    const overdue = Math.min(balance, [...plan.schedule, ...(plan.balloon ? [{ date: lastDueDate(debt), amount: plan.balloon }] : [])].filter((payment) => payment.date < today).reduce((sum, payment) => sum + payment.amount, 0));
    calculation = { balance, overdue, balloon: plan.balloon, schedule: debtSchedule(debt) };
  } catch (reason) { error = reason instanceof Error ? reason.message : "Could not calculate the debt balance."; }
  const paid = debt.payments.filter((payment) => payment.date <= today).reduce((sum, payment) => sum + payment.amount, 0);
  return <article className="card planning-card">
    <div className="spread"><h3>{debt.name}</h3><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: debt.name })} onClick={() => edit({ kind: "debt", data: debt })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0}", { p0: debt.name })} onClick={() => remove("debt", debt.id)}><Trash2 size={15} /></button></div></div>
    <p>{t(debt.direction === "owed" ? "I owe money" : "I lent money")} &middot; {t("Annual interest: {p0}%", { p0: (debt.annualRate / 100).toLocaleString(language) })} &middot; {t(debt.interestMode === "compound" ? "Monthly compound interest" : debt.interestMode === "declining" ? "Declining-balance simple interest" : "Fixed simple interest")}</p>
    {error && <p className="error" role="alert">{translateError(language, error)}</p>}
    {calculation && <>
      <p className="large-number">{fmt(calculation.balance)} <small>{t("remaining")}</small></p>
      <Progress label={debt.name} value={paid + calculation.balance ? paid / (paid + calculation.balance) * 100 : 100} />
      <p>{t("{p0} repaid", { p0: fmt(paid) })} &middot; {t("Balance as of today")}</p>
      <p className={calculation.overdue > 0 ? "expense" : "muted"}>{calculation.balance === 0 ? t("Fully repaid") : calculation.overdue ? t("Overdue: {p0}", { p0: fmt(calculation.overdue) }) : t("Final due date: {p0}", { p0: date(lastDueDate(debt)) })}</p>
      <button className="text-button" onClick={() => edit({ kind: "repayment", debtId: debt.id })} disabled={calculation.balance === 0}>{t("Record repayment")} <ArrowRight size={15} /></button>
      <details className="settings-details"><summary>{t("Payment schedule")}</summary><div className="table-scroll" tabIndex={0} role="region" aria-label={t("Payment schedule")}><table><thead><tr><th scope="col">{t("Date")}</th><th scope="col">{t("Amount")}</th></tr></thead><tbody>{calculation.schedule.map((item, index) => <tr key={index}><td>{date(item.date)}</td><td>{fmt(item.amount)}</td></tr>)}</tbody></table></div>{calculation.balloon > 0 && <p>{t("Estimated balance after scheduled payments: {p0}", { p0: fmt(calculation.balloon) })}</p>}</details>
      {debt.payments.length > 0 && <details className="settings-details"><summary>{t("Repayment history")}</summary>{[...debt.payments].sort((a, b) => b.date.localeCompare(a.date)).map((payment) => <div className="spread" key={payment.id}><span>{date(payment.date)} &middot; {fmt(payment.amount)}{payment.transactionId && <> &middot; {t("Linked to {p0}", { p0: state.transactions.find((transaction) => transaction.id === payment.transactionId)?.title ?? "" })}</>}</span><div className="inline-actions"><button className="icon-button" aria-label={t("Edit repayment on {p0}", { p0: date(payment.date) })} onClick={() => edit({ kind: "repayment", debtId: debt.id, data: payment })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete repayment on {p0}", { p0: date(payment.date) })} onClick={() => remove("repayment", payment.id, debt.id)}><Trash2 size={15} /></button></div></div>)}</details>}
      <DebtPayoff key={state.revision} debt={debt} currency={state.settings.currency} />
    </>}
  </article>;
}
