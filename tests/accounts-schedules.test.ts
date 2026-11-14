import { describe, expect, it } from "vitest";
import { accountBalance, netWorth } from "../src/modules/finance/domain/accounts";
import { exportTransactionsCsv, previewTransactionsCsv } from "../src/modules/finance/domain/csv";
import { emptyState, FinanceBook, forecast, monthSummary, type FinanceState, type TransactionData } from "../src/modules/finance/domain/finance";
import { isOccurrence, nextOccurrence, type ScheduleData } from "../src/modules/finance/domain/schedules";

const transaction = (overrides: Partial<TransactionData> = {}): TransactionData => ({ id: crypto.randomUUID(), title: "Coffee", amount: 1000, type: "expense", category: "Food & Dining", paymentMethod: "Card", date: "2024-01-31", notes: "", recurring: false, ...overrides });
const schedule = (overrides: Partial<ScheduleData> = {}): ScheduleData => ({ id: crypto.randomUUID(), title: "Rent", amount: 1000, type: "expense", category: "Food & Dining", paymentMethod: "Card", firstDate: "2024-01-31", interval: "monthly", active: true, ...overrides });

describe("accounts and schedules", () => {
  it("restores older snapshots and preserves unassigned transactions", () => {
    const state: Partial<FinanceState> = emptyState();
    delete state.accounts; delete state.transfers; delete state.schedules;
    state.transactions = [transaction()];
    const restored = new FinanceBook(state as FinanceState).toPrimitives();
    expect(restored).toMatchObject({ accounts: [], transfers: [], schedules: [] });
    expect(restored.transactions[0].accountId).toBeUndefined();
  });

  it("tracks dated balances, internal transfers and net worth without affecting cashflow", () => {
    const book = new FinanceBook(emptyState());
    const a = { id: crypto.randomUUID(), name: "Checking", openingBalance: 10_000, openingDate: "2024-01-01" };
    const b = { id: crypto.randomUUID(), name: "Savings", openingBalance: 2000, openingDate: "2024-02-01" };
    book.execute({ type: "account.save", data: a }); book.execute({ type: "account.save", data: b });
    book.execute({ type: "transaction.save", data: transaction({ accountId: a.id }) });
    book.execute({ type: "transaction.save", data: transaction({ amount: 500, date: "2024-02-02" }) });
    const transfer = { id: crypto.randomUUID(), fromAccountId: a.id, toAccountId: b.id, amount: 3000, date: "2024-02-02", notes: "" };
    book.execute({ type: "transfer.save", data: transfer });
    const state = book.toPrimitives();
    expect(accountBalance(state, b, "2024-01-31")).toBeNull();
    expect(accountBalance(state, a, "2024-02-02")).toBe(6000);
    expect(accountBalance(state, b, "2024-02-02")).toBe(5000);
    expect(netWorth(state, "2024-02-02")).toBe(11000);
    expect(monthSummary(state, "2024-02").expense).toBe(500);
    expect(() => book.execute({ type: "account.delete", id: a.id })).toThrow("before deleting");
    const before = book.toPrimitives();
    expect(() => book.execute({ type: "transfer.save", data: { ...transfer, toAccountId: a.id } })).toThrow();
    expect(() => book.execute({ type: "account.save", data: { ...a, openingDate: "2024-02-01" } })).toThrow();
    expect(book.toPrimitives()).toEqual(before);
  });

  it("includes debt liabilities and loans only from their start dates", () => {
    const book = new FinanceBook(emptyState());
    const debt = { id: crypto.randomUUID(), name: "Debt", direction: "owed" as const, principal: 2000, annualRate: 0, startDate: "2024-02-01", firstDueDate: "2024-03-01", installments: 1, interval: "monthly" as const, payments: [] };
    book.execute({ type: "account.save", data: { id: crypto.randomUUID(), name: "Bank", openingBalance: 5000, openingDate: "2024-01-01" } });
    book.execute({ type: "debt.save", data: debt });
    book.execute({ type: "debt.save", data: { ...debt, id: crypto.randomUUID(), direction: "lent", principal: 1000 } });
    expect(netWorth(book.toPrimitives(), "2024-01-31")).toBe(5000);
    expect(netWorth(book.toPrimitives(), "2024-02-01")).toBe(4000);
  });

  it("confirms only due occurrences once and retains recorded transactions on deletion", () => {
    const book = new FinanceBook(emptyState()), item = schedule();
    book.execute({ type: "schedule.save", data: item });
    expect(isOccurrence(item, "2024-02-29")).toBe(true);
    expect(isOccurrence(item, "2024-03-30")).toBe(false);
    expect(nextOccurrence(book.toPrimitives(), item, "2024-04-01")).toBe("2024-01-31");
    expect(nextOccurrence(book.toPrimitives(), { ...item, active: false }, "2024-04-01")).toBeUndefined();
    expect(isOccurrence({ ...item, endDate: "2024-02-01" }, "2024-02-29")).toBe(false);
    expect(() => book.execute({ type: "schedule.confirm", id: item.id, date: "2024-02-28", transactionId: crypto.randomUUID() })).toThrow();
    book.execute({ type: "schedule.confirm", id: item.id, date: "2024-01-31", transactionId: crypto.randomUUID() });
    const before = book.toPrimitives();
    expect(() => book.execute({ type: "schedule.confirm", id: item.id, date: "2024-01-31", transactionId: crypto.randomUUID() })).toThrow("already been recorded");
    expect(book.toPrimitives()).toEqual(before);
    expect(() => book.execute({ type: "transaction.save", data: { ...before.transactions[0], scheduleId: undefined } })).toThrow("references cannot be changed");
    expect(nextOccurrence(before, item, "2024-04-01")).toBe("2024-02-29");
    book.execute({ type: "schedule.delete", id: item.id });
    expect(book.toPrimitives().transactions).toHaveLength(1);
    expect(book.toPrimitives().transactions[0].scheduleId).toBeUndefined();
  });

  it("does not double count linked repayments in inferred forecasts", () => {
    const book = new FinanceBook(emptyState());
    const entry = transaction({ amount: 2000, date: "2024-01-10", recurring: true });
    const debt = { id: crypto.randomUUID(), name: "Debt", direction: "owed" as const, principal: 6000, annualRate: 0, startDate: "2024-01-01", firstDueDate: "2024-01-10", installments: 3, interval: "monthly" as const, payments: [{ id: crypto.randomUUID(), date: entry.date, amount: entry.amount, transactionId: entry.id }] };
    book.execute({ type: "transaction.save", data: entry });
    book.execute({ type: "debt.save", data: debt });
    const state = book.toPrimitives();
    expect(forecast(state, "2024-01")[0].expense).toBe(2000);
    state.settings.includeDebtForecast = true;
    const rows = forecast(state, "2024-01");
    expect(rows.slice(0, 3).map((row) => row.expense)).toEqual([2000, 2000, 0]);
    expect(rows[1].balance).toBe(-6000);
  });

  it("includes recorded future repayments once on their actual dates", () => {
    const book = new FinanceBook(emptyState());
    const entry = transaction({ amount: 4000, date: "2024-03-05" });
    const debt = { id: crypto.randomUUID(), name: "Debt", direction: "owed" as const, principal: 6000, annualRate: 0, startDate: "2024-01-01", firstDueDate: "2024-02-01", installments: 3, interval: "monthly" as const, payments: [{ id: crypto.randomUUID(), date: entry.date, amount: entry.amount, transactionId: entry.id }] };
    book.execute({ type: "transaction.save", data: entry });
    book.execute({ type: "debt.save", data: debt });
    const state = book.toPrimitives();
    state.settings.includeDebtForecast = true;
    expect(forecast(state, "2024-01").slice(0, 3).map((row) => row.expense)).toEqual([0, 4000, 2000]);
  });
});

describe("transaction CSV", () => {
  it("round trips escaped values safely and identifies duplicates without transferring links", () => {
    const state = emptyState();
    const entry = transaction({ title: '=SUM(1,2)\n"test"', notes: "+1" });
    state.transactions = [entry];
    const csv = exportTransactionsCsv(state.transactions);
    const preview = previewTransactionsCsv(csv, state);
    expect(preview[0].duplicate).toBe(true);
    expect(preview[0].entry).toMatchObject({ ...entry, id: expect.any(String) });
    expect(preview[0].entry?.id).not.toBe(entry.id);
    expect(csv).toContain('"""=SUM');
    expect(() => previewTransactionsCsv('invalid,"oops', state)).toThrow("quoting");
  });

  it("reports unsupported rows and rolls back an invalid selected batch", () => {
    const book = new FinanceBook(emptyState());
    const valid = transaction();
    const invalid = transaction({ category: "Unknown" });
    const rows = previewTransactionsCsv(exportTransactionsCsv([valid, invalid]), book.toPrimitives());
    expect(rows[0].entry).toBeDefined();
    expect(rows[1].error).toBeTruthy();
    const before = book.toPrimitives();
    expect(() => book.execute({ type: "transaction.import", data: [valid, invalid] })).toThrow();
    expect(book.toPrimitives()).toEqual(before);
  });
});
