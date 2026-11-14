export type PaymentInterval = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export interface DebtPayment { id: string; date: string; amount: number; }
export interface DebtData {
  id: string;
  name: string;
  direction: "owed" | "lent";
  principal: number;
  annualRate: number;
  startDate: string;
  firstDueDate: string;
  installments: number;
  interval: PaymentInterval;
  payments: DebtPayment[];
}

export function dueDate(first: string, interval: PaymentInterval, index: number): string {
  const date = new Date(`${first}T00:00:00Z`);
  if (interval === "weekly" || interval === "biweekly") {
    date.setUTCDate(date.getUTCDate() + index * (interval === "weekly" ? 7 : 14));
  } else {
    const day = date.getUTCDate();
    const months = index * (interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months + 1);
    date.setUTCDate(0);
    date.setUTCDate(Math.min(day, date.getUTCDate()));
  }
  return date.toISOString().slice(0, 10);
}

export function debtTotal(debt: DebtData): number {
  const end = dueDate(debt.firstDueDate, debt.interval, debt.installments - 1);
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${debt.startDate}T00:00:00Z`)) / 86_400_000;
  const denominator = BigInt(3_650_000); // 365 days and basis points per year
  const numerator = BigInt(debt.principal) * BigInt(debt.annualRate) * BigInt(days);
  return debt.principal + Number((numerator + denominator / BigInt(2)) / denominator);
}

export function debtSchedule(debt: DebtData) {
  const total = debtTotal(debt);
  const base = Math.floor(total / debt.installments);
  const remainder = total % debt.installments;
  return Array.from({ length: debt.installments }, (_, index) => ({
    date: dueDate(debt.firstDueDate, debt.interval, index),
    amount: base + (index < remainder ? 1 : 0),
  }));
}

export function validateDebt(debt: DebtData, validateId: (id: string) => void, validMoney: (amount: number) => void, validDate: (date: string) => void) {
  validateId(debt.id);
  if (typeof debt.name !== "string" || !debt.name.trim() || debt.name.length > 120) throw new Error("Debt or loan name is required (maximum 120 characters).");
  if (debt.direction !== "owed" && debt.direction !== "lent") throw new Error("Choose whether you owe or lent money.");
  validMoney(debt.principal);
  if (!debt.principal) throw new Error("Principal must be greater than zero.");
  if (!Number.isSafeInteger(debt.annualRate) || debt.annualRate < 0 || debt.annualRate > 100_000) throw new Error("Annual interest must be between 0% and 1000%, with at most two decimal places.");
  validDate(debt.startDate); validDate(debt.firstDueDate);
  if (debt.firstDueDate < debt.startDate) throw new Error("The first due date cannot be before the start date.");
  if (!Number.isSafeInteger(debt.installments) || debt.installments < 1 || debt.installments > 600) throw new Error("Choose between 1 and 600 payments.");
  if (!["weekly", "biweekly", "monthly", "quarterly", "yearly"].includes(debt.interval)) throw new Error("Choose a valid payment interval.");
  const end = dueDate(debt.firstDueDate, debt.interval, debt.installments - 1);
  validDate(end);
  const total = debtTotal(debt);
  validMoney(total);
  if (total < debt.installments) throw new Error("Each scheduled payment must be at least one cent.");
  if (!Array.isArray(debt.payments)) throw new Error("Invalid repayments.");
  let paid = 0;
  const ids = new Set<string>();
  for (const payment of debt.payments) {
    validateId(payment.id);
    if (ids.has(payment.id)) throw new Error("Duplicate repayment identifiers.");
    ids.add(payment.id);
    validDate(payment.date);
    if (payment.date < debt.startDate) throw new Error("A repayment cannot be before the start date.");
    validMoney(payment.amount);
    if (!payment.amount) throw new Error("Repayment must be greater than zero.");
    paid += payment.amount;
    if (!Number.isSafeInteger(paid) || paid > total) throw new Error("Repayments cannot exceed the total owed.");
  }
}
