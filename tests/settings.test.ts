import { describe, expect, it } from "vitest";
import { FinanceBook, emptyState, forecast, monthSummary, type TransactionData } from "../src/modules/finance/domain/finance";
import { defaultSettings } from "../src/modules/finance/domain/settings";
import { catalogName } from "../src/modules/finance/presentation/preferences-form";

const date = "2026-10-20";
function purchase(category: string, paymentMethod: string): TransactionData {
  return { id: crypto.randomUUID(), title: "My purchase", amount: 1000, category, paymentMethod, date, type: "expense", notes: "", recurring: false };
}
describe("personalized finance settings", () => {
  it("accepts custom categories and payment methods, propagates renames and retains archived history", () => {
    const book = new FinanceBook(emptyState());
    const settings = defaultSettings();
    settings.expenseCategories.push({ id: "pets", name: "My pets", active: true });
    settings.paymentMethods.push({ id: "joint", name: "Joint account", active: true });
    settings.profileName = "Alex";
    settings.workspaceName = "Our home";
    settings.quickActions = [{ id: "pet-food", title: "Pet food", amount: 1000, category: "pets", paymentMethod: "joint" }];
    book.execute({ type: "settings.save", data: settings });
    const data = purchase("pets", "joint");
    book.execute({ type: "transaction.save", data });
    book.execute({ type: "budget.save", data: { id: crypto.randomUUID(), category: "pets", limit: 10000 } });
    expect(monthSummary(book.toPrimitives(), "2026-10").byCategory.pets).toBe(1000);
    settings.expenseCategories.find((item) => item.id === "pets")!.name = "Animal care";
    settings.expenseCategories.find((item) => item.id === "pets")!.active = false;
    settings.paymentMethods.find((item) => item.id === "joint")!.active = false;
    expect(() => book.execute({ type: "settings.save", data: settings })).toThrow("active expense");
    settings.quickActions = [];
    book.execute({ type: "settings.save", data: settings });
    expect(book.toPrimitives().transactions[0].category).toBe("pets");
    expect(catalogName(book.toPrimitives().settings.expenseCategories, "pets", (value) => `translated ${value}`)).toBe("Animal care");
    book.execute({ type: "transaction.save", data: { ...data, amount: 1500 } });
    expect(() => book.execute({ type: "transaction.save", data: purchase("pets", "Card") })).toThrow("active category");
    expect(() => book.execute({ type: "transaction.save", data: purchase("Groceries", "joint") })).toThrow("active payment");
    expect(book.toPrimitives().transactions[0].amount).toBe(1500);
    const before = book.toPrimitives();
    const deletedCatalog = structuredClone(before.settings);
    deletedCatalog.expenseCategories = deletedCatalog.expenseCategories.filter((item) => item.id !== "pets");
    expect(() => book.execute({ type: "settings.save", data: deletedCatalog })).toThrow("category");
    expect(book.toPrimitives()).toEqual(before);
  });
  it("uses custom forecast duration, expense assumptions and signed opening balances without creating transactions", () => {
    const state = emptyState();
    state.settings.forecastMonths = 12;
    state.settings.incomeBaseline = 300000;
    state.settings.expenseBaseline = 125000;
    state.settings.openingBalance = -50000;
    const rows = forecast(state, "2026-10");
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ month: "2026-11", income: 300000, expense: 125000, balance: 125000 });
    expect(rows[11]).toMatchObject({ month: "2027-10", balance: 2050000 });
    state.settings.expenseBaseline = 0;
    state.transactions.push(purchase("Groceries", "Card"));
    expect(forecast(state, "2026-10")[0].expense).toBe(0);
    state.settings.expenseBaseline = null;
    expect(forecast(state, "2026-10")[0].expense).toBe(1000);
    expect(state.transactions).toHaveLength(1);
  });
  it("rejects duplicate names, invalid horizons, broken quick actions and empty catalogs atomically", () => {
    const changes = [
      (settings: ReturnType<typeof defaultSettings>) => { settings.forecastMonths = 25; },
      (settings: ReturnType<typeof defaultSettings>) => { settings.forecastMonths = 0; },
      (settings: ReturnType<typeof defaultSettings>) => { settings.expenseCategories[1].name = " food & DINING "; },
      (settings: ReturnType<typeof defaultSettings>) => { settings.paymentMethods.forEach((item) => { item.active = false; }); },
      (settings: ReturnType<typeof defaultSettings>) => { settings.quickActions[0].category = "missing"; },
      (settings: ReturnType<typeof defaultSettings>) => { settings.openingBalance = 1.25; },
      (settings: ReturnType<typeof defaultSettings>) => { settings.currency = "INVALID"; },
      (settings: ReturnType<typeof defaultSettings>) => { settings.profileName = "a".repeat(81); },
    ];
    for (const change of changes) {
      const initial = emptyState();
      const book = new FinanceBook(initial);
      const settings = defaultSettings(); change(settings);
      expect(() => book.execute({ type: "settings.save", data: settings })).toThrow();
      expect(book.toPrimitives()).toEqual(initial);
      expect(book.pullDomainEvents()).toHaveLength(0);
    }
  });
  it("does not translate names supplied by the user", () => {
    expect(catalogName([{ id: "custom", name: "Groceries", active: true }], "custom", () => "Supermercado")).toBe("Groceries");
    expect(catalogName(defaultSettings().expenseCategories, "Groceries", () => "Supermercado")).toBe("Supermercado");
  });
});
