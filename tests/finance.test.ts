import { describe, expect, it } from "vitest";
import { FinanceBook, emptyState, forecast, localDate, money, monthSummary, type TransactionData } from "../src/modules/finance/domain/finance";
import { debtSchedule, debtTotal, type DebtData } from "../src/modules/finance/domain/debts";

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

  describe("debts and loans", () => {
    function debt(overrides: Partial<DebtData> = {}): DebtData {
      return { id: crypto.randomUUID(), name: "Loan", direction: "owed", principal: 100_000, annualRate: 1200, startDate: "2026-01-01", firstDueDate: "2026-02-28", installments: 6, interval: "monthly", payments: [], ...overrides };
    }
    it("calculates fixed simple interest and even schedules with month-end clamping", () => {
      const loan = debt({ firstDueDate: "2026-01-31", installments: 3 });
      expect(debtTotal(loan)).toBe(102_926);
      expect(debtSchedule(loan)).toEqual([
        { date: "2026-01-31", amount: 34_309 },
        { date: "2026-02-28", amount: 34_309 },
        { date: "2026-03-31", amount: 34_308 },
      ]);
      expect(debtSchedule(debt({ firstDueDate: "2028-02-29", startDate: "2028-01-01", installments: 2, interval: "yearly" }))[1].date).toBe("2029-02-28");
      expect(debtSchedule(debt({ installments: 2, interval: "biweekly" }))[1].date).toBe("2026-03-14");
    });
    it("tracks repayments independently and rejects invalid edits without changing state", () => {
      const book = new FinanceBook(emptyState());
      const loan = debt({ installments: 1 });
      book.execute({ type: "debt.save", data: loan });
      const payment = { id: crypto.randomUUID(), date: "2026-02-01", amount: 50_000 };
      book.execute({ type: "debt.payment.save", debtId: loan.id, data: payment });
      const before = book.toPrimitives();
      expect(before.transactions).toEqual([]);
      expect(() => book.execute({ type: "debt.payment.save", debtId: loan.id, data: { ...payment, amount: 200_000 } })).toThrow("cannot exceed");
      expect(() => book.execute({ type: "debt.save", data: { ...before.debts[0], principal: 1 } })).toThrow();
      expect(book.toPrimitives()).toEqual(before);
      book.execute({ type: "debt.payment.delete", debtId: loan.id, id: payment.id });
      expect(book.toPrimitives().debts[0].payments).toEqual([]);
      book.execute({ type: "debt.delete", id: loan.id });
      expect(book.toPrimitives().debts).toEqual([]);
    });
    it("validates dates, rates and schedules", () => {
      for (const invalid of [
        debt({ firstDueDate: "2025-12-31" }),
        debt({ annualRate: 1.5 }),
        debt({ installments: 0 }),
        debt({ principal: 1, installments: 2, annualRate: 0 }),
        debt({ payments: [{ id: crypto.randomUUID(), date: "2025-12-31", amount: 1 }] }),
      ]) {
        expect(() => new FinanceBook(emptyState()).execute({ type: "debt.save", data: invalid })).toThrow();
      }
    });
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
