"use client";

import { useState } from "react";
import { exportTransactionsCsv, previewTransactionsCsv, type CsvPreviewRow } from "../domain/csv";
import type { FinanceState, TransactionData } from "../domain/finance";
import { translateError } from "../../../shared/i18n/messages";
import { useI18n } from "../../../shared/i18n/provider";
import { formatMoney } from "../../../shared/presentation/primitives";

export function CsvTools({ state, onImport }: { state: FinanceState; onImport: (entries: TransactionData[]) => Promise<void> }) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<CsvPreviewRow[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function download() {
    const url = URL.createObjectURL(new Blob([exportTransactionsCsv(state.transactions)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "simplytrack-transactions.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function load(file: File | undefined) {
    if (!file) return;
    setError(""); setRows(null); setSelected(new Set());
    try {
      if (file.size > 10_000_000) throw new Error("CSV file exceeds the 10 MB limit.");
      const preview = previewTransactionsCsv(await file.text(), state);
      setRows(preview);
      setSelected(new Set(preview.filter((row) => row.entry && !row.duplicate).map((row) => row.line)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read the CSV file."); }
  }
  async function submit() {
    setBusy(true); setError("");
    try {
      await onImport((rows ?? []).filter((row) => selected.has(row.line) && row.entry).map((row) => row.entry!));
      setRows(null); setSelected(new Set());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import transactions."); }
    finally { setBusy(false); }
  }
  return <details className="card planning-card csv-tools"><summary>{t("Import or export CSV")}</summary><div className="section-heading"><div><h2>{t("Transaction CSV")}</h2><p>{t("Export or import SimplyTrack transaction CSV files. Schedule and repayment links are not included. CSV exports are unencrypted.")}</p></div><button className="button secondary" onClick={download}>{t("Export CSV")}</button></div>
    <label>{t("Preview CSV import")}<input type="file" accept=".csv,text/csv" onChange={(event) => { void load(event.target.files?.[0]); event.target.value = ""; }} /></label>
    {error && <p role="alert" className="error">{translateError(language, error)}</p>}
    {rows && <><p className="help">{t("Possible duplicates are unselected. Review the rows and choose what to import.")}</p>{rows.length === 0 && <p>{t("The CSV contains no transactions.")}</p>}<div className="wrap-actions"><button type="button" className="text-button" onClick={() => setSelected(new Set(rows.filter((row) => row.entry).map((row) => row.line)))}>{t("Select all valid rows, including duplicates")}</button><button type="button" className="text-button" onClick={() => setSelected(new Set())}>{t("Clear selection")}</button></div><div className="stack">{rows.map((row) => <div key={row.line}>{row.entry ? <label className="checkbox"><input type="checkbox" checked={selected.has(row.line)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); if (event.target.checked) next.add(row.line); else next.delete(row.line); return next; })} />{row.entry.date} &middot; {row.entry.title} &middot; {formatMoney(row.entry.amount, state.settings.currency, language)}{row.duplicate && <> &middot; {t("Possible duplicate")}</>}</label> : <p role="alert" className="error">{t("Row {count}", { count: row.line })}: {translateError(language, row.error ?? "Invalid CSV transaction row.")}</p>}</div>)}</div><div className="wrap-actions"><button className="button primary" disabled={busy || selected.size === 0} onClick={() => void submit()}>{t("Import selected")}</button><button className="button secondary" disabled={busy} onClick={() => setRows(null)}>{t("Cancel")}</button></div></>}
  </details>;
}
