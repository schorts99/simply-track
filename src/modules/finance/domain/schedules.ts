import { dueDate, type PaymentInterval } from "./debts";
import type { FinanceState, TransactionType } from "./finance";

export interface ScheduleData {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  paymentMethod: string;
  accountId?: string;
  firstDate: string;
  endDate?: string;
  interval: PaymentInterval;
  active: boolean;
  skippedDates?: string[];
}

export function isOccurrence(schedule: ScheduleData, date: string): boolean {
  if (date < schedule.firstDate || (schedule.endDate && date > schedule.endDate)) return false;
  const first = new Date(`${schedule.firstDate}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  const delta = schedule.interval === "weekly" || schedule.interval === "biweekly"
    ? (target.getTime() - first.getTime()) / 86_400_000 / (schedule.interval === "weekly" ? 7 : 14)
    : ((target.getUTCFullYear() - first.getUTCFullYear()) * 12 + target.getUTCMonth() - first.getUTCMonth())
      / (schedule.interval === "monthly" ? 1 : schedule.interval === "quarterly" ? 3 : 12);
  return Number.isInteger(delta) && delta >= 0 && dueDate(schedule.firstDate, schedule.interval, delta) === date;
}

export function nextOccurrence(state: FinanceState, schedule: ScheduleData, horizon: string): string | undefined {
  if (!schedule.active || schedule.firstDate > horizon) return undefined;
  const completed = new Set(state.transactions.filter((item) => item.scheduleId === schedule.id).map((item) => item.occurrenceDate));
  for (const date of schedule.skippedDates ?? []) completed.add(date);
  for (let index = 0; ; index++) {
    const date = dueDate(schedule.firstDate, schedule.interval, index);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    if (date > horizon || (schedule.endDate && date > schedule.endDate)) return undefined;
    if (!completed.has(date)) return date;
  }
}
