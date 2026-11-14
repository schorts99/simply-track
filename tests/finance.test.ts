import { describe, expect, it } from "vitest";
import { FinanceBook, emptyState, forecast, localDate, money, monthSummary, type TransactionData } from "../src/modules/finance/domain/finance";
import { debtBalance, debtSchedule, debtTotal, outstandingSchedule, plannedBalance, type DebtData } from "../src/modules/finance/domain/debts";

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
        debt({ principal: 1, installments: 2, annualRate: 0, interestMode: "declining" }),
        debt({ payments: [{ id: crypto.randomUUID(), date: "2025-12-31", amount: 1 }] }),
      ]) {
        expect(() => new FinanceBook(emptyState()).execute({ type: "debt.save", data: invalid })).toThrow();
      }
    });
    it("accrues declining interest daily, applies interest first and continues after maturity", () => {
      const loan = debt({ principal: 100_000, annualRate: 3650, startDate: "2026-01-01", firstDueDate: "2026-01-11", installments: 1, interestMode: "declining" });
      expect(debtBalance(loan, "2026-01-21", [])).toBe(102_000);
      expect(debtBalance(loan, "2026-01-21", [{ date: "2026-01-11", amount: 51_000 }])).toBe(50_500);
      expect(debtBalance(loan, "2026-01-11", [{ date: "2026-01-11", amount: 101_000 }])).toBe(0);
    });
    it("capitalizes compound interest on monthly anniversaries, including month-end dates", () => {
      const loan = debt({ principal: 100_000, annualRate: 3650, startDate: "2026-01-01", firstDueDate: "2026-03-01", installments: 1, interestMode: "compound" });
      expect(debtBalance(loan, "2026-03-01", [])).toBe(105_987);
      expect(debtBalance({ ...loan, startDate: "2028-01-31" }, "2028-03-31", [])).toBe(106_090);
    });
    it("generates regular balance-based payments and ignores zero-value projection events", () => {
      const loan = debt({ principal: 10_001, annualRate: 0, interestMode: "declining", installments: 3, startDate: "2026-01-01", firstDueDate: "2026-02-01" });
      const schedule = debtSchedule(loan);
      expect(schedule.map((payment) => payment.amount)).toEqual([3334, 3334, 3333]);
      expect(debtBalance(loan, "2026-04-01", schedule)).toBe(0);
      const long = { ...loan, principal: 100_000, installments: 600 };
      const longSchedule = debtSchedule(long);
      expect(longSchedule).toHaveLength(600);
      expect(longSchedule.every((payment) => payment.amount > 0)).toBe(true);
      expect(longSchedule.reduce((sum, payment) => sum + payment.amount, 0)).toBe(100_000);
      const tiny = { ...loan, principal: 1, annualRate: 3650, installments: 1 };
      expect(debtBalance(tiny, "2027-02-05", [{ date: "2026-07-01", amount: 0 }], true)).toBe(debtBalance(tiny, "2027-02-05", [], true));
    });
    it("projects early payments and a custom balloon without changing recorded payments", () => {
      const loan = debt({ principal: 100_000, annualRate: 3650, startDate: "2026-01-01", firstDueDate: "2026-01-31", installments: 1, interestMode: "declining", customSchedule: [{ date: "2026-01-31", amount: 103_000 }] });
      const baseline = plannedBalance(loan, "2026-01-01");
      const extra = plannedBalance(loan, "2026-01-01", { date: "2026-01-11", amount: 50_000 });
      expect(baseline.totalPaid + baseline.balance).toBe(103_000);
      expect(extra.totalPaid + extra.balance).toBe(102_020);
      expect(extra.extraApplied).toBe(50_000);
      expect(loan.payments).toEqual([]);
      const balloon = { ...loan, annualRate: 0, customSchedule: [{ date: "2026-01-11", amount: 20_000 }, { date: "2026-01-31", amount: 30_000 }] };
      expect(plannedBalance(balloon, "2026-01-01").balance).toBe(50_000);
      expect(outstandingSchedule(balloon, "2026-01-01")).toEqual([{ date: "2026-01-11", amount: 20_000 }, { date: "2026-01-31", amount: 30_000 }, { date: "2026-01-31", amount: 50_000, estimated: true }]);
      expect(outstandingSchedule(balloon, "2026-02-01").reduce((sum, item) => sum + item.amount, 0)).toBe(100_000);
      const overScheduled = { ...balloon, customSchedule: [{ date: "2026-01-11", amount: 100_000 }, { date: "2026-01-31", amount: 100_000 }] };
      expect(outstandingSchedule(overScheduled, "2026-01-01")).toEqual([{ date: "2026-01-11", amount: 100_000 }]);
    });
    it("accounts for recorded early and future payments without double-counting scheduled payments", () => {
      const base = debt({ principal: 100_000, annualRate: 0, interestMode: "declining", startDate: "2026-01-01", firstDueDate: "2026-01-15", installments: 2, customSchedule: [{ date: "2026-01-15", amount: 30_000 }, { date: "2026-01-31", amount: 30_000 }] });
      const early = { ...base, payments: [{ id: crypto.randomUUID(), date: "2026-01-02", amount: 10_000 }] };
      expect(plannedBalance(early, "2026-01-03")).toMatchObject({ totalPaid: 60_000, balance: 40_000 });
      const future = { ...base, payments: [{ id: crypto.randomUUID(), date: "2026-01-15", amount: 10_000 }] };
      expect(plannedBalance(future, "2026-01-03")).toMatchObject({ totalPaid: 60_000, balance: 40_000 });
      const late = { ...base, annualRate: 3650, installments: 1, customSchedule: [{ date: "2026-01-15", amount: 101_400 }], payments: [{ id: crypto.randomUUID(), date: "2026-01-16", amount: 101_500 }] };
      expect(plannedBalance(late, "2026-01-01")).toMatchObject({ totalPaid: 101_500, balance: 0, payoffDate: "2026-01-16" });
    });
    it("links only matching transactions and protects links from edits, deletion and reuse", () => {
      const book = new FinanceBook(emptyState());
      const entry = transaction({ amount: 5000, date: "2026-02-01" });
      const loan = debt();
      const payment = { id: crypto.randomUUID(), date: entry.date, amount: entry.amount, transactionId: entry.id };
      book.execute({ type: "transaction.save", data: entry });
      book.execute({ type: "debt.save", data: loan });
      book.execute({ type: "debt.payment.save", debtId: loan.id, data: payment });
      expect(() => book.execute({ type: "transaction.delete", id: entry.id })).toThrow("Unlink");
      expect(() => book.execute({ type: "transaction.save", data: { ...entry, amount: 6000 } })).toThrow("Unlink");
      expect(() => book.execute({ type: "debt.payment.save", debtId: loan.id, data: { ...payment, id: crypto.randomUUID() } })).toThrow("only be linked");
      book.execute({ type: "debt.payment.save", debtId: loan.id, data: { id: payment.id, date: payment.date, amount: payment.amount } });
      book.execute({ type: "transaction.delete", id: entry.id });
      expect(book.toPrimitives().transactions).toEqual([]);
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
