"use client";

import { useI18n } from "../../../shared/i18n/provider";

import { ArrowDownLeft, ArrowUpRight, ArrowRight, Coffee, ShoppingBasket, TrainFront, Plus, Pencil, Trash2, Target, Wallet, TrendingUp, TrendingDown, Repeat2 } from "lucide-react";
import { useState } from "react";
import { defaultSettings, forecast, localDate, monthSummary, type FinanceState, type TransactionData, type Settings } from "../domain/finance";
import { Empty, formatMoney, Progress } from "../../../shared/presentation/primitives";
import type { Editor } from "./finance-forms";
import { catalogName } from "./preferences-form";
import { debtBalance, outstandingSchedule } from "../domain/debts";
import { DebtCard } from "./debt-card";
import { translateError } from "../../../shared/i18n/messages";
import { accountBalance, netWorth } from "../domain/accounts";
import { nextOccurrence } from "../domain/schedules";
import { CsvTools } from "./csv-tools";

export type Tab = "overview" | "transactions" | "planning" | "forecast" | "scenarios";
export type PlanSection = "accounts" | "schedules" | "budgets" | "goals" | "debts";
interface ViewProps {
  state: FinanceState; month: string; edit: (editor: Editor) => void;
  remove: (kind: "transaction" | "budget" | "goal" | "scenario" | "debt" | "repayment" | "account" | "transfer" | "schedule", id: string, debtId?: string) => void;
}
export function Transactions({ entries, currency, settings, edit, remove, assign }: { entries: TransactionData[]; currency: string; settings: Settings; edit: ViewProps["edit"]; remove: ViewProps["remove"]; assign?: boolean }) {
  const { t, language } = useI18n();
  return <div className="transaction-list">{entries.map((entry) => <div className="transaction-row" key={entry.id}>
    <span className={`transaction-icon ${entry.type}`}>{entry.type === "expense" ? <ArrowUpRight size={19} /> : <ArrowDownLeft size={19} />}</span>
    <button className="transaction-description" onClick={() => edit({ kind: "transaction", data: entry })}><strong>{entry.title}{entry.recurring && <Repeat2 size={12} aria-label={t("Monthly recurring")} />}</strong><span>{catalogName(entry.type === "expense" ? settings.expenseCategories : settings.incomeCategories, entry.category, t)} <span aria-hidden="true">&middot;</span> {new Date(`${entry.date}T12:00:00`).toLocaleDateString(language, { month: "short", day: "numeric" })}</span></button>
    <span className={`amount ${entry.type}`}>{entry.type === "income" ? "+" : "-"}{formatMoney(entry.amount, currency, language)}</span>
    {assign && !entry.accountId && <button className="text-button" onClick={() => edit({ kind: "transaction", data: entry })}>{t("Assign account")}</button>}
    <button className="icon-button row-delete" aria-label={t("Delete {p0}", { p0: entry.title })} onClick={() => remove("transaction", entry.id)}><Trash2 size={15} /></button>
  </div>)}</div>;
}

export function Overview({ state, month, edit, remove, navigate, quickAdd, review }: ViewProps & { navigate: (tab: Tab, section?: PlanSection) => void; quickAdd: (title: string, amount: number, category: string, paymentMethod: string) => void; review: (id: string, date: string) => void }) {
  const { t, language } = useI18n();
  const totals = monthSummary(state, month);
  const fmt = (value: number) => formatMoney(value, state.settings.currency, language);
  const cap = state.budgets.reduce((a, b) => a + b.limit, 0);
  const saved = state.goals.reduce((a, g) => a + g.saved, 0);
  const activeGoals = state.goals.filter((g) => g.saved < g.target).length;
  const recent = [...state.transactions].filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const categoryEntries = Object.entries(totals.byCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const today = localDate();
  const horizon = new Date(`${today}T12:00:00`);
  horizon.setDate(horizon.getDate() + 30);
  const horizonDate = localDate(horizon);
  const upcomingErrors: { name: string; error: string }[] = [];
  const debtUpcoming = state.debts.flatMap((debt) => {
    try {
      if (debtBalance(debt, today) === 0) return [];
      return outstandingSchedule(debt, today).filter((payment) => payment.date <= horizonDate).map((payment) => ({ ...payment, debt }));
    } catch (reason) { upcomingErrors.push({ name: debt.name, error: reason instanceof Error ? reason.message : "Could not calculate the debt balance." }); return []; }
  }).map((payment, index) => ({ key: `debt-${payment.debt.id}-${index}`, date: payment.date, name: payment.debt.name, detail: t(payment.debt.direction === "owed" ? "I owe money" : "I lent money"), amount: payment.amount, estimated: payment.estimated, scheduleId: undefined as string | undefined }));
  const scheduleUpcoming = state.schedules.flatMap((schedule) => {
    const date = nextOccurrence(state, schedule, horizonDate);
    return date ? [{ key: `schedule-${schedule.id}`, date, name: schedule.title, detail: t(schedule.type === "income" ? "Income" : "Expense"), amount: schedule.amount, estimated: false, scheduleId: schedule.id }] : [];
  });
  const goalUpcoming = state.goals.filter((goal) => goal.saved < goal.target && goal.date <= horizonDate).map((goal) => ({ key: `goal-${goal.id}`, date: goal.date, name: goal.name, detail: t("Savings goal"), amount: goal.target - goal.saved, estimated: false, scheduleId: undefined as string | undefined }));
  const upcoming = [...debtUpcoming, ...scheduleUpcoming, ...goalUpcoming].sort((a, b) => a.date.localeCompare(b.date));
  const [reportYear, reportMonth] = month.split("-").map(Number);
  const report = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(reportYear, reportMonth - 1 - index, 1);
    const key = localDate(date).slice(0, 7);
    const end = key === today.slice(0, 7) ? today : localDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
    try { return { key, end, ...monthSummary(state, key), worth: netWorth(state, end), error: "" }; }
    catch (error) { return { key, end, ...monthSummary(state, key), worth: null, error: error instanceof Error ? error.message : "Could not calculate net worth." }; }
  });
  const worthChange = report[0].worth !== null && report[1].worth !== null ? report[0].worth - report[1].worth : null;
  return <>
    <section className="stats-grid" aria-label={t("Monthly summary")}>
      <article className="stat balance"><div className="stat-label">{t("Net cashflow")} <Wallet size={18} /></div><strong>{fmt(totals.net)}</strong><span>{t("Income minus expenses in the selected month")}</span><div className="balance-decoration" /></article>
      <article className="stat"><div className="stat-label">{t("Money in")} <span className="mini-icon green"><TrendingUp size={17} /></span></div><strong>{fmt(totals.income)}</strong><span>{t("Every bit adds up")}</span></article>
      <article className="stat"><div className="stat-label">{t("Money out")} <span className="mini-icon peach"><TrendingDown size={17} /></span></div><strong>{fmt(totals.expense)}</strong><span>{cap ? totals.expense > cap ? t("{p0} over your total budget", { p0: fmt(totals.expense - cap) }) : t("{p0} left in your total budget", { p0: fmt(cap - totals.expense) }) : t("Add budgets to stay on track")}</span></article>
      <article className="stat"><div className="stat-label">{t("Set aside")} <span className="mini-icon purple"><Target size={17} /></span></div><strong>{fmt(saved)}</strong><span>{t("Current goal allocations")} &middot; {t(activeGoals === 1 ? "{count} goal in progress" : "{count} goals in progress", { count: activeGoals })}</span></article>
    </section>
    {(upcoming.length > 0 || upcomingErrors.length > 0) && <section className="card planning-card"><div className="section-heading"><div><h2>{t("Upcoming obligations")}</h2><p>{t("As of today: overdue and due in the next 30 days. The earliest unconfirmed occurrence of each schedule is shown.")}</p></div><button className="text-button" onClick={() => navigate("planning", "schedules")}>{t("Manage schedules")} <ArrowRight size={15} /></button></div>{upcomingErrors.map(({ name, error }, index) => <p role="alert" className="error" key={index}>{name}: {translateError(language, error)}</p>)}{upcoming.map((item) => <div className="spread" key={item.key}><span>{item.name} &middot; {item.detail} &middot; {new Date(`${item.date}T12:00:00`).toLocaleDateString(language)}{item.date < today && <> &middot; {t("Overdue")}</>}{item.estimated && <> &middot; {t("Estimated balloon")}</>}</span><span><strong>{fmt(item.amount)}</strong>{item.scheduleId && item.date <= today && <button className="text-button" onClick={() => { if (item.scheduleId) review(item.scheduleId, item.date); }}>{t("Review occurrence")}</button>}</span></div>)}</section>}
    <section className="card planning-card"><h2>{t("Income, spending and net worth")}</h2><p>{t("Net worth as of {p0}", { p0: new Date(`${report[0].end}T12:00:00`).toLocaleDateString(language) })}</p>{report[0].error ? <p role="alert" className="error">{translateError(language, report[0].error)}</p> : <p className="large-number">{fmt(report[0].worth!)}{worthChange !== null && (Number.isSafeInteger(worthChange) ? <small> &middot; {t("{p0} change from prior month", { p0: fmt(worthChange) })}</small> : <small role="alert" className="error"> &middot; {t("Net worth change exceeds the supported range.")}</small>)}</p>}<details><summary>{t("View six-month history")}</summary><p>{t("Net worth includes opened accounts and debts or loans, but not unassigned transactions. Month-end values use recorded data; the current month uses today.")}</p><div className="table-scroll" tabIndex={0} role="region" aria-label={t("Income, spending and net worth")}><table><thead><tr><th scope="col">{t("Month")}</th><th scope="col">{t("Income")}</th><th scope="col">{t("Expenses")}</th><th scope="col">{t("Net worth")}</th></tr></thead><tbody>{report.map((row) => <tr key={row.key}><th scope="row">{new Date(`${row.key}-01T12:00:00`).toLocaleDateString(language, { month: "short", year: "numeric" })}</th><td>{fmt(row.income)}</td><td>{fmt(row.expense)}</td><td>{row.error ? <span role="alert" className="error">{translateError(language, row.error)}</span> : fmt(row.worth!)}</td></tr>)}</tbody></table></div></details></section>
    {state.settings.quickActions.length > 0 && <section className="card quick-card"><div><h3>{t("The little, everyday things")}</h3><p>{t("Quickly record a familiar expense. Edit it any time.")}</p></div><div className="quick-actions">
      {state.settings.quickActions.map(({ id, title, amount, category, paymentMethod }) => {
        const Icon = id === "coffee" ? Coffee : id === "groceries" ? ShoppingBasket : id === "commute" ? TrainFront : Plus;
        const displayTitle = defaultSettings().quickActions.some((item) => item.id === id && item.title === title) ? t(title) : title;
        return <button key={id} onClick={() => quickAdd(displayTitle, amount, category, paymentMethod)}><Icon size={17} /><span>{displayTitle}</span><strong>{fmt(amount)}</strong><Plus size={13} /></button>;
      })}
    </div></section>}
    <div className="dashboard-columns">
      <section className="card"><div className="section-heading"><div><h2>{t("Recent activity")}</h2><p>{t("A little clarity, one transaction at a time.")}</p></div><button className="text-button" onClick={() => navigate("transactions")}>{t("View all")} <ArrowRight size={15} /></button></div>
        {recent.length ? <Transactions entries={recent} currency={state.settings.currency} settings={state.settings} edit={edit} remove={remove} /> : <Empty title={t("Your story starts here")} description={t("Record your first income or expense. No sample data, just your money.")} action={<button className="button primary" onClick={() => edit({ kind: "transaction" })}><Plus size={16} /> {t("Add a transaction")}</button>} />}
      </section>
      <section className="card"><div className="section-heading"><div><h2>{t("Where it goes")}</h2><p>{t("Spending by category")}</p></div><span className="subtle-badge">{t("Selected month")}</span></div>
        {categoryEntries.length ? <div className="category-list">{categoryEntries.slice(0, 5).map(([category, value], index) => <div key={category}><div className="spread"><span><i className={`dot color-${index}`} />{catalogName(state.settings.expenseCategories, category, t)}</span><strong>{fmt(value)}</strong></div><Progress intent="neutral" label={t("{category} share of expenses", { category: catalogName(state.settings.expenseCategories, category, t) })} value={value / totals.expense * 100} /></div>)}</div> : <Empty title={t("Room for insight")} description={t("Your spending breakdown will appear as you add expenses.")} />}
      </section>
    </div>
    <div className="dashboard-columns">
      <section className="card"><div className="section-heading"><div><h2>{t("Budget check-in")}</h2><p>{t("A plan that leaves room for life.")}</p></div><button className="text-button" onClick={() => navigate("planning", "budgets")}>{t("Manage")} <ArrowRight size={15} /></button></div>
        {state.budgets.length ? <div className="budget-list">{state.budgets.slice(0, 3).map((b) => <div key={b.id}><div className="spread"><strong>{catalogName(state.settings.expenseCategories, b.category, t)}</strong><span>{fmt(totals.byCategory[b.category] ?? 0)} <span className="muted">/ {fmt(b.limit)}</span></span></div><Progress label={catalogName(state.settings.expenseCategories, b.category, t)} value={(totals.byCategory[b.category] ?? 0) / b.limit * 100} /></div>)}</div> : <Empty title={t("Give your money a plan")} description={t("Set a monthly limit for the categories that matter to you.")} action={<button className="button secondary" onClick={() => edit({ kind: "budget" })}>{t("Create a budget")}</button>} />}
      </section>
      <section className="card goal-preview"><div className="section-heading"><div><h2>{t("Something to work toward")}</h2><p>{t("Small steps. Meaningful milestones.")}</p></div><Target size={22} /></div>
        {state.goals.length ? <div className="budget-list">{state.goals.slice(0, 2).map((g) => <div key={g.id}><div className="spread"><strong>{g.name}</strong><span>{Math.round(g.saved / g.target * 100)}%</span></div><Progress intent="goal" label={g.name} value={g.saved / g.target * 100} /><p>{fmt(g.saved)} {t("of")} {fmt(g.target)}</p></div>)}</div> : <Empty title={t("Make space for a goal")} description={t("An emergency fund, a new adventure, or a little peace of mind.")} action={<button className="button secondary" onClick={() => edit({ kind: "goal" })}>{t("Set a savings goal")}</button>} />}
      </section>
    </div>
  </>;
}

export function TransactionView({ state, month, edit, remove, onImport, initialAccount }: ViewProps & { onImport: (entries: TransactionData[]) => Promise<void>; initialAccount?: string }) {
  const { t, language } = useI18n();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [account, setAccount] = useState(initialAccount ?? "all");
  const [category, setCategory] = useState("all");
  const [period, setPeriod] = useState(initialAccount ? "all" : "month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = search.trim() !== "" || type !== "all" || account !== "all" || category !== "all" || period !== "month";
  const inPeriod = (date: string) => period === "month" ? date.startsWith(month) : period === "all" || ((!from || date >= from) && (!to || date <= to));
  const entries = [...state.transactions].filter((entry) => inPeriod(entry.date) && (type === "all" || entry.type === type) && (account === "all" || (account === "unassigned" ? !entry.accountId : entry.accountId === account)) && (category === "all" || entry.category === category) && `${entry.title} ${entry.category} ${catalogName(entry.type === "expense" ? state.settings.expenseCategories : state.settings.incomeCategories, entry.category, t)} ${entry.notes}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  const categories = [...state.settings.expenseCategories, ...state.settings.incomeCategories].filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);
  const transfers = account !== "all" && account !== "unassigned" ? state.transfers.filter((item) => (item.fromAccountId === account || item.toAccountId === account) && inPeriod(item.date)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  function clearFilters() { setSearch(""); setType("all"); setAccount("all"); setCategory("all"); setPeriod("month"); setFrom(""); setTo(""); }
  return <><section className="card"><div className="transaction-filters">
    <label className="search-field"><span className="sr-only">{t("Search transactions")}</span><input type="search" placeholder={t("Search descriptions, categories, notes...")} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    <label><span className="sr-only">{t("Transaction type")}</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="all">{t("All transactions")}</option><option value="expense">{t("Expenses")}</option><option value="income">{t("Income")}</option></select></label>
    <label><span className="sr-only">{t("Filter by account")}</span><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="all">{t("All accounts")}</option><option value="unassigned">{t("Unassigned")}</option>{state.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span className="sr-only">{t("Filter by category")}</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">{t("All categories")}</option>{categories.map((item) => <option key={item.id} value={item.id}>{catalogName(categories, item.id, t)}</option>)}</select></label>
    <label><span className="sr-only">{t("Date range")}</span><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="month">{t("Selected month")}</option><option value="all">{t("All dates")}</option><option value="custom">{t("Custom dates")}</option></select></label>
    {period === "custom" && <><label>{t("From date")}<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label><label>{t("To date")}<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label></>}
    <span className="muted" role="status">{t(entries.length === 1 ? "{count} record" : "{count} records", { count: entries.length })}</span>{filtered && <button className="text-button" onClick={clearFilters}>{t("Clear filters")}</button>}</div>
    {entries.length ? <Transactions entries={entries} currency={state.settings.currency} settings={state.settings} edit={edit} remove={remove} assign={account === "unassigned"} /> : <Empty title={t(filtered ? "No matching transactions" : "Nothing here yet")} description={t(filtered ? "Try a different search or clear your filters." : "Try another month or search, or record a transaction.")} action={filtered ? <button className="button secondary" onClick={clearFilters}>{t("Clear filters")}</button> : <button className="button primary" onClick={() => edit({ kind: "transaction" })}>{t("Add transaction")}</button>} />}
    {transfers.length > 0 && <div className="account-transfers"><h3>{t("Transfers")}</h3><p className="help">{t("Transfers use the account and date filters only; search, category and type apply to transactions.")}</p>{transfers.map((transfer) => <div className="spread" key={transfer.id}><span>{new Date(`${transfer.date}T12:00:00`).toLocaleDateString(language)} &middot; {state.accounts.find((item) => item.id === transfer.fromAccountId)?.name} &rarr; {state.accounts.find((item) => item.id === transfer.toAccountId)?.name} &middot; {formatMoney(transfer.amount, state.settings.currency, language)}</span><div className="inline-actions"><button className="icon-button" aria-label={t("Edit transfer on {p0}", { p0: transfer.date })} onClick={() => edit({ kind: "transfer", data: transfer })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete transfer on {p0}", { p0: transfer.date })} onClick={() => remove("transfer", transfer.id)}><Trash2 size={15} /></button></div></div>)}</div>}
  </section><CsvTools state={state} onImport={onImport} /></>;
}

export function PlanningView({ state, month, edit, remove, section, setSection, openAccount, unskip }: ViewProps & { section: PlanSection; setSection: (section: PlanSection) => void; openAccount: (id: string) => void; unskip: (id: string, date: string) => void }) {
  const { t, language } = useI18n();
  const totals = monthSummary(state, month);
  const fmt = (value: number) => formatMoney(value, state.settings.currency, language);
  const needsSpend = state.settings.needsCategories.reduce((a, c) => a + (totals.byCategory[c] ?? 0), 0);
  const sections: { id: PlanSection; label: string }[] = [{ id: "accounts", label: "Accounts" }, { id: "schedules", label: "Recurring schedules" }, { id: "budgets", label: "Monthly budgets" }, { id: "goals", label: "Savings goals" }, { id: "debts", label: "Debts & loans" }];
  const unassigned = state.transactions.filter((item) => !item.accountId).length;
  return <>
    <div className="plan-sections" role="group" aria-label={t("Plan sections")}>{sections.map((item) => <button key={item.id} className={section === item.id ? "selected" : ""} aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{t(item.label)}</button>)}</div>
    {section === "accounts" && <div className="view-stack">
    <div className="section-heading"><div><h2>{t("Accounts")}</h2><p>{t("Balances include assigned transactions and transfers through today.")}</p></div><div className="wrap-actions"><button className="button secondary" onClick={() => edit({ kind: "account" })}><Plus size={16} /> {t("Add account")}</button><button className="button secondary" disabled={state.accounts.length < 2} onClick={() => edit({ kind: "transfer" })}>{t("Transfer")}</button></div></div>
    {unassigned > 0 && <section className="card planning-card"><div className="spread"><p>{t("{count} unassigned transactions", { count: unassigned })}</p><button className="text-button" onClick={() => openAccount("unassigned")}>{t("Review unassigned")}</button></div></section>}
    {state.accounts.length > 0 && <div className="planning-grid">{state.accounts.map((account) => {
      let balance: number | null = null, balanceError = "";
      try { balance = accountBalance(state, account, localDate()); }
      catch (error) { balanceError = error instanceof Error ? error.message : "Could not calculate the account balance."; }
      return <article className="card planning-card" key={account.id}><div className="spread"><h3>{account.name}</h3><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: account.name })} onClick={() => edit({ kind: "account", data: account })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0}", { p0: account.name })} onClick={() => remove("account", account.id)}><Trash2 size={15} /></button></div></div><p className="large-number">{balanceError ? <span role="alert" className="error">{translateError(language, balanceError)}</span> : balance === null ? t("Not open yet") : fmt(balance)}</p><button className="text-button" onClick={() => openAccount(account.id)}>{t("View account activity")} <ArrowRight size={15} /></button></article>;
    })}</div>}
    {state.transfers.length > 0 && <section className="card planning-card"><h3>{t("Transfers")}</h3>{[...state.transfers].sort((a, b) => b.date.localeCompare(a.date)).map((transfer) => <div className="spread" key={transfer.id}><span>{state.accounts.find((account) => account.id === transfer.fromAccountId)?.name} &rarr; {state.accounts.find((account) => account.id === transfer.toAccountId)?.name} &middot; {new Date(`${transfer.date}T12:00:00`).toLocaleDateString(language)} &middot; {fmt(transfer.amount)}</span><div className="inline-actions"><button className="icon-button" aria-label={t("Edit transfer on {p0}", { p0: transfer.date })} onClick={() => edit({ kind: "transfer", data: transfer })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete transfer on {p0}", { p0: transfer.date })} onClick={() => remove("transfer", transfer.id)}><Trash2 size={15} /></button></div></div>)}</section>}
    </div>}
    {section === "schedules" && <div className="view-stack">
    <div className="section-heading"><div><h2>{t("Recurring schedules")}</h2><p>{t("Confirm each due occurrence before it becomes a transaction.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "schedule" })}><Plus size={16} /> {t("Add schedule")}</button></div>
    {state.schedules.length > 0 && <div className="planning-grid">{state.schedules.map((schedule) => { const next = nextOccurrence(state, schedule, "9999-12-31"); return <article className="card planning-card" key={schedule.id}><div className="spread"><h3>{schedule.title}</h3><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: schedule.title })} onClick={() => edit({ kind: "schedule", data: schedule })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0}", { p0: schedule.title })} onClick={() => remove("schedule", schedule.id)}><Trash2 size={15} /></button></div></div><p>{fmt(schedule.amount)} &middot; {t(schedule.active ? "Active" : "Paused")}</p>{next && <p>{t("Next occurrence: {p0}", { p0: new Date(`${next}T12:00:00`).toLocaleDateString(language) })}</p>}{!!schedule.skippedDates?.length && <details><summary>{t("Skipped occurrences")}</summary>{[...schedule.skippedDates].sort().map((date) => <div className="spread" key={date}><span>{new Date(`${date}T12:00:00`).toLocaleDateString(language)}</span><button className="text-button" onClick={() => unskip(schedule.id, date)}>{t("Restore occurrence")}</button></div>)}</details>}</article>; })}</div>}
    </div>}
    {section === "budgets" && <div className="view-stack">
    <div className="section-heading"><div><h2>{t("Monthly budgets")}</h2><p>{t("Not restrictions. A little direction.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "budget" })}><Plus size={16} /> {t("Add budget")}</button></div>
    {state.budgets.length ? <div className="planning-grid">{state.budgets.map((b) => {
      const spent = totals.byCategory[b.category] ?? 0;
      const name = catalogName(state.settings.expenseCategories, b.category, t);
      return <article className="card planning-card" key={b.id}><div className="spread"><h3>{name}</h3><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0} budget", { p0: name })} onClick={() => edit({ kind: "budget", data: b })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0} budget", { p0: name })} onClick={() => remove("budget", b.id)}><Trash2 size={15} /></button></div></div><p className="large-number">{fmt(spent)} <small>{t("of")} {fmt(b.limit)}</small></p><Progress label={name} value={spent / b.limit * 100} /><p className={spent > b.limit ? "expense" : "muted"}>{fmt(Math.abs(b.limit - spent))} {spent > b.limit ? t("over budget") : t("remaining")}</p></article>;
    })}</div> : <section className="card"><Empty title={t("A fresh plan")} description={t("Create your first category budget to see how this month is going.")} /></section>}
    <section className="card planning-card"><h2>{t("The 50 / 30 / 20 check-in")}</h2><p>{t("A guideline, not a grade. Percentages use recorded income, not just total spending.")}</p><div className="rule-grid">{[{ name: "Needs", value: needsSpend, target: 50 }, { name: "Wants", value: totals.expense - needsSpend, target: 30 }, { name: "Unspent income", value: Math.max(0, totals.net), target: 20 }].map((item) => <div key={item.name}><strong>{t(item.name)}</strong><p className="large-number">{totals.income ? `${Math.round(item.value / totals.income * 100)}%` : "--"}</p><span className="muted">{t("Guideline:")} {item.target}% &middot; {fmt(item.value)}</span></div>)}</div><p className="help">{t("Unspent income is not necessarily savings. Record income to calculate these percentages.")}</p></section>
    </div>}
    {section === "goals" && <div className="view-stack">
    <div className="section-heading"><div><h2>{t("Savings goals")}</h2><p>{t("Keep the bigger picture in sight.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "goal" })}><Plus size={16} /> {t("Add goal")}</button></div>
    {state.goals.length ? <div className="planning-grid">{state.goals.map((g) => <article className="card planning-card" key={g.id}><div className="spread"><span className="mini-icon purple"><Target size={20} /></span><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: g.name })} onClick={() => edit({ kind: "goal", data: g })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0}", { p0: g.name })} onClick={() => remove("goal", g.id)}><Trash2 size={15} /></button></div></div><h3>{g.name}</h3><p className="large-number">{fmt(g.saved)} <small>{t("of")} {fmt(g.target)}</small></p><Progress intent="goal" label={g.name} value={g.saved / g.target * 100} /><p>{g.saved >= g.target ? t("Goal reached. You did it!") : t("Target: {p0}", { p0: new Date(`${g.date}T12:00:00`).toLocaleDateString(language) })}</p><button className="text-button" onClick={() => edit({ kind: "goal", data: g })}>{t("Update savings")} <ArrowRight size={15} /></button></article>)}</div> : <section className="card"><Empty title={t("What are you saving for?")} description={t("Turn a someday into a plan, at your own pace.")} /></section>}
    </div>}
    {section === "debts" && <div className="view-stack">
    <div className="section-heading"><div><h2>{t("Debts & loans")}</h2><p>{t("Keep track of what you owe and what others owe you.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "debt" })}><Plus size={16} /> {t("Add debt or loan")}</button></div>
    {state.debts.length ? <div className="planning-grid">{state.debts.map((debt) => <DebtCard key={debt.id} debt={debt} state={state} edit={edit} remove={remove} />)}</div> : <section className="card"><Empty title={t("No debts or loans yet")} description={t("Add a debt or loan to plan payments and track repayments.")} /></section>}
    </div>}
  </>;
}

export function ForecastView({ state, month }: Pick<ViewProps, "state" | "month">) {
  const { t, language } = useI18n();
  let rows: ReturnType<typeof forecast>;
  try { rows = forecast(state, month); }
  catch (error) { return <p role="alert" className="error">{translateError(language, error instanceof Error ? error.message : "Could not calculate the forecast.")}</p>; }
  const labeledRows = rows.map((row) => ({ ...row, label: new Date(`${row.month}-01T12:00:00`).toLocaleDateString(language, { month: "short", year: "2-digit" }) }));
  const max = Math.max(...rows.map((r) => Math.max(r.income, r.expense)), 1);
  return <><section className="card planning-card"><div className="section-heading"><div><h2>{t("A look ahead")}</h2><p>{t("{count} months, a little more perspective.", { count: state.settings.forecastMonths })}</p></div><span className="subtle-badge">{t("Estimate, not a promise")}</span></div>
    <div className="forecast-chart" role="img" aria-label={t("Projected monthly income and expenses. Exact values are in the table below.")}>{labeledRows.map((r) => <div className="chart-column" key={r.month}><div className="bar-pair"><div className="chart-bar income-bar" style={{ height: `${r.income / max * 100}%` }} /><div className="chart-bar expense-bar" style={{ height: `${r.expense / max * 100}%` }} /></div><span>{r.label}</span></div>)}</div>
    <div className="chart-legend"><span><i className="dot color-0" />{t("Income")}</span><span><i className="dot color-1" />{t("Expenses")}</span></div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Monthly forecast details")}><table><caption className="sr-only">{t("Monthly forecast details")}</caption><thead><tr><th scope="col">{t("Month")}</th><th scope="col">{t("Income")}</th><th scope="col">{t("Expenses")}</th><th scope="col">{t("Net")}</th><th scope="col">{t("Projected balance")}</th></tr></thead><tbody>{labeledRows.map((r) => <tr key={r.month}><th scope="row">{r.label}</th><td>{formatMoney(r.income, state.settings.currency, language)}</td><td>{formatMoney(r.expense, state.settings.currency, language)}</td><td className={r.net < 0 ? "expense" : "income"}>{formatMoney(r.net, state.settings.currency, language)}</td><td>{formatMoney(r.balance, state.settings.currency, language)}</td></tr>)}</tbody></table></div>
  </section><aside className="info-panel"><TrendingUp size={20} /><div><strong>{t("Here's what goes into this estimate")}</strong><p>{t("Forecasts use your expected income, or recorded monthly income when zero. Expenses use your custom estimate when set; otherwise the greater of monthly spending and recurring expenses. Your opening balance is added to recorded balance. Projections start after the selected month and never create transactions.")}</p>{state.settings.includeDebtForecast && <p>{t("Scheduled debt and loan payments are included. Manually entered baselines or unlinked repayments may already include these amounts.")}</p>}</div></aside></>;
}

export function ScenariosView({ state, month, edit, remove }: ViewProps) {
  const { t, language } = useI18n();
  let baseline: ReturnType<typeof forecast>[number];
  try { baseline = forecast(state, month)[0]; }
  catch (error) { return <p role="alert" className="error">{translateError(language, error instanceof Error ? error.message : "Could not calculate the forecast.")}</p>; }
  return <><aside className="info-panel"><TrendingUp size={20} /><div><strong>{t("A safe place to ask “what if?”")}</strong><p>{t("Try a raise, a spending cut, or a new routine. Your actual records stay exactly as they are.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "scenario" })}><Plus size={16} /> {t("New scenario")}</button></aside>
    {state.scenarios.length ? <div className="planning-grid">{state.scenarios.map((s) => {
      const projected = forecast(state, month, s)[0];
      const horizon = forecast(state, month, s).at(-1)!;
      return <article className="card planning-card" key={s.id}><div className="spread"><h3>{s.name}</h3><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: s.name })} onClick={() => edit({ kind: "scenario", data: s })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0}", { p0: s.name })} onClick={() => remove("scenario", s.id)}><Trash2 size={15} /></button></div></div><p>{t("Income change:")} {formatMoney(s.incomeChange, state.settings.currency, language)} {t("/ month")}</p><p>{t("Expense change:")} {s.expensePercent > 0 ? "+" : ""}{s.expensePercent.toLocaleString(language)}%</p><hr /><span className="muted">{t("Projected monthly cashflow")}</span><p className="large-number">{formatMoney(projected.net, state.settings.currency, language)}</p><p className={projected.net >= baseline.net ? "income" : "expense"}>{formatMoney(projected.net - baseline.net, state.settings.currency, language)} {t("compared with your baseline")}</p><p className="help">{state.settings.forecastMonths === 6 ? t("Six-month balance:") : t("{count}-month balance:", { count: state.settings.forecastMonths })} {formatMoney(horizon.balance, state.settings.currency, language)}</p></article>;
    })}</div> : <section className="card"><Empty title={t("A small change can go a long way")} description={t("Save a scenario to compare its monthly and projected impact.")} action={<button className="button primary" onClick={() => edit({ kind: "scenario" })}>{t("Explore a scenario")}</button>} /></section>}
  </>;
}
export function newQuickTransaction(title: string, amount: number, category: string, paymentMethod = "Card", date = localDate()): TransactionData {
  return { id: crypto.randomUUID(), title, amount, type: "expense", category, date, paymentMethod, notes: "", recurring: false };
}
