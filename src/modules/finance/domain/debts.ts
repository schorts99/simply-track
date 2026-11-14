export type PaymentInterval = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export type InterestMode = "fixed" | "declining" | "compound";
export interface ScheduledPayment { date: string; amount: number; }
export interface DebtPayment { id: string; date: string; amount: number; transactionId?: string; }
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
  interestMode?: InterestMode;
  customSchedule?: ScheduledPayment[];
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

export function lastDueDate(debt: DebtData): string {
  return debt.customSchedule?.at(-1)?.date ?? dueDate(debt.firstDueDate, debt.interval, debt.installments - 1);
}

const denominator = BigInt(3_650_000);
const maxAmount = BigInt(1_000_000_000_000);

function rounded(value: bigint): bigint {
  return (value + denominator / BigInt(2)) / denominator;
}

function daysBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

function fixedTotal(debt: DebtData): number {
  const end = lastDueDate(debt);
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${debt.startDate}T00:00:00Z`)) / 86_400_000;
  const numerator = BigInt(debt.principal) * BigInt(debt.annualRate) * BigInt(days);
  return debt.principal + Number(rounded(numerator));
}

/**
 * Interest accrues in fractional cents until a repayment or capitalization;
 * those events round to cents. Compound capitalization precedes same-day payments.
 */
export function debtBalance(debt: DebtData, date: string, payments: readonly Pick<DebtPayment, "date" | "amount">[] = debt.payments, clamp = false, onPayment?: (payment: ScheduledPayment, applied: number, remaining: number) => void): number {
  if ((debt.interestMode ?? "fixed") === "fixed") {
    let remaining = fixedTotal(debt);
    for (const payment of [...payments].filter((item) => item.date <= date).sort((a, b) => a.date.localeCompare(b.date))) {
      if (!clamp && payment.amount > remaining) throw new Error("Repayments cannot exceed the total owed.");
      const applied = Math.min(remaining, payment.amount);
      remaining -= applied;
      onPayment?.(payment, applied, remaining);
    }
    return remaining;
  }
  if (date < debt.startDate) return debt.principal;
  let principal = BigInt(debt.principal);
  let interest = BigInt(0);
  let cursor = debt.startDate;
  let month = 1;
  const accrual = (end: string) => {
    interest += principal * BigInt(debt.annualRate) * BigInt(daysBetween(cursor, end));
    cursor = end;
    if (principal + rounded(interest) > maxAmount) throw new Error("The projected debt balance exceeds the supported range.");
  };
  const capitalize = (end: string) => {
    accrual(end);
    principal += rounded(interest);
    interest = BigInt(0);
  };
  const ordered = [...payments].filter((payment) => payment.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  for (const payment of ordered) {
    if (payment.date < debt.startDate) throw new Error("A repayment cannot be before the start date.");
    if (payment.amount === 0) { onPayment?.(payment, 0, Number(principal + rounded(interest))); continue; }
    if (debt.interestMode === "compound") {
      while (dueDate(debt.startDate, "monthly", month) <= payment.date) {
        capitalize(dueDate(debt.startDate, "monthly", month++));
      }
    }
    accrual(payment.date);
    const accrued = rounded(interest);
    let amount = BigInt(payment.amount);
    if (!clamp && amount > principal + accrued) throw new Error("Repayments cannot exceed the total owed.");
    if (amount > principal + accrued) amount = principal + accrued;
    const interestPaid = amount < accrued ? amount : accrued;
    interest = (accrued - interestPaid) * denominator;
    amount -= interestPaid;
    principal -= amount;
    onPayment?.(payment, Number(interestPaid + amount), Number(principal + rounded(interest)));
  }
  if (debt.interestMode === "compound") {
    while (dueDate(debt.startDate, "monthly", month) <= date) {
      capitalize(dueDate(debt.startDate, "monthly", month++));
    }
  }
  accrual(date);
  return Number(principal + rounded(interest));
}

function regularDates(debt: DebtData): string[] {
  return Array.from({ length: debt.installments }, (_, index) => dueDate(debt.firstDueDate, debt.interval, index));
}

export function debtSchedule(debt: DebtData): ScheduledPayment[] {
  if (debt.customSchedule) return debt.customSchedule.map((payment) => ({ ...payment }));
  const dates = regularDates(debt);
  if ((debt.interestMode ?? "fixed") !== "fixed") {
    const settles = (payments: ScheduledPayment[]) => {
      try { return debtBalance(debt, dates[dates.length - 1], payments, true) === 0; }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "The projected debt balance exceeds the supported range.") throw error;
        return false;
      }
    };
    let low = 1;
    let high = 1_000_000_000_000;
    while (low < high) {
      const amount = Math.floor((low + high) / 2);
      if (settles(dates.map((date) => ({ date, amount })))) high = amount;
      else low = amount + 1;
    }
    let first = 0;
    let last = dates.length;
    while (first < last) {
      const count = Math.floor((first + last) / 2);
      if (settles(dates.map((date, index) => ({ date, amount: low - 1 + (index < count ? 1 : 0) })))) last = count;
      else first = count + 1;
    }
    const schedule: ScheduledPayment[] = [];
    debtBalance(debt, dates[dates.length - 1], dates.map((date, index) => ({ date, amount: low - 1 + (index < first ? 1 : 0) })), true, (payment, amount) => schedule.push({ date: payment.date, amount }));
    return schedule;
  }
  const total = fixedTotal(debt);
  const base = Math.floor(total / debt.installments);
  const remainder = total % debt.installments;
  return dates.map((date, index) => ({
    date,
    amount: base + (index < remainder ? 1 : 0),
  }));
}

export function debtTotal(debt: DebtData): number {
  return (debt.interestMode ?? "fixed") === "fixed"
    ? fixedTotal(debt)
    : debtSchedule(debt).reduce((sum, payment) => sum + payment.amount, 0);
}

function unpaidSchedule(debt: DebtData, asOf: string): ScheduledPayment[] {
  let paid = debt.payments.filter((payment) => payment.date <= asOf).reduce((sum, payment) => sum + payment.amount, 0);
  return debtSchedule(debt).map((payment) => {
    const applied = Math.min(paid, payment.amount);
    paid -= applied;
    return { ...payment, amount: payment.amount - applied };
  });
}

export function plannedBalance(debt: DebtData, asOf: string, extra?: ScheduledPayment): { balance: number; totalPaid: number; payoffDate: string | null; extraApplied: number; end: string } {
  const actual = debt.payments.filter((payment) => payment.date <= asOf);
  const knownFuture = debt.payments.filter((payment) => payment.date > asOf).sort((a, b) => a.date.localeCompare(b.date));
  const schedule = unpaidSchedule(debt, asOf);
  let overdue = schedule.filter((payment) => payment.date <= asOf).reduce((sum, payment) => sum + payment.amount, 0);
  const future = schedule.filter((payment) => payment.date > asOf);
  for (const payment of knownFuture) {
    let credit = payment.amount;
    const arrears = Math.min(overdue, credit);
    overdue -= arrears;
    credit -= arrears;
    for (const item of future) {
      const applied = Math.min(item.amount, credit);
      item.amount -= applied;
      credit -= applied;
      if (!credit) break;
    }
  }
  const events = [...actual, ...knownFuture, ...(extra ? [extra] : []), ...future].sort((a, b) => a.date.localeCompare(b.date));
  let totalPaid = 0;
  let extraApplied = 0;
  let payoffDate: string | null = null;
  const end = [asOf, lastDueDate(debt), extra?.date ?? asOf, ...knownFuture.map((payment) => payment.date)].sort().at(-1)!;
  const balance = debtBalance(debt, end, events, true, (payment, amount, remaining) => {
    totalPaid += amount;
    if (payment === extra) extraApplied = amount;
    if (amount && remaining === 0 && payoffDate === null) payoffDate = payment.date;
  });
  return { balance, totalPaid, payoffDate, extraApplied, end };
}

export function debtPlanOutstanding(debt: DebtData, asOf: string): { schedule: ScheduledPayment[]; balloon: number } {
  const actual = debt.payments.filter((payment) => payment.date <= asOf);
  const schedule = unpaidSchedule(debt, asOf);
  const projected = schedule.map((payment) => ({ date: payment.date < asOf ? asOf : payment.date, amount: payment.amount }));
  const indexes = new Map(projected.map((payment, index) => [payment, index]));
  const end = lastDueDate(debt) < asOf ? asOf : lastDueDate(debt);
  const balloon = debtBalance(debt, end, [...actual, ...projected], true, (payment, amount) => {
    const index = indexes.get(payment);
    if (index !== undefined) schedule[index].amount = amount;
  });
  return { schedule: schedule.filter((payment) => payment.amount > 0), balloon };
}

export function outstandingSchedule(debt: DebtData, asOf: string): (ScheduledPayment & { estimated?: boolean })[] {
  const result = debtPlanOutstanding(debt, asOf);
  return result.balloon ? [...result.schedule, { date: lastDueDate(debt), amount: result.balloon, estimated: true }] : result.schedule;
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
  if (debt.interestMode !== undefined && !["fixed", "declining", "compound"].includes(debt.interestMode)) throw new Error("Choose a valid interest method.");
  if (debt.customSchedule !== undefined) {
    if (!Array.isArray(debt.customSchedule) || debt.customSchedule.length < 1 || debt.customSchedule.length > 600) throw new Error("Choose between 1 and 600 payments.");
    let previous = debt.startDate;
    for (const payment of debt.customSchedule) {
      validDate(payment.date); validMoney(payment.amount);
      if (payment.date < previous) throw new Error("Scheduled dates must be on or after the start date and in order.");
      if (!payment.amount) throw new Error("Scheduled payments must be greater than zero.");
      previous = payment.date;
    }
  }
  const end = lastDueDate(debt);
  validDate(end);
  if ((debt.interestMode ?? "fixed") === "fixed") {
    const total = fixedTotal(debt);
    validMoney(total);
    if (!debt.customSchedule && total < debt.installments) throw new Error("Each scheduled payment must be at least one cent.");
  } else {
    const schedule = debtSchedule(debt);
    if (!debt.customSchedule && schedule.some((payment) => payment.amount === 0)) throw new Error("Each scheduled payment must be at least one cent.");
    debtBalance(debt, end, schedule, true);
  }
  if (!Array.isArray(debt.payments)) throw new Error("Invalid repayments.");
  const ids = new Set<string>();
  let paid = 0;
  for (const payment of debt.payments) {
    validateId(payment.id);
    if (ids.has(payment.id)) throw new Error("Duplicate repayment identifiers.");
    ids.add(payment.id);
    validDate(payment.date);
    if (payment.date < debt.startDate) throw new Error("A repayment cannot be before the start date.");
    validMoney(payment.amount);
    if (!payment.amount) throw new Error("Repayment must be greater than zero.");
    paid += payment.amount;
    if (!Number.isSafeInteger(paid)) throw new Error("The projected debt balance exceeds the supported range.");
  }
  if (debt.payments.length) debtBalance(debt, [...debt.payments].sort((a, b) => b.date.localeCompare(a.date))[0].date);
}
