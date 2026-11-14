"use client";

import { useState, type FormEvent } from "react";
import { debtBalance, lastDueDate, plannedBalance, type DebtData } from "../domain/debts";
import { localDate, money } from "../domain/finance";
import { translateError } from "../../../shared/i18n/messages";
import { useI18n } from "../../../shared/i18n/provider";
import { formatMoney } from "../../../shared/presentation/primitives";

export function DebtPayoff({ debt, currency }: { debt: DebtData; currency: string }) {
  const { t, language } = useI18n();
  const today = localDate();
  const start = debt.startDate > today ? debt.startDate : today;
  const end = [start, lastDueDate(debt), ...debt.payments.map((payment) => payment.date)].sort().at(-1)!;
  const [result, setResult] = useState<{ baseline: number; projected: number; date: string; balloon: number } | null>(null);
  const [error, setError] = useState("");
  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const date = String(form.get("date"));
      const amount = money(String(form.get("amount")));
      if (!amount) throw new Error("Repayment must be greater than zero.");
      if (date < start || date > end) throw new Error("Choose a payoff date within the estimate period.");
      const baseline = plannedBalance(debt, today);
      const extra = plannedBalance(debt, today, { date, amount });
      if (extra.extraApplied !== amount) throw new Error("Extra repayment exceeds the estimated balance on that date.");
      setResult({
        baseline: baseline.totalPaid + baseline.balance,
        projected: extra.totalPaid + extra.balance,
        date: extra.payoffDate ?? extra.end,
        balloon: extra.balance,
      });
      setError("");
    } catch (error) {
      setResult(null);
      setError(error instanceof Error ? error.message : "Could not calculate the payoff estimate.");
    }
  }
  if (debtBalance(debt, today) === 0) return null;
  return <details className="settings-details">
    <summary>{t("Estimate an early repayment")}</summary>
    <p className="help">{t("The estimate includes recorded future repayments, assumes remaining scheduled payments are on time and settles any balance after the last scheduled or recorded payment. It does not change your records.")}</p>
    <form className="stack" onSubmit={calculate}>
      <div className="form-grid"><label>{t("Extra repayment")}<input name="amount" type="number" step="0.01" min="0.01" max="10000000000" required /></label><label>{t("Repayment date")}<input name="date" type="date" min={start} max={end} defaultValue={start} required /></label></div>
      <button className="button secondary">{t("Calculate estimate")}</button>
    </form>
    {error && <p className="error" role="alert">{translateError(language, error)}</p>}
    {result && <div role="status"><p>{t("Estimated total repaid: {p0}", { p0: formatMoney(result.projected, currency, language) })}</p><p>{t("Estimated savings: {p0}", { p0: formatMoney(result.baseline - result.projected, currency, language) })}</p><p>{t("Estimated payoff date: {p0}", { p0: new Date(`${result.date}T12:00:00`).toLocaleDateString(language) })}</p>{result.balloon > 0 && <p>{t("Includes estimated final payment: {p0}", { p0: formatMoney(result.balloon, currency, language) })}</p>}</div>}
  </details>;
}
