import { AggregateRoot } from "@schorts/shared-kernel/aggregates";
import { DomainEvent } from "@schorts/shared-kernel/domain-events";
import { Entity } from "@schorts/shared-kernel/entities";
import { UUIDValue } from "@schorts/shared-kernel/value-objects";
import { defaultSettings, restoreSettings, validateSettings, type Settings } from "./settings";
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
  settings: Settings;
}
export type Command =
  | { type: "transaction.save"; data: TransactionData }
  | { type: "transaction.delete"; id: string }
  | { type: "budget.save"; data: BudgetData }
  | { type: "budget.delete"; id: string }
  | { type: "goal.save"; data: GoalData }
  | { type: "goal.delete"; id: string }
  | { type: "scenario.save"; data: ScenarioData }
  | { type: "scenario.delete"; id: string }
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
    transactions: [], budgets: [], goals: [], scenarios: [],
    settings: defaultSettings(),
  };
}

export class FinanceBook extends AggregateRoot<FinanceId> {
  private readonly state: FinanceState;
  constructor(state: FinanceState) {
    super(new FinanceId(state.id), state.version);
    this.state = structuredClone(state);
    this.state.settings = restoreSettings(state.settings);
    this.validateInvariants();
  }
  protected validateInvariants() {
    const s = this.state;
    validateId(s.id);
    validateId(s.revision);
    if (!Number.isSafeInteger(s.version) || s.version < 0) throw new Error("Invalid book version.");
    validateSettings(s.settings);
    s.transactions.forEach((t) => new Transaction(t, s.settings));
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
    for (const collection of [s.transactions, s.budgets, s.goals, s.scenarios]) {
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
        const categories = data.type === "expense" ? this.state.settings.expenseCategories : this.state.settings.incomeCategories;
        if (!categories.some((item) => item.id === data.category && (item.active || (existing?.category === data.category && existing.type === data.type)))) throw new Error("Choose an active category.");
        if (!this.state.settings.paymentMethods.some((item) => item.id === data.paymentMethod && (item.active || existing?.paymentMethod === data.paymentMethod))) throw new Error("Choose an active payment method.");
        this.state.transactions = upsert(this.state.transactions, new Transaction(data, this.state.settings).toPrimitives()); break;
      }
      case "transaction.delete": this.state.transactions = remove(this.state.transactions, command.id); break;
      case "budget.save":
        if (!this.state.settings.expenseCategories.some((item) => item.id === command.data.category && (item.active || this.state.budgets.some((budget) => budget.id === command.data.id && budget.category === item.id)))) throw new Error("Choose an active category.");
        this.state.budgets = upsert(this.state.budgets, command.data); break;
      case "budget.delete": this.state.budgets = remove(this.state.budgets, command.id); break;
      case "goal.save": this.state.goals = upsert(this.state.goals, command.data); break;
      case "goal.delete": this.state.goals = remove(this.state.goals, command.id); break;
      case "scenario.save": this.state.scenarios = upsert(this.state.scenarios, command.data); break;
      case "scenario.delete": this.state.scenarios = remove(this.state.scenarios, command.id); break;
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
  const current = monthSummary(state, month);
  const income = Math.max(0, (state.settings.incomeBaseline || current.income) + (scenario?.incomeChange ?? 0));
  const recurringExpense = state.transactions.filter((t) => t.type === "expense" && t.recurring && t.date.slice(0, 7) <= month).reduce((a, t) => a + t.amount, 0);
  const expense = Math.round((state.settings.expenseBaseline ?? Math.max(current.expense, recurringExpense)) * (1 + (scenario?.expensePercent ?? 0) / 100));
  const balance = state.settings.openingBalance + state.transactions.filter((t) => t.date.slice(0, 7) <= month).reduce((a, t) => a + (t.type === "income" ? t.amount : -t.amount), 0);
  const [year, m] = month.split("-").map(Number);
  return Array.from({ length: state.settings.forecastMonths }, (_, i) => ({
    month: localDate(new Date(year, m + i, 1)).slice(0, 7),
    income, expense, net: income - expense, balance: balance + (income - expense) * (i + 1),
  }));
}
