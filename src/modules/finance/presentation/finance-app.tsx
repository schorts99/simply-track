"use client";

import { LanguageSelect, useI18n } from "../../../shared/i18n/provider";
import { ThemeSelect } from "../../../shared/theme/provider";
import { translateError } from "../../../shared/i18n/messages";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Cloud, Download, Fingerprint, LayoutDashboard, LockKeyhole, LogOut, Plus, ReceiptText, Settings2, ShieldCheck, Sparkles, Target, TrendingUp, Upload, WifiOff, X } from "lucide-react";
import { localDate, type Command, type FinanceState } from "../domain/finance";
import { getVault, downloadVault } from "../../../composition/vault";
import { GoogleDriveSync } from "../../vault/infrastructure/google-drive";
import { FinanceForm, type Editor } from "./finance-forms";
import { ForecastView, newQuickTransaction, Overview, PlanningView, ScenariosView, TransactionView, type Tab } from "./finance-views";
import { BrandMark, Modal } from "../../../shared/presentation/primitives";
import { LegalLinks } from "../../legal/presentation/legal-page";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const tabs = [
  { id: "overview", label: "Overview", short: "Home", Icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", short: "Activity", Icon: ReceiptText },
  { id: "planning", label: "Budgets & goals", short: "Plan", Icon: Target },
  { id: "forecast", label: "Cashflow forecast", short: "Forecast", Icon: TrendingUp },
  { id: "scenarios", label: "What-if scenarios", short: "What if", Icon: Sparkles },
] as const;
const headings: Record<Tab, { title: string; subtitle: string }> = {
  overview: { title: "A little clarity. A lot of possibility.", subtitle: "Your money, in a simpler light." },
  transactions: { title: "All the little ins and outs.", subtitle: "Your everyday money story, in one place." },
  planning: { title: "A plan for the things that matter.", subtitle: "Spend with intention. Save with a purpose." },
  forecast: { title: "A little more peace of mind.", subtitle: "See where your current habits could take you." },
  scenarios: { title: "What could look different?", subtitle: "Explore the possibilities before making a change." },
};
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }

export default function FinanceApp() {
  const { t, language } = useI18n();
  const [vault] = useState(getVault);
  const [drive] = useState(() => new GoogleDriveSync(vault));
  const [state, setState] = useState<FinanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootFailed, setBootFailed] = useState(false);
  const [exists, setExists] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [canBiometric, setCanBiometric] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Stored on this device");
  const [conflict, setConflict] = useState(false);
  const [importBytes, setImportBytes] = useState<Uint8Array | null>(null);
  const [deletion, setDeletion] = useState<{ kind: "transaction" | "budget" | "goal" | "scenario"; id: string } | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [storage, setStorage] = useState("");
  const operation = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const subscriber = {
      subscribedTo: () => ["finance.changed"],
      handle: async () => setState(await vault.read()),
    };
    vault.events.subscribe("finance.changed", subscriber);
    void vault.initialize().then(async () => {
      setExists(await vault.exists());
      if (vault.isOpen()) setState(await vault.read());
      setBiometric(await vault.biometricStatus());
      setCanBiometric(await vault.biometrics.available());
      setStorage(await vault.store.backend());
    }).catch((error) => { setError(message(error)); setBootFailed(true); }).finally(() => setLoading(false));
    const connectivity = () => setOnline(navigator.onLine);
    connectivity();
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt); };
    const installed = () => setInstall(null);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", installed);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((error) => setError(`Offline support could not be enabled: ${message(error)}`));
    }
    return () => {
      vault.events.unsubscribe("finance.changed", subscriber);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, [vault]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const syncNow = useCallback(async () => {
    setSyncStatus("Syncing encrypted vault...");
    try {
      const result = await drive.sync();
      if (result === "conflict") {
        setConflict(true); setSyncStatus("Drive copy needs review");
      } else setSyncStatus("Up to date with Google Drive");
    } catch (error) {
      setSyncStatus("Sync paused; saved on device");
      setError(message(error));
      setDriveConnected(drive.connected);
    }
  }, [drive]);
  useEffect(() => {
    if (!state || !driveConnected || !online || conflict) return;
    const timer = setTimeout(() => { void syncNow(); }, 1800);
    return () => clearTimeout(timer);
  }, [state, driveConnected, online, conflict, syncNow]);

  async function perform(action: () => Promise<void>, success?: string) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try { await action(); if (success) setNotice(success); }
    catch (error) { setError(message(error)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function save(command: Command) {
    await vault.execute(command);
    setEditor(null); setNotice("Saved to your encrypted vault");
  }
  async function connectDrive() {
    await drive.connect(); setDriveConnected(true);
    await syncNow();
  }
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password"));
    await perform(async () => {
      if (exists) await vault.unlock(password);
      else {
        if (password !== data.get("confirm")) throw new Error("The passwords do not match.");
        await vault.create(password);
      }
      form.reset(); setExists(true); setState(await vault.read());
    });
  }
  function changeMonth(offset: number) {
    const [year, value] = month.split("-").map(Number);
    setMonth(localDate(new Date(year, value - 1 + offset, 1)).slice(0, 7));
  }
  function navigate(next: Tab) {
    setTab(next);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }
  async function installApp() {
    if (install) {
      await install.prompt();
      await install.userChoice; setInstall(null);
    } else setNotice("Use your browser's Install app menu, or Share > Add to Home Screen on iPhone and iPad.");
  }

  const errorBanner = error && <div className="alert error-alert" role="alert"><span>{translateError(language, error)}</span><button aria-label={t("Dismiss error")} className="icon-button" onClick={() => setError("")}><X size={17} /></button></div>;
  const nav = (mobile = false) => <nav aria-label={mobile ? t("Mobile navigation") : t("Main navigation")} className={mobile ? "bottom-nav" : "main-nav"}>{tabs.map(({ id, label, short, Icon }) => <button key={id} aria-current={tab === id ? "page" : undefined} className={tab === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={19} /><span>{t(mobile ? short : label)}</span>{!mobile && tab === id && <i />}</button>)}</nav>;
  const currentTabLabel = t(tabs.find((item) => item.id === tab)!.label);
  const editorTitles = {
    transaction: { new: "New transaction", edit: "Edit transaction" },
    budget: { new: "New budget", edit: "Edit budget" },
    goal: { new: "New goal", edit: "Edit goal" },
    scenario: { new: "New scenario", edit: "Edit scenario" },
  } as const;
  const viewProps = state ? { state, month, edit: setEditor, remove: (kind: "transaction" | "budget" | "goal" | "scenario", id: string) => setDeletion({ kind, id }) } : null;
  return <>
    <input ref={importInput} className="sr-only" type="file" accept=".vault,application/octet-stream,application/json" aria-label={t("Import encrypted vault file")} onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) void perform(async () => {
        if (file.size > 64 * 1024 * 1024) throw new Error("Vault files must be smaller than 64 MB.");
        setImportBytes(new Uint8Array(await file.arrayBuffer()));
      });
      event.target.value = "";
    }} />
    {!state ? <main className="unlock-page" id="main-content" tabIndex={-1}><div className="unlock-preferences"><LanguageSelect /><ThemeSelect /></div><div className="unlock-decoration" /><div className="unlock-brand"><span className="brand-icon"><BrandMark /></span>simply<span>track</span></div>
      <section className="unlock-card"><span className="eyebrow"><ShieldCheck size={14} /> {t("YOUR MONEY. YOUR SPACE.")}</span><h1>{loading ? t("A moment of clarity.") : exists ? t("Welcome back.") : t("A simpler relationship with money.")}</h1><p>{exists ? t("Your private space is right where you left it. Unlock your vault to settle in.") : t("Less noise. More intention. Track the everyday and make room for what matters.")}</p>
        {errorBanner}
        {loading ? <p className="loading-text">{t("Opening your device storage...")}</p> : bootFailed ? <button className="button secondary" onClick={() => window.location.reload()}>{t("Reload after resolving the storage error")}</button> : <form className="stack" onSubmit={unlock}>
          <label>{t("Vault password")}<input name="password" type="password" autoComplete={exists ? "current-password" : "new-password"} minLength={exists ? 1 : 12} required autoFocus placeholder={exists ? t("Enter your password") : t("At least 12 characters")} /></label>
          {!exists && <><label>{t("Confirm password")}<input name="confirm" type="password" autoComplete="new-password" minLength={12} required placeholder={t("One more time")} /></label><p className="help">{t("Your password encrypts your SQLite database. There is no password recovery, so keep it somewhere safe.")}</p></>}
          <button className="button primary" disabled={busy}>{busy ? t("Opening...") : exists ? t("Unlock my vault") : t("Create my private vault")}<ArrowRight size={17} /></button>
          {biometric && <button type="button" className="button secondary" disabled={busy} onClick={() => void perform(async () => { await vault.biometricUnlock(); setState(await vault.read()); })}><Fingerprint size={18} /> {t("Unlock with this device")}</button>}
        </form>}
        {!loading && !bootFailed && <div className="unlock-alternatives"><button className="text-button" disabled={busy} onClick={() => importInput.current?.click()}><Upload size={15} />{t("Import a vault")}</button><button className="text-button" disabled={busy || !online} onClick={() => void perform(connectDrive)}><Cloud size={16} />{t("Open from Drive")}</button></div>}
        <p className="privacy-note"><LockKeyhole size={13} /> {t("Encrypted on your device. No finance server. No ads.")}</p>
      </section><p className="unlock-footer">{t("A little clarity, every day.")}</p><LegalLinks /></main> : <div className="app-shell" aria-busy={busy}>
      <aside className="sidebar"><button className="brand" onClick={() => navigate("overview")}><span className="brand-icon"><BrandMark /></span><span>simply<span className="brand-light">track</span><small>{t("A LITTLE MORE CLARITY")}</small></span></button>
        <span className="nav-label">{t("YOUR WORKSPACE")}</span>{nav()}
        <div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={20} /><strong>{t("Just yours.")}</strong><p>{t("Your data stays encrypted.")}<br />{t("Your peace of mind stays intact.")}</p></div><button className="sidebar-action" onClick={() => setSettings(true)}><Settings2 size={18} /> {t("Settings & storage")}</button><button className="sidebar-action" disabled={busy} onClick={() => void perform(async () => { drive.disconnect(); setDriveConnected(false); await vault.logout(); setState(null); setSettings(false); })}><LogOut size={18} /> {t("Lock & log out")}</button><span className="sidebar-version">{t("SimplyTrack · Made for the everyday")}</span></div>
      </aside>
      <div className="workspace"><header className="topbar"><span className="breadcrumb"><span className="workspace-name">{state.settings.workspaceName || t("Your workspace")}</span> <span>/</span> <strong>{currentTabLabel}</strong></span><button className="mobile-brand" onClick={() => navigate("overview")}><BrandMark /><span>{state.settings.workspaceName || "simplytrack"}</span></button><div className="topbar-actions"><span className={`storage-status ${online ? "" : "offline"}`}>{online ? <LockKeyhole size={13} /> : <WifiOff size={14} />}<span>{online ? t("Private & encrypted") : t("Offline · saved on device")}</span></span><button className="icon-button mobile-settings" aria-label={t("Settings")} onClick={() => setSettings(true)}><Settings2 size={20} /></button><button className="avatar" onClick={() => setSettings(true)} aria-label={t("Open your vault settings")} title={state.settings.profileName || t("Open your vault settings")}>{Array.from(state.settings.profileName.trim())[0]?.toLocaleUpperCase(language) || "Y"}</button></div></header>
        <main className="main-content" id="main-content" tabIndex={-1}><div className="page-heading"><div><span className="eyebrow">{new Date(`${month}-15T12:00:00`).toLocaleDateString(language, { month: "long", year: "numeric" })} &nbsp; / &nbsp; {tab === "overview" ? t("THE BIG PICTURE") : currentTabLabel.toLocaleUpperCase(language)}</span><h1>{t(headings[tab].title)}</h1><p>{t(headings[tab].subtitle)}</p></div><button className="button primary add-transaction" disabled={busy} onClick={() => setEditor({ kind: "transaction" })}><Plus size={17} />{t("Add transaction")}</button></div>
          {errorBanner}
          <div className="month-toolbar"><div className="month-controls"><div className="month-picker"><button className="icon-button" aria-label={t("Previous month")} onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button><label><span className="sr-only">{t("Selected month")}</span><input type="month" required value={month} onChange={(e) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} /></label><button className="icon-button" aria-label={t("Next month")} onClick={() => changeMonth(1)}><ChevronRight size={16} /></button></div>{month !== localDate().slice(0, 7) && <button className="text-button current-month" onClick={() => setMonth(localDate().slice(0, 7))}>{t("This month")}</button>}</div><button className="text-button sync-label" onClick={() => setSettings(true)}><span className={`status-dot ${syncStatus.includes("paused") || conflict ? "amber" : ""}`} />{t(syncStatus)}</button></div>
          <div className="view-stack">{viewProps && <>
            {tab === "overview" && <Overview {...viewProps} navigate={navigate} quickAdd={(title, amount, category, paymentMethod) => void perform(async () => { await vault.execute({ type: "transaction.save", data: newQuickTransaction(title, amount, category, paymentMethod, localDate().startsWith(month) ? localDate() : `${month}-01`) }); }, "Transaction recorded")} />}
            {tab === "transactions" && <TransactionView {...viewProps} />}
            {tab === "planning" && <PlanningView {...viewProps} />}
            {tab === "forecast" && <ForecastView {...viewProps} />}
            {tab === "scenarios" && <ScenariosView {...viewProps} />}
          </>}</div>
          <footer className="page-footer"><span>{t("Built around your life. Not the other way around.")}</span><span><ShieldCheck size={13} /> {t("Local-first. Always yours.")}</span><LegalLinks /></footer>
        </main>{nav(true)}
      </div>
    </div>}
    {notice && <div className="toast"><span role="status"><Check size={17} />{t(notice)}</span><button type="button" className="icon-button" aria-label={t("Dismiss notification")} onClick={() => setNotice("")}><X size={16} /></button></div>}
    {editor && state && <Modal title={t(editor.kind === "preferences" ? "Your preferences" : editorTitles[editor.kind][editor.data ? "edit" : "new"])} onClose={() => setEditor(null)}><FinanceForm editor={editor} settings={state.settings} month={month} busy={busy} onSave={save} /></Modal>}
    {deletion && <Modal title={t("Remove this record?")} error={error} onClose={() => setDeletion(null)}><p>{t("This permanently removes the record from your vault. Other records won't be changed.")}</p><div className="dialog-actions"><button className="button secondary" onClick={() => setDeletion(null)}>{t("Keep it")}</button><button className="button danger" disabled={busy} onClick={() => void perform(async () => { await vault.execute({ type: `${deletion.kind}.delete`, id: deletion.id }); setDeletion(null); }, "Record removed")}>{t("Remove record")}</button></div></Modal>}
    {settings && state && <Modal title={t("Your space, your settings")} error={error} onClose={() => setSettings(false)}>
      <div className="settings-stack"><section className="display-preferences"><LanguageSelect /><ThemeSelect /></section><section><h3>{state.settings.profileName || t("Preferences")}</h3>{state.settings.workspaceName && <p>{state.settings.workspaceName}</p>}<p>{t("Customize your profile, categories, payment methods, quick actions and forecast assumptions.")}</p><button className="button secondary" onClick={() => { setSettings(false); setEditor({ kind: "preferences", data: state.settings }); }}><Settings2 size={16} />{t("Edit preferences")}</button></section>
        <section><h3><LockKeyhole size={17} /> {t("Encrypted device vault")}</h3><p>{t("Your data is encrypted on this device. Export a backup before clearing browser data.")}</p><details className="settings-details"><summary>{t("Storage & security details")}</summary><p>{t("SQLite, encrypted with AES-256-GCM. Stored")} {storage === "opfs" ? t("as simply-track.vault in this browser's private device filesystem") : t("in this browser's device storage (IndexedDB fallback)")}{t(". Clearing site data removes it. Keep a backup.")}</p><p className="help">{t("This tab stays unlocked across reloads until you log out. A non-extractable encryption key is kept in browser storage for that session. Anyone with access to this unlocked browser session can view your data.")}</p></details><div className="wrap-actions"><button className="button secondary" disabled={busy} onClick={() => void perform(async () => downloadVault(await vault.export()), "Encrypted backup downloaded")}><Download size={16} />{t("Export backup")}</button><button className="button secondary" disabled={busy} onClick={() => importInput.current?.click()}><Upload size={16} />{t("Import backup")}</button></div></section>
        <section><h3><Cloud size={17} /> {t("Google Drive")}</h3><p>{t("Keep an encrypted copy in Google Drive to use the same vault on other devices.")}</p><details className="settings-details"><summary>{t("How sync works")}</summary><p>{t("Sync only the encrypted vault to your Google account's private app-data folder. Use the same Google account and vault password on each device. Reconnect after reload; Google access tokens are not saved.")}</p><p className="help">{t(syncStatus)}{t(". When connected, saved edits sync automatically while online. Conflicting copies always need your review.")}</p></details><div className="wrap-actions">{driveConnected ? <><button className="button secondary" disabled={busy || !online} onClick={() => void perform(syncNow)}>{t("Sync now")}</button><button className="button secondary" onClick={() => { drive.disconnect(); setDriveConnected(false); setSyncStatus("Stored on this device"); }}>{t("Disconnect")}</button></> : <button className="button secondary" disabled={busy || !online} onClick={() => void perform(connectDrive)}><Cloud size={16} />{t("Connect Google Drive")}</button>}<button className="text-button" disabled={busy} onClick={() => void perform(async () => { await drive.forgetLink(); setDriveConnected(false); setSyncStatus("Stored on this device"); }, "Sync link cleared; Drive file is unchanged")}>{t("Clear sync link")}</button></div></section>
        <section><h3><Fingerprint size={17} /> {t("Device unlock")}</h3><p>{t("Optional platform authentication using WebAuthn PRF. Your device may use biometrics or its PIN. Availability depends on your browser and authenticator; password unlock always works.")}</p>{biometric ? <button className="button secondary" disabled={busy} onClick={() => void perform(async () => { await vault.biometrics.disable(); setBiometric(false); }, "Device unlock disabled")}>{t("Disable device unlock")}</button> : canBiometric ? <form className="stack" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const password = String(new FormData(form).get("password")); void perform(async () => { await vault.enrollBiometrics(password); setBiometric(true); form.reset(); }, "Device unlock enabled"); }}><label>{t("Confirm your vault password")}<input name="password" type="password" required autoComplete="current-password" /></label><button className="button secondary" disabled={busy}><Fingerprint size={16} />{t("Enable device unlock")}</button></form> : <p className="help">{t("No compatible platform authenticator was detected on this device.")}</p>}</section>
        <section><h3>{t("Take SimplyTrack with you")}</h3><p>{t("Install it for a focused, offline-ready workspace. On iOS, use Share > Add to Home Screen.")}</p><button className="button secondary" onClick={() => void perform(installApp)}><Download size={16} />{t("Install app")}</button></section>
        <button className="button secondary" disabled={busy} onClick={() => void perform(async () => { drive.disconnect(); setDriveConnected(false); await vault.logout(); setState(null); setSettings(false); }, "Vault locked")}><LogOut size={16} />{t("Lock vault & log out")}</button>
      </div>
    </Modal>}
    {importBytes && <Modal title={exists ? t("Replace this device's vault?") : t("Open an encrypted backup")} error={error} onClose={() => setImportBytes(null)}><p>{exists ? t("This replaces all local records. An encrypted backup of your current vault will be downloaded first. Your Drive copy is not automatically replaced.") : t("Enter the password used to encrypt this vault.")}</p><form className="stack" onSubmit={(event) => { event.preventDefault(); const password = String(new FormData(event.currentTarget).get("password")); void perform(async () => { if (exists) downloadVault(await vault.export(), `simply-track-before-import-${Date.now()}.vault`); await vault.replace(importBytes, password); await drive.forgetLink(); setDriveConnected(false); setSyncStatus("Stored on this device"); setBiometric(false); setExists(true); setState(await vault.read()); setImportBytes(null); setSettings(false); }, "Encrypted vault imported"); }}><label>{t("Backup password")}<input name="password" type="password" autoComplete="current-password" required /></label>{exists && <label className="checkbox"><input type="checkbox" required />{t("I understand this replaces my device's records.")}</label>}<button className="button primary" disabled={busy}>{t("Unlock & import vault")}</button></form></Modal>}
    {conflict && <Modal title={t("Choose the vault to keep")} error={error} onClose={() => { setConflict(false); drive.disconnect(); setDriveConnected(false); setSyncStatus("Sync paused; saved on device"); }}>
      <p>{t("The Drive copy is different from this device's last synced version. Records are never silently merged or overwritten.")}</p><p className="help">{t("Before replacing a copy, SimplyTrack downloads an encrypted backup of it. Keep that file until you have verified the result.")}</p>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); const password = String(new FormData(event.currentTarget).get("password")); void perform(async () => { if (await vault.exists()) downloadVault(await vault.export(), `simply-track-device-before-sync-${Date.now()}.vault`); await drive.useDrive(password); setState(await vault.read()); setExists(true); setBiometric(false); setConflict(false); setSyncStatus("Up to date with Google Drive"); }, "Opened the Drive vault"); }}>
        <label>{t("Drive vault password")}<input name="password" type="password" autoComplete="current-password" required /></label><button className="button primary" disabled={busy}><Cloud size={16} />{t("Use the Drive copy on this device")}</button>
      </form>
      {state && <form className="stack conflict-device" onSubmit={(event) => { event.preventDefault(); void perform(async () => { if (!drive.conflict) throw new Error("Sync again to load the latest conflict."); downloadVault(drive.conflict.bytes, `simply-track-drive-before-sync-${Date.now()}.vault`); await drive.useDevice(); setConflict(false); setSyncStatus("Up to date with Google Drive"); }, "Uploaded the device vault"); }}><label className="checkbox"><input type="checkbox" required />{t("Replace the Drive copy with this device's records.")}</label><button className="button secondary" disabled={busy}>{t("Keep this device's copy instead")}</button></form>}
    </Modal>}
  </>;
}
