"use client";

import { useI18n } from "../../../shared/i18n/provider";

import { ArrowDownLeft, ArrowUpRight, ArrowRight, Coffee, ShoppingBasket, TrainFront, Plus, Pencil, Trash2, Target, Wallet, TrendingUp, TrendingDown, Repeat2 } from "lucide-react";
import { useState } from "react";
import { defaultSettings, forecast, localDate, monthSummary, type FinanceState, type TransactionData, type Settings } from "../domain/finance";
import { Empty, formatMoney, Progress } from "../../../shared/presentation/primitives";
import type { Editor } from "./finance-forms";
import { catalogName } from "./preferences-form";

export type Tab = "overview" | "transactions" | "planning" | "forecast" | "scenarios";
interface ViewProps {
  state: FinanceState; month: string; edit: (editor: Editor) => void;
  remove: (kind: "transaction" | "budget" | "goal" | "scenario", id: string) => void;
}
export function Transactions({ entries, currency, settings, edit, remove }: { entries: TransactionData[]; currency: string; settings: Settings; edit: ViewProps["edit"]; remove: ViewProps["remove"] }) {
  const { t, language } = useI18n();
  return <div className="transaction-list">{entries.map((entry) => <div className="transaction-row" key={entry.id}>
    <span className={`transaction-icon ${entry.type}`}>{entry.type === "expense" ? <ArrowUpRight size={19} /> : <ArrowDownLeft size={19} />}</span>
    <button className="transaction-description" onClick={() => edit({ kind: "transaction", data: entry })}><strong>{entry.title}{entry.recurring && <Repeat2 size={12} aria-label={t("Monthly recurring")} />}</strong><span>{catalogName(entry.type === "expense" ? settings.expenseCategories : settings.incomeCategories, entry.category, t)} <span aria-hidden="true">&middot;</span> {new Date(`${entry.date}T12:00:00`).toLocaleDateString(language, { month: "short", day: "numeric" })}</span></button>
    <span className={`amount ${entry.type}`}>{entry.type === "income" ? "+" : "-"}{formatMoney(entry.amount, currency, language)}</span>
    <button className="icon-button row-delete" aria-label={t("Delete {p0}", { p0: entry.title })} onClick={() => remove("transaction", entry.id)}><Trash2 size={15} /></button>
  </div>)}</div>;
}

export function Overview({ state, month, edit, remove, navigate, quickAdd }: ViewProps & { navigate: (tab: Tab) => void; quickAdd: (title: string, amount: number, category: string, paymentMethod: string) => void }) {
  const { t, language } = useI18n();
  const totals = monthSummary(state, month);
  const fmt = (value: number) => formatMoney(value, state.settings.currency, language);
  const cap = state.budgets.reduce((a, b) => a + b.limit, 0);
  const saved = state.goals.reduce((a, g) => a + g.saved, 0);
  const activeGoals = state.goals.filter((g) => g.saved < g.target).length;
  const recent = [...state.transactions].filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const categoryEntries = Object.entries(totals.byCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  return <>
    <section className="stats-grid" aria-label={t("Monthly summary")}>
      <article className="stat balance"><div className="stat-label">{t("Net cashflow")} <Wallet size={18} /></div><strong>{fmt(totals.net)}</strong><span>{t("Income minus expenses this month")}</span><div className="balance-decoration" /></article>
      <article className="stat"><div className="stat-label">{t("Money in")} <span className="mini-icon green"><TrendingUp size={17} /></span></div><strong>{fmt(totals.income)}</strong><span>{t("Every bit adds up")}</span></article>
      <article className="stat"><div className="stat-label">{t("Money out")} <span className="mini-icon peach"><TrendingDown size={17} /></span></div><strong>{fmt(totals.expense)}</strong><span>{cap ? totals.expense > cap ? t("{p0} over your total budget", { p0: fmt(totals.expense - cap) }) : t("{p0} left in your total budget", { p0: fmt(cap - totals.expense) }) : t("Add budgets to stay on track")}</span></article>
      <article className="stat"><div className="stat-label">{t("Set aside")} <span className="mini-icon purple"><Target size={17} /></span></div><strong>{fmt(saved)}</strong><span>{t(activeGoals === 1 ? "{count} goal in progress" : "{count} goals in progress", { count: activeGoals })}</span></article>
    </section>
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
      <section className="card"><div className="section-heading"><div><h2>{t("Where it goes")}</h2><p>{t("Spending by category")}</p></div><span className="subtle-badge">{t("This month")}</span></div>
        {categoryEntries.length ? <div className="category-list">{categoryEntries.slice(0, 5).map(([category, value], index) => <div key={category}><div className="spread"><span><i className={`dot color-${index}`} />{catalogName(state.settings.expenseCategories, category, t)}</span><strong>{fmt(value)}</strong></div><Progress intent="neutral" label={t("{category} share of expenses", { category: catalogName(state.settings.expenseCategories, category, t) })} value={value / totals.expense * 100} /></div>)}</div> : <Empty title={t("Room for insight")} description={t("Your spending breakdown will appear as you add expenses.")} />}
      </section>
    </div>
    <div className="dashboard-columns">
      <section className="card"><div className="section-heading"><div><h2>{t("Budget check-in")}</h2><p>{t("A plan that leaves room for life.")}</p></div><button className="text-button" onClick={() => navigate("planning")}>{t("Manage")} <ArrowRight size={15} /></button></div>
        {state.budgets.length ? <div className="budget-list">{state.budgets.slice(0, 3).map((b) => <div key={b.id}><div className="spread"><strong>{catalogName(state.settings.expenseCategories, b.category, t)}</strong><span>{fmt(totals.byCategory[b.category] ?? 0)} <span className="muted">/ {fmt(b.limit)}</span></span></div><Progress label={catalogName(state.settings.expenseCategories, b.category, t)} value={(totals.byCategory[b.category] ?? 0) / b.limit * 100} /></div>)}</div> : <Empty title={t("Give your money a plan")} description={t("Set a monthly limit for the categories that matter to you.")} action={<button className="button secondary" onClick={() => edit({ kind: "budget" })}>{t("Create a budget")}</button>} />}
      </section>
      <section className="card goal-preview"><div className="section-heading"><div><h2>{t("Something to work toward")}</h2><p>{t("Small steps. Meaningful milestones.")}</p></div><Target size={22} /></div>
        {state.goals.length ? <div className="budget-list">{state.goals.slice(0, 2).map((g) => <div key={g.id}><div className="spread"><strong>{g.name}</strong><span>{Math.round(g.saved / g.target * 100)}%</span></div><Progress intent="goal" label={g.name} value={g.saved / g.target * 100} /><p>{fmt(g.saved)} {t("of")} {fmt(g.target)}</p></div>)}</div> : <Empty title={t("Make space for a goal")} description={t("An emergency fund, a new adventure, or a little peace of mind.")} action={<button className="button secondary" onClick={() => edit({ kind: "goal" })}>{t("Set a savings goal")}</button>} />}
      </section>
    </div>
  </>;
}

export function TransactionView({ state, month, edit, remove }: ViewProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const filtered = search.trim() !== "" || type !== "all";
  const entries = [...state.transactions].filter((entry) => entry.date.startsWith(month) && (type === "all" || entry.type === type) && `${entry.title} ${entry.category} ${catalogName(entry.type === "expense" ? state.settings.expenseCategories : state.settings.incomeCategories, entry.category, t)} ${entry.notes}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.date.localeCompare(a.date));
  function clearFilters() { setSearch(""); setType("all"); }
  return <section className="card"><div className="transaction-filters"><label className="search-field"><span className="sr-only">{t("Search transactions")}</span><input type="search" placeholder={t("Search descriptions, categories, notes...")} value={search} onChange={(e) => setSearch(e.target.value)} /></label><label><span className="sr-only">{t("Transaction type")}</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="all">{t("All transactions")}</option><option value="expense">{t("Expenses")}</option><option value="income">{t("Income")}</option></select></label><span className="muted" role="status">{t(entries.length === 1 ? "{count} record" : "{count} records", { count: entries.length })}</span>{filtered && <button className="text-button" onClick={clearFilters}>{t("Clear filters")}</button>}</div>
    {entries.length ? <Transactions entries={entries} currency={state.settings.currency} settings={state.settings} edit={edit} remove={remove} /> : <Empty title={t(filtered ? "No matching transactions" : "Nothing here yet")} description={t(filtered ? "Try a different search or clear your filters." : "Try another month or search, or record a transaction.")} action={filtered ? <button className="button secondary" onClick={clearFilters}>{t("Clear filters")}</button> : <button className="button primary" onClick={() => edit({ kind: "transaction" })}>{t("Add transaction")}</button>} />}
  </section>;
}

export function PlanningView({ state, month, edit, remove }: ViewProps) {
  const { t, language } = useI18n();
  const totals = monthSummary(state, month);
  const fmt = (value: number) => formatMoney(value, state.settings.currency, language);
  const needsSpend = state.settings.needsCategories.reduce((a, c) => a + (totals.byCategory[c] ?? 0), 0);
  return <>
    <div className="section-heading"><div><h2>{t("Monthly budgets")}</h2><p>{t("Not restrictions. A little direction.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "budget" })}><Plus size={16} /> {t("Add budget")}</button></div>
    {state.budgets.length ? <div className="planning-grid">{state.budgets.map((b) => {
      const spent = totals.byCategory[b.category] ?? 0;
      const name = catalogName(state.settings.expenseCategories, b.category, t);
      return <article className="card planning-card" key={b.id}><div className="spread"><h3>{name}</h3><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0} budget", { p0: name })} onClick={() => edit({ kind: "budget", data: b })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0} budget", { p0: name })} onClick={() => remove("budget", b.id)}><Trash2 size={15} /></button></div></div><p className="large-number">{fmt(spent)} <small>{t("of")} {fmt(b.limit)}</small></p><Progress label={name} value={spent / b.limit * 100} /><p className={spent > b.limit ? "expense" : "muted"}>{fmt(Math.abs(b.limit - spent))} {spent > b.limit ? t("over budget") : t("remaining")}</p></article>;
    })}</div> : <section className="card"><Empty title={t("A fresh plan")} description={t("Create your first category budget to see how this month is going.")} /></section>}
    <div className="section-heading"><div><h2>{t("Savings goals")}</h2><p>{t("Keep the bigger picture in sight.")}</p></div><button className="button secondary" onClick={() => edit({ kind: "goal" })}><Plus size={16} /> {t("Add goal")}</button></div>
    {state.goals.length ? <div className="planning-grid">{state.goals.map((g) => <article className="card planning-card" key={g.id}><div className="spread"><span className="mini-icon purple"><Target size={20} /></span><div className="inline-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: g.name })} onClick={() => edit({ kind: "goal", data: g })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Delete {p0}", { p0: g.name })} onClick={() => remove("goal", g.id)}><Trash2 size={15} /></button></div></div><h3>{g.name}</h3><p className="large-number">{fmt(g.saved)} <small>{t("of")} {fmt(g.target)}</small></p><Progress intent="goal" label={g.name} value={g.saved / g.target * 100} /><p>{g.saved >= g.target ? t("Goal reached. You did it!") : t("Target: {p0}", { p0: new Date(`${g.date}T12:00:00`).toLocaleDateString(language) })}</p><button className="text-button" onClick={() => edit({ kind: "goal", data: g })}>{t("Update savings")} <ArrowRight size={15} /></button></article>)}</div> : <section className="card"><Empty title={t("What are you saving for?")} description={t("Turn a someday into a plan, at your own pace.")} /></section>}
    <section className="card planning-card"><h2>{t("The 50 / 30 / 20 check-in")}</h2><p>{t("A guideline, not a grade. Percentages use recorded income, not just total spending.")}</p><div className="rule-grid">{[{ name: "Needs", value: needsSpend, target: 50 }, { name: "Wants", value: totals.expense - needsSpend, target: 30 }, { name: "Unspent income", value: Math.max(0, totals.net), target: 20 }].map((item) => <div key={item.name}><strong>{t(item.name)}</strong><p className="large-number">{totals.income ? `${Math.round(item.value / totals.income * 100)}%` : "--"}</p><span className="muted">{t("Guideline:")} {item.target}% &middot; {fmt(item.value)}</span></div>)}</div><p className="help">{t("Unspent income is not necessarily savings. Record income to calculate these percentages.")}</p></section>
  </>;
}

export function ForecastView({ state, month }: Pick<ViewProps, "state" | "month">) {
  const { t, language } = useI18n();
  const rows = forecast(state, month).map((row) => ({
    ...row, label: new Date(`${row.month}-01T12:00:00`).toLocaleDateString(language, { month: "short", year: "2-digit" }),
  }));
  const max = Math.max(...rows.map((r) => Math.max(r.income, r.expense)), 1);
  return <><section className="card planning-card"><div className="section-heading"><div><h2>{t("A look ahead")}</h2><p>{t("{count} months, a little more perspective.", { count: state.settings.forecastMonths })}</p></div><span className="subtle-badge">{t("Estimate, not a promise")}</span></div>
    <div className="forecast-chart" role="img" aria-label={t("Projected monthly income and expenses. Exact values are in the table below.")}>{rows.map((r) => <div className="chart-column" key={r.month}><div className="bar-pair"><div className="chart-bar income-bar" style={{ height: `${r.income / max * 100}%` }} /><div className="chart-bar expense-bar" style={{ height: `${r.expense / max * 100}%` }} /></div><span>{r.label}</span></div>)}</div>
    <div className="chart-legend"><span><i className="dot color-0" />{t("Income")}</span><span><i className="dot color-1" />{t("Expenses")}</span></div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Monthly forecast details")}><table><caption className="sr-only">{t("Monthly forecast details")}</caption><thead><tr><th scope="col">{t("Month")}</th><th scope="col">{t("Income")}</th><th scope="col">{t("Expenses")}</th><th scope="col">{t("Net")}</th><th scope="col">{t("Projected balance")}</th></tr></thead><tbody>{rows.map((r) => <tr key={r.month}><th scope="row">{r.label}</th><td>{formatMoney(r.income, state.settings.currency, language)}</td><td>{formatMoney(r.expense, state.settings.currency, language)}</td><td className={r.net < 0 ? "expense" : "income"}>{formatMoney(r.net, state.settings.currency, language)}</td><td>{formatMoney(r.balance, state.settings.currency, language)}</td></tr>)}</tbody></table></div>
  </section><aside className="info-panel"><TrendingUp size={20} /><div><strong>{t("Here's what goes into this estimate")}</strong><p>{t("Forecasts use your expected income, or recorded monthly income when zero. Expenses use your custom estimate when set; otherwise the greater of monthly spending and recurring expenses. Your opening balance is added to recorded balance. Projections start after the selected month and never create transactions.")}</p></div></aside></>;
}

export function ScenariosView({ state, month, edit, remove }: ViewProps) {
  const { t, language } = useI18n();
  const baseline = forecast(state, month)[0];
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
