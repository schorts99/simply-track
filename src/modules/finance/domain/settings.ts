export interface CatalogItem { id: string; name: string; active: boolean; }
export interface QuickAction { id: string; title: string; amount: number; category: string; paymentMethod: string; }
export interface Settings {
  currency: string;
  incomeBaseline: number;
  profileName: string;
  workspaceName: string;
  expenseCategories: CatalogItem[];
  incomeCategories: CatalogItem[];
  paymentMethods: CatalogItem[];
  quickActions: QuickAction[];
  forecastMonths: number;
  expenseBaseline: number | null;
  openingBalance: number;
  needsCategories: string[];
}
export const expenseCategories = ["Food & Dining", "Housing & Rent", "Utilities & Bills", "Transportation", "Groceries", "Shopping", "Entertainment", "Healthcare", "Education", "Subscriptions", "Other Expense"] as const;
export const incomeCategories = ["Salary & Wages", "Freelance", "Investments", "Refund", "Other Income"] as const;
export const paymentMethods = ["Card", "Cash", "Bank transfer", "Digital wallet"] as const;
const catalog = (names: readonly string[]): CatalogItem[] => names.map((name) => ({ id: name, name, active: true }));

export function defaultSettings(): Settings {
  return {
    currency: "USD", incomeBaseline: 0, profileName: "", workspaceName: "",
    expenseCategories: catalog(expenseCategories), incomeCategories: catalog(incomeCategories), paymentMethods: catalog(paymentMethods),
    quickActions: [
      { id: "coffee", title: "Coffee", amount: 525, category: "Food & Dining", paymentMethod: "Card" },
      { id: "groceries", title: "Groceries", amount: 5500, category: "Groceries", paymentMethod: "Card" },
      { id: "commute", title: "Commute", amount: 450, category: "Transportation", paymentMethod: "Card" },
    ],
    forecastMonths: 6, expenseBaseline: null, openingBalance: 0,
    needsCategories: ["Housing & Rent", "Utilities & Bills", "Transportation", "Groceries", "Healthcare"],
  };
}

// Older encrypted books contain only currency and incomeBaseline.
export function restoreSettings(settings: Partial<Settings>): Settings {
  return { ...defaultSettings(), ...structuredClone(settings) };
}

export function validateSettings(settings: Settings) {
  const amount = (value: number, signed = false) => Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000_000_000 && (signed || value >= 0);
  if (!Intl.supportedValuesOf("currency").includes(settings.currency)) throw new Error("Choose a supported currency.");
  if (!amount(settings.incomeBaseline) || !amount(settings.openingBalance, true) || (settings.expenseBaseline !== null && !amount(settings.expenseBaseline))) throw new Error("Amount must be a valid monetary value within the supported range.");
  if (typeof settings.profileName !== "string" || settings.profileName.length > 80 || typeof settings.workspaceName !== "string" || settings.workspaceName.length > 80) throw new Error("Profile and workspace names must be at most 80 characters.");
  if (!Number.isInteger(settings.forecastMonths) || settings.forecastMonths < 1 || settings.forecastMonths > 24) throw new Error("Forecast duration must be between 1 and 24 months.");
  for (const items of [settings.expenseCategories, settings.incomeCategories, settings.paymentMethods]) {
    if (!Array.isArray(items) || items.length > 100 || !items.some((item) => item.active)) throw new Error("Keep at least one active option in each catalog (maximum 100).");
    if (items.some((item) => typeof item.id !== "string" || !item.id || item.id.length > 120 || typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || typeof item.active !== "boolean")) throw new Error("Catalog options need a name of at most 80 characters and a valid identifier.");
    if (new Set(items.map((item) => item.id)).size !== items.length || new Set(items.map((item) => item.name.trim().toLocaleLowerCase())).size !== items.length) throw new Error("Catalog names and identifiers must be unique.");
  }
  if (!Array.isArray(settings.needsCategories) || new Set(settings.needsCategories).size !== settings.needsCategories.length || settings.needsCategories.some((id) => !settings.expenseCategories.some((item) => item.id === id))) throw new Error("Choose valid needs categories.");
  if (!Array.isArray(settings.quickActions) || settings.quickActions.length > 12 || new Set(settings.quickActions.map((item) => item.id)).size !== settings.quickActions.length) throw new Error("Use at most 12 quick actions with unique identifiers.");
  for (const action of settings.quickActions) {
    if (typeof action.id !== "string" || !action.id || typeof action.title !== "string" || !action.title.trim() || action.title.length > 120 || !amount(action.amount) || action.amount === 0) throw new Error("Quick actions need a title and a positive amount.");
    if (!settings.expenseCategories.some((item) => item.id === action.category && item.active) || !settings.paymentMethods.some((item) => item.id === action.paymentMethod && item.active)) throw new Error("Quick actions must use active expense categories and payment methods.");
  }
}
