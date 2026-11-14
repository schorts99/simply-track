import { AggregateRoot } from "@schorts/shared-kernel/aggregates";
import { DomainEvent } from "@schorts/shared-kernel/domain-events";
import { Entity } from "@schorts/shared-kernel/entities";
import { UUIDValue } from "@schorts/shared-kernel/value-objects";
import { defaultSettings, restoreSettings, validateSettings, type Settings } from "./settings";
import { forecastDebtPayments, validateDebt, type DebtData, type DebtPayment } from "./debts";
import type { AccountData, TransferData } from "./accounts";
import { isOccurrence, type ScheduleData } from "./schedules";
export { expenseCategories, incomeCategories, defaultSettings } from "./settings";
export type { Settings } from "./settings";

export type TransactionType = "expense" | "income";
export interface TransactionData {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  date: string;
  paymentMethod: string;
  notes: string;
  recurring: boolean;
  accountId?: string;
  scheduleId?: string;
  occurrenceDate?: string;
}
export interface BudgetData { id: string; category: string; limit: number; }
export interface GoalData { id: string; name: string; target: number; saved: number; date: string; }
export interface ScenarioData { id: string; name: string; incomeChange: number; expensePercent: number; }
export interface FinanceState {
  id: string;
  revision: string;
  version: number;
  transactions: TransactionData[];
  budgets: BudgetData[];
  goals: GoalData[];
  scenarios: ScenarioData[];
  debts: DebtData[];
  accounts: AccountData[];
  transfers: TransferData[];
  schedules: ScheduleData[];
  settings: Settings;
}
export type Command =
  | { type: "transaction.save"; data: TransactionData }
  | { type: "transaction.delete"; id: string }
  | { type: "transaction.import"; data: TransactionData[] }
  | { type: "account.save"; data: AccountData }
  | { type: "account.delete"; id: string }
  | { type: "transfer.save"; data: TransferData }
  | { type: "transfer.delete"; id: string }
  | { type: "schedule.save"; data: ScheduleData }
  | { type: "schedule.delete"; id: string }
  | { type: "schedule.confirm"; id: string; date: string; transactionId: string }
  | { type: "budget.save"; data: BudgetData }
  | { type: "budget.delete"; id: string }
  | { type: "goal.save"; data: GoalData }
  | { type: "goal.delete"; id: string }
  | { type: "scenario.save"; data: ScenarioData }
  | { type: "scenario.delete"; id: string }
  | { type: "debt.save"; data: DebtData }
  | { type: "debt.delete"; id: string }
  | { type: "debt.payment.save"; debtId: string; data: DebtPayment }
  | { type: "debt.payment.delete"; debtId: string; id: string }
  | { type: "settings.save"; data: Settings };

export class FinanceId extends UUIDValue { readonly attributeName = "financeId"; }
export class FinanceChanged extends DomainEvent<{ revision: string; command: Command["type"] }> {
  getEventName() { return "finance.changed"; }
}

export function money(value: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter an amount with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().replace("-", "").split(".");
  const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) * (value.trim().startsWith("-") ? -1 : 1);
  validMoney(cents, true);
  return cents;
}
function validMoney(value: number, signed = false) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000_000 || (!signed && value < 0)) {
    throw new Error("Amount must be a valid monetary value within the supported range.");
  }
}
function text(value: string, label: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error("Choose a valid date.");
  }
}
function validateId(value: string) { if (!new FinanceId(value).isValid) throw new Error("Invalid identifier."); }
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export class Transaction extends Entity<FinanceId, TransactionData> {
  constructor(private readonly data: TransactionData, settings: Settings = defaultSettings()) {
    super(new FinanceId(data.id));
    validateId(data.id);
    text(data.title, "Title");
    validMoney(data.amount);
    if (data.amount === 0) throw new Error("The amount must be greater than zero.");
    const categories = data.type === "expense" ? settings.expenseCategories : data.type === "income" ? settings.incomeCategories : [];
    if (!categories.some((item) => item.id === data.category)) throw new Error("Choose a category matching the transaction type.");
    validDate(data.date);
    if (!settings.paymentMethods.some((item) => item.id === data.paymentMethod)) throw new Error("Choose a valid payment method.");
    if (typeof data.notes !== "string" || data.notes.length > 1000 || typeof data.recurring !== "boolean") throw new Error("Invalid transaction details.");
  }
  toPrimitives(): TransactionData { return { ...this.data, title: this.data.title.trim() }; }
}

export function emptyState(): FinanceState {
  return {
    id: crypto.randomUUID(), revision: crypto.randomUUID(), version: 0,
    transactions: [], budgets: [], goals: [], scenarios: [], debts: [], accounts: [], transfers: [], schedules: [],
    settings: defaultSettings(),
  };
}

export class FinanceBook extends AggregateRoot<FinanceId> {
  private readonly state: FinanceState;
  constructor(state: FinanceState) {
    super(new FinanceId(state.id), state.version);
    this.state = structuredClone(state);
    if (this.state.debts === undefined) this.state.debts = [];
    if (this.state.accounts === undefined) this.state.accounts = [];
    if (this.state.transfers === undefined) this.state.transfers = [];
    if (this.state.schedules === undefined) this.state.schedules = [];
    this.state.settings = restoreSettings(state.settings);
    this.validateInvariants();
  }
  protected validateInvariants() {
    const s = this.state;
    validateId(s.id);
    validateId(s.revision);
    if (!Number.isSafeInteger(s.version) || s.version < 0) throw new Error("Invalid book version.");
    validateSettings(s.settings);
    s.accounts.forEach((account) => { validateId(account.id); text(account.name, "Account name"); validMoney(account.openingBalance, true); validDate(account.openingDate); });
    if (new Set(s.accounts.map((account) => account.name.trim().toLocaleLowerCase())).size !== s.accounts.length) throw new Error("Account names must be unique.");
    s.transactions.forEach((t) => {
      new Transaction(t, s.settings);
      if (t.accountId !== undefined) {
        const account = s.accounts.find((item) => item.id === t.accountId);
        if (!account || t.date < account.openingDate) throw new Error("Choose an existing account opened on or before the transaction date.");
      }
    });
    s.transfers.forEach((transfer) => {
      validateId(transfer.id); validMoney(transfer.amount); validDate(transfer.date);
      if (!transfer.amount) throw new Error("Transfer amount must be greater than zero.");
      const from = s.accounts.find((account) => account.id === transfer.fromAccountId);
      const to = s.accounts.find((account) => account.id === transfer.toAccountId);
      if (!from || !to || from.id === to.id || transfer.date < from.openingDate || transfer.date < to.openingDate) throw new Error("Choose two different accounts opened on or before the transfer date.");
      if (typeof transfer.notes !== "string" || transfer.notes.length > 1000) throw new Error("Invalid transfer details.");
    });
    s.schedules.forEach((schedule) => {
      validateId(schedule.id); text(schedule.title, "Title"); validMoney(schedule.amount); validDate(schedule.firstDate);
      if (!schedule.amount) throw new Error("The amount must be greater than zero.");
      if (schedule.endDate !== undefined) { validDate(schedule.endDate); if (schedule.endDate < schedule.firstDate) throw new Error("The end date cannot be before the first date."); }
      if (!["weekly", "biweekly", "monthly", "quarterly", "yearly"].includes(schedule.interval) || typeof schedule.active !== "boolean") throw new Error("Invalid recurring schedule.");
      const categories = schedule.type === "expense" ? s.settings.expenseCategories : schedule.type === "income" ? s.settings.incomeCategories : [];
      if (!categories.some((item) => item.id === schedule.category) || !s.settings.paymentMethods.some((item) => item.id === schedule.paymentMethod)) throw new Error("Choose a valid category and payment method for the schedule.");
      if (schedule.accountId !== undefined) {
        const account = s.accounts.find((item) => item.id === schedule.accountId);
        if (!account || schedule.firstDate < account.openingDate) throw new Error("Choose an existing account opened on or before the first date.");
      }
    });
    const occurrences = new Set<string>();
    for (const transaction of s.transactions) {
      if (transaction.scheduleId === undefined && transaction.occurrenceDate === undefined) continue;
      if (!transaction.scheduleId || !transaction.occurrenceDate || !s.schedules.some((schedule) => schedule.id === transaction.scheduleId)) throw new Error("Invalid recurring transaction reference.");
      validDate(transaction.occurrenceDate);
      const key = `${transaction.scheduleId}:${transaction.occurrenceDate}`;
      if (occurrences.has(key)) throw new Error("This occurrence has already been recorded.");
      occurrences.add(key);
    }
    s.budgets.forEach((b) => {
      validateId(b.id);
      if (!s.settings.expenseCategories.some((item) => item.id === b.category)) throw new Error("Choose an expense category.");
      validMoney(b.limit);
      if (b.limit === 0) throw new Error("Budget limit must be greater than zero.");
    });
    if (new Set(s.budgets.map((b) => b.category)).size !== s.budgets.length) throw new Error("Only one budget per category is allowed.");
    s.goals.forEach((g) => {
      validateId(g.id); text(g.name, "Goal name"); validMoney(g.target); validMoney(g.saved); validDate(g.date);
      if (g.target === 0) throw new Error("Goal target must be greater than zero.");
    });
    s.scenarios.forEach((v) => {
      validateId(v.id); text(v.name, "Scenario name"); validMoney(v.incomeChange, true);
      if (!Number.isFinite(v.expensePercent) || v.expensePercent < -100 || v.expensePercent > 1000) throw new Error("Expense adjustment must be between -100% and 1000%.");
    });
    s.debts.forEach((debt) => validateDebt(debt, validateId, validMoney, validDate));
    const linkedTransactions = new Set<string>();
    for (const debt of s.debts) for (const payment of debt.payments) {
      if (payment.transactionId === undefined) continue;
      const transaction = s.transactions.find((item) => item.id === payment.transactionId);
      if (!transaction || transaction.type !== (debt.direction === "owed" ? "expense" : "income") || transaction.amount !== payment.amount || transaction.date !== payment.date) {
        throw new Error("Linked transactions must match the repayment's date, amount and direction. Unlink the repayment before changing or deleting the transaction.");
      }
      if (linkedTransactions.has(transaction.id)) throw new Error("A transaction can only be linked to one repayment.");
      linkedTransactions.add(transaction.id);
    }
    for (const collection of [s.transactions, s.budgets, s.goals, s.scenarios, s.debts, s.accounts, s.transfers, s.schedules]) {
      if (new Set(collection.map((v) => v.id)).size !== collection.length) throw new Error("Duplicate record identifiers.");
    }
  }
  execute(command: Command) {
    const previous = structuredClone(this.state);
    const upsert = <T extends { id: string }>(items: T[], data: T): T[] => [...items.filter((v) => v.id !== data.id), structuredClone(data)];
    const remove = <T extends { id: string }>(items: T[], id: string): T[] => {
      if (!items.some((v) => v.id === id)) throw new Error("The record no longer exists.");
      return items.filter((v) => v.id !== id);
    };
    try {
      switch (command.type) {
      case "transaction.save": {
        const data = command.data;
        const existing = this.state.transactions.find((item) => item.id === data.id);
        if (data.scheduleId !== existing?.scheduleId || data.occurrenceDate !== existing?.occurrenceDate) throw new Error("Recurring occurrence references cannot be changed.");
        const categories = data.type === "expense" ? this.state.settings.expenseCategories : this.state.settings.incomeCategories;
        if (!categories.some((item) => item.id === data.category && (item.active || (existing?.category === data.category && existing.type === data.type)))) throw new Error("Choose an active category.");
        if (!this.state.settings.paymentMethods.some((item) => item.id === data.paymentMethod && (item.active || existing?.paymentMethod === data.paymentMethod))) throw new Error("Choose an active payment method.");
        this.state.transactions = upsert(this.state.transactions, new Transaction(data, this.state.settings).toPrimitives()); break;
      }
      case "transaction.delete": this.state.transactions = remove(this.state.transactions, command.id); break;
      case "transaction.import": {
        if (!command.data.length) throw new Error("Select at least one transaction to import.");
        const ids = new Set(this.state.transactions.map((item) => item.id));
        for (const data of command.data) {
          if (ids.has(data.id)) throw new Error("Duplicate record identifiers.");
          ids.add(data.id);
          const categories = data.type === "income" ? this.state.settings.incomeCategories : this.state.settings.expenseCategories;
          if (!categories.some((item) => item.id === data.category && item.active) || !this.state.settings.paymentMethods.some((item) => item.id === data.paymentMethod && item.active)) throw new Error("CSV rows must use active categories and payment methods.");
          if (data.scheduleId !== undefined || data.occurrenceDate !== undefined) throw new Error("CSV transactions cannot contain schedule references.");
          this.state.transactions.push(new Transaction(data, this.state.settings).toPrimitives());
        }
        break;
      }
      case "account.save": this.state.accounts = upsert(this.state.accounts, { ...command.data, name: command.data.name.trim() }); break;
      case "account.delete":
        if (this.state.transactions.some((item) => item.accountId === command.id) || this.state.transfers.some((item) => item.fromAccountId === command.id || item.toAccountId === command.id) || this.state.schedules.some((item) => item.accountId === command.id)) throw new Error("Move or remove this account's transactions, transfers and schedules before deleting it.");
        this.state.accounts = remove(this.state.accounts, command.id); break;
      case "transfer.save": this.state.transfers = upsert(this.state.transfers, command.data); break;
      case "transfer.delete": this.state.transfers = remove(this.state.transfers, command.id); break;
      case "schedule.save": this.state.schedules = upsert(this.state.schedules, { ...command.data, title: command.data.title.trim() }); break;
      case "schedule.delete":
        this.state.schedules = remove(this.state.schedules, command.id);
        this.state.transactions = this.state.transactions.map((transaction) => {
          if (transaction.scheduleId !== command.id) return transaction;
          const record = { ...transaction };
          delete record.scheduleId; delete record.occurrenceDate;
          return record;
        }); break;
      case "schedule.confirm": {
        const schedule = this.state.schedules.find((item) => item.id === command.id);
        validDate(command.date);
        if (!schedule || !schedule.active || !isOccurrence(schedule, command.date) || command.date > localDate()) throw new Error("Choose an active occurrence that is due.");
        if (this.state.transactions.some((item) => item.scheduleId === schedule.id && item.occurrenceDate === command.date)) throw new Error("This occurrence has already been recorded.");
        if (this.state.transactions.some((item) => item.id === command.transactionId)) throw new Error("Duplicate record identifiers.");
        const categories = schedule.type === "expense" ? this.state.settings.expenseCategories : this.state.settings.incomeCategories;
        if (!categories.some((item) => item.id === schedule.category && item.active) || !this.state.settings.paymentMethods.some((item) => item.id === schedule.paymentMethod && item.active)) throw new Error("Choose an active category and payment method for the schedule.");
        const data: TransactionData = { id: command.transactionId, title: schedule.title, amount: schedule.amount, type: schedule.type, category: schedule.category, paymentMethod: schedule.paymentMethod, date: command.date, notes: "", recurring: false, accountId: schedule.accountId, scheduleId: schedule.id, occurrenceDate: command.date };
        this.state.transactions = upsert(this.state.transactions, new Transaction(data, this.state.settings).toPrimitives()); break;
      }
      case "budget.save":
        if (!this.state.settings.expenseCategories.some((item) => item.id === command.data.category && (item.active || this.state.budgets.some((budget) => budget.id === command.data.id && budget.category === item.id)))) throw new Error("Choose an active category.");
        this.state.budgets = upsert(this.state.budgets, command.data); break;
      case "budget.delete": this.state.budgets = remove(this.state.budgets, command.id); break;
      case "goal.save": this.state.goals = upsert(this.state.goals, command.data); break;
      case "goal.delete": this.state.goals = remove(this.state.goals, command.id); break;
      case "scenario.save": this.state.scenarios = upsert(this.state.scenarios, command.data); break;
      case "scenario.delete": this.state.scenarios = remove(this.state.scenarios, command.id); break;
      case "debt.save": this.state.debts = upsert(this.state.debts, { ...command.data, name: command.data.name.trim() }); break;
      case "debt.delete": this.state.debts = remove(this.state.debts, command.id); break;
      case "debt.payment.save": {
        const debt = this.state.debts.find((item) => item.id === command.debtId);
        if (!debt) throw new Error("The record no longer exists.");
        debt.payments = upsert(debt.payments, command.data); break;
      }
      case "debt.payment.delete": {
        const debt = this.state.debts.find((item) => item.id === command.debtId);
        if (!debt) throw new Error("The record no longer exists.");
        debt.payments = remove(debt.payments, command.id); break;
      }
      case "settings.save": this.state.settings = structuredClone(command.data); break;
      }
      this.validateInvariants();
    } catch (error) {
      Object.assign(this.state, previous);
      throw error;
    }
    this.state.revision = crypto.randomUUID();
    this.recordDomainEvent(new FinanceChanged(this.state.id, { revision: this.state.revision, command: command.type }));
    this.state.version = this.version;
  }
  toPrimitives(): FinanceState { return structuredClone(this.state); }
}

export function monthSummary(state: FinanceState, month: string) {
  const entries = state.transactions.filter((t) => t.date.startsWith(month));
  const income = entries.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const expense = entries.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  const byCategory = Object.fromEntries(state.settings.expenseCategories.map(({ id }) => [id, entries.filter((t) => t.type === "expense" && t.category === id).reduce((a, t) => a + t.amount, 0)]));
  return { income, expense, net: income - expense, byCategory };
}

export function forecast(state: FinanceState, month: string, scenario?: ScenarioData) {
  const linked = new Set(state.debts.flatMap((debt) => debt.payments.flatMap((payment) => payment.transactionId ? [payment.transactionId] : [])));
  const baselineState = state.settings.includeDebtForecast ? { ...state, transactions: state.transactions.filter((item) => !linked.has(item.id)) } : state;
  const current = monthSummary(baselineState, month);
  const income = Math.max(0, (state.settings.incomeBaseline || current.income) + (scenario?.incomeChange ?? 0));
  const recurringExpense = baselineState.transactions.filter((t) => t.type === "expense" && t.recurring && t.date.slice(0, 7) <= month).reduce((a, t) => a + t.amount, 0);
  const expense = Math.round((state.settings.expenseBaseline ?? Math.max(current.expense, recurringExpense)) * (1 + (scenario?.expensePercent ?? 0) / 100));
  const balance = state.settings.openingBalance + state.transactions.filter((t) => t.date.slice(0, 7) <= month).reduce((a, t) => a + (t.type === "income" ? t.amount : -t.amount), 0);
  const [year, m] = month.split("-").map(Number);
  const asOf = localDate(new Date(year, m, 0));
  const projected = state.settings.includeDebtForecast ? state.debts.flatMap((debt) => forecastDebtPayments(debt, asOf).map((payment) => ({ ...payment, direction: debt.direction }))) : [];
  let running = balance;
  return Array.from({ length: state.settings.forecastMonths }, (_, i) => {
    const target = localDate(new Date(year, m + i, 1)).slice(0, 7);
    const debts = projected.filter((payment) => payment.date.slice(0, 7) === target || (i === 0 && payment.date <= asOf));
    const rowIncome = income + debts.filter((payment) => payment.direction === "lent").reduce((sum, payment) => sum + payment.amount, 0);
    const rowExpense = expense + debts.filter((payment) => payment.direction === "owed").reduce((sum, payment) => sum + payment.amount, 0);
    const net = rowIncome - rowExpense;
    running += net;
    return { month: target, income: rowIncome, expense: rowExpense, net, balance: running };
  });
}
