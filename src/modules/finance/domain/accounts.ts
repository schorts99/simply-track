import { debtBalance } from "./debts";
import type { FinanceState } from "./finance";

export interface AccountData { id: string; name: string; openingBalance: number; openingDate: string; }
export interface TransferData { id: string; fromAccountId: string; toAccountId: string; amount: number; date: string; notes: string; }

function exactAmount(value: bigint, message: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(message);
  return Number(value);
}

export function accountBalance(state: FinanceState, account: AccountData, date: string): number | null {
  if (date < account.openingDate) return null;
  const transactions = state.transactions.filter((item) => item.accountId === account.id && item.date <= date)
    .reduce((sum, item) => sum + BigInt(item.type === "income" ? item.amount : -item.amount), BigInt(0));
  const transfers = state.transfers.filter((item) => item.date <= date)
    .reduce((sum, item) => sum + BigInt(item.toAccountId === account.id ? item.amount : item.fromAccountId === account.id ? -item.amount : 0), BigInt(0));
  return exactAmount(BigInt(account.openingBalance) + transactions + transfers, "Account balance exceeds the supported range.");
}

export function netWorth(state: FinanceState, date: string): number {
  const accounts = state.accounts.reduce((sum, account) => sum + BigInt(accountBalance(state, account, date) ?? 0), BigInt(0));
  const debts = state.debts.filter((debt) => debt.startDate <= date)
    .reduce((sum, debt) => sum + BigInt((debt.direction === "lent" ? 1 : -1) * debtBalance(debt, date)), BigInt(0));
  return exactAmount(accounts + debts, "Net worth exceeds the supported range.");
}
