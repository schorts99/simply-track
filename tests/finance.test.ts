import { describe, expect, it } from "vitest";
import { FinanceBook, emptyState, forecast, localDate, money, monthSummary, type TransactionData } from "../src/modules/finance/domain/finance";

function transaction(overrides: Partial<TransactionData> = {}): TransactionData {
  return { id: crypto.randomUUID(), title: "Lunch", amount: 1450, type: "expense", category: "Food & Dining", date: "2026-10-20", paymentMethod: "Card", notes: "", recurring: false, ...overrides };
}
describe("FinanceBook", () => {
  it("uses exact integer minor units and rejects excessive precision", () => {
    expect(money("0.29")).toBe(29);
    expect(money("-12.30")).toBe(-1230);
    expect(() => money("1.234")).toThrow("two decimal");
    expect(() => money("Infinity")).toThrow();
    expect(() => money("1e5")).toThrow();
  });
  it("enforces transaction invariants and emits a sequenced event", () => {
    const book = new FinanceBook(emptyState());
    book.execute({ type: "transaction.save", data: transaction() });
    const events = book.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].getEventName()).toBe("finance.changed");
    expect(events[0].sequenceNumber).toBe(1);
    expect(book.toPrimitives().version).toBe(1);
    expect(book.toPrimitives().transactions[0].amount).toBe(1450);
    expect(() => new FinanceBook(emptyState()).execute({ type: "transaction.save", data: transaction({ amount: 1.5 }) })).toThrow();
    expect(() => new FinanceBook(emptyState()).execute({ type: "transaction.save", data: transaction({ date: "2026-02-30" }) })).toThrow();
    expect(() => new FinanceBook(emptyState()).execute({ type: "transaction.save", data: transaction({ type: "income" }) })).toThrow();
  });
  it("supports edits and deletes without mutating the input snapshot", () => {
    const original = emptyState();
    const book = new FinanceBook(original);
    const data = transaction();
    book.execute({ type: "transaction.save", data });
    book.execute({ type: "transaction.save", data: { ...data, title: "Dinner", amount: 2000 } });
    expect(book.toPrimitives().transactions).toHaveLength(1);
    expect(original.transactions).toEqual([]);
    book.execute({ type: "transaction.delete", id: data.id });
    expect(book.toPrimitives().transactions).toEqual([]);
    expect(() => book.execute({ type: "transaction.delete", id: data.id })).toThrow("no longer exists");
  });
  it("prevents duplicate budgets and invalid goals", () => {
    const state = emptyState();
    state.budgets = [{ id: crypto.randomUUID(), category: "Groceries", limit: 10000 }, { id: crypto.randomUUID(), category: "Groceries", limit: 1000 }];
    expect(() => new FinanceBook(state)).toThrow("one budget");
    expect(() => new FinanceBook(emptyState()).execute({ type: "goal.save", data: { id: crypto.randomUUID(), name: "Trip", saved: -1, target: 10000, date: "2027-01-01" } })).toThrow();
  });
  it("leaves a reusable aggregate unchanged after rejection and owns its record data", () => {
    const book = new FinanceBook(emptyState());
    const budget = { id: crypto.randomUUID(), category: "Groceries", limit: 10000 };
    book.execute({ type: "budget.save", data: budget });
    budget.limit = -1;
    const before = book.toPrimitives();
    expect(before.budgets[0].limit).toBe(10000);
    expect(() => book.execute({ type: "budget.save", data: { ...budget, id: crypto.randomUUID(), limit: 20000 } })).toThrow("one budget");
    expect(book.toPrimitives()).toEqual(before);
    expect(book.pullDomainEvents()).toHaveLength(1);
  });
  it("filters monthly totals and forecasts without modifying actual records", () => {
    const state = emptyState();
    state.transactions = [
      transaction(),
      transaction({ title: "Rent", amount: 100000, recurring: true, category: "Housing & Rent" }),
      transaction({ amount: 300000, type: "income", category: "Salary & Wages" }),
      transaction({ amount: 10000, date: "2026-11-01" }),
    ];
    expect(monthSummary(state, "2026-10")).toMatchObject({ income: 300000, expense: 101450, net: 198550 });
    const rows = forecast(state, "2026-10", { id: crypto.randomUUID(), name: "Cut back", incomeChange: 10000, expensePercent: -10 });
    expect(rows[0]).toMatchObject({ month: "2026-11", income: 310000, expense: 91305, net: 218695, balance: 417245 });
    expect(rows[5].balance).toBe(198550 + 218695 * 6);
    expect(state.transactions).toHaveLength(4);
  });
  it("formats calendar dates in the device's local timezone", () => {
    const date = new Date(2026, 9, 22, 23, 59);
    expect(localDate(date)).toBe("2026-10-22");
  });
});
