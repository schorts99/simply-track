import { Transaction, type FinanceState, type TransactionData } from "./finance";

const header = ["format", "date", "type", "amount_cents", "title_json", "category_json", "payment_method_json", "notes_json", "recurring", "account_id_json"];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function exportTransactionsCsv(entries: TransactionData[]): string {
  const rows = entries.map((item) => ["simplytrack-v1", item.date, item.type, String(item.amount), JSON.stringify(item.title), JSON.stringify(item.category), JSON.stringify(item.paymentMethod), JSON.stringify(item.notes), String(item.recurring), JSON.stringify(item.accountId ?? "")]);
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === ",") { row.push(field); field = ""; closed = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = ""; closed = false;
    } else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting.");
      field += char;
    }
  }
  if (quoted) throw new Error("Invalid CSV quoting.");
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}

export interface CsvPreviewRow { line: number; entry?: TransactionData; error?: string; duplicate: boolean; }

export function previewTransactionsCsv(text: string, state: FinanceState): CsvPreviewRow[] {
  const rows = parseRows(text.replace(/^\uFEFF/, ""));
  if (!rows.length || rows[0].length !== header.length || rows[0].some((value, index) => value !== header[index])) throw new Error("This is not a SimplyTrack transaction CSV.");
  const signature = (item: TransactionData) => JSON.stringify([item.date, item.type, item.amount, item.title, item.category, item.paymentMethod, item.notes, item.recurring, item.accountId ?? ""]);
  const seen = new Set(state.transactions.map(signature));
  return rows.slice(1).map((row, index) => {
    try {
      if (row.length !== header.length || row[0] !== "simplytrack-v1" || !/^[1-9]\d*$/.test(row[3]) || !["expense", "income"].includes(row[2]) || !["true", "false"].includes(row[8])) throw new Error("Invalid CSV transaction row.");
      const readString = (value: string): string => {
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { throw new Error("Invalid CSV transaction row."); }
        if (typeof parsed !== "string") throw new Error("Invalid CSV transaction row.");
        return parsed;
      };
      const entry: TransactionData = { id: crypto.randomUUID(), date: row[1], type: row[2] === "income" ? "income" : "expense", amount: Number(row[3]), title: readString(row[4]), category: readString(row[5]), paymentMethod: readString(row[6]), notes: readString(row[7]), recurring: row[8] === "true", accountId: readString(row[9]) || undefined };
      new Transaction(entry, state.settings);
      const categories = entry.type === "income" ? state.settings.incomeCategories : state.settings.expenseCategories;
      if (!categories.some((item) => item.id === entry.category && item.active) || !state.settings.paymentMethods.some((item) => item.id === entry.paymentMethod && item.active)) throw new Error("CSV rows must use active categories and payment methods.");
      if (entry.accountId) {
        const account = state.accounts.find((item) => item.id === entry.accountId);
        if (!account || entry.date < account.openingDate) throw new Error("CSV account is missing or not open on the transaction date.");
      }
      const key = signature(entry), duplicate = seen.has(key);
      seen.add(key);
      return { line: index + 2, entry, duplicate };
    } catch (error) {
      return { line: index + 2, error: error instanceof Error ? error.message : "Invalid CSV transaction row.", duplicate: false };
    }
  });
}
