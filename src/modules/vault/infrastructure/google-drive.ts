import type { SyncVault } from "../application/sync-vault";
import { buffer, parseEnvelope } from "./crypto";

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; }
interface GoogleIdentity {
  accounts: { oauth2: { initTokenClient(config: {
    client_id: string; scope: string; callback: (response: TokenResponse) => void;
    error_callback: (error: { type: string }) => void;
  }): { requestAccessToken(options: { prompt: string }): void }; revoke(token: string, done: () => void): void; } };
}
declare global { interface Window { google?: GoogleIdentity; } }

export interface DriveFile {
  id: string;
  name: string;
  version: string;
  createdTime: string;
  parents: string[];
}
interface DriveFileResponse extends Omit<DriveFile, "parents"> {
  appProperties?: Record<string, string>;
}
interface SyncBase { fileId: string; remoteVersion: string; localRevision: string; bookId: string; }
interface SyncPreference { bookId: string; enabled: boolean; }
export interface DriveSnapshot { file: DriveFile; bytes: Uint8Array; }
export type DriveConflict = DriveSnapshot;
interface Restore {
  file: DriveFile;
  bytes: Uint8Array;
  expectedRevision: string;
}

const VAULT_NAME = "simply-track.vault";
const PARENT_PROPERTY_PREFIX = "stParent";
const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let identityScript: Promise<void> | undefined;

function loadIdentity() {
  if (window.google) return Promise.resolve();
  identityScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => resolve();
    script.onerror = () => { identityScript = undefined; script.remove(); reject(new Error("Google sign-in could not load. Check your connection.")); };
    document.head.append(script);
  });
  return identityScript;
}

function driveFile(file: DriveFileResponse): DriveFile {
  if (!file.id || !file.version || !Number.isFinite(Date.parse(file.createdTime))) {
    throw new Error("Drive snapshot history is invalid. Your local vault is unchanged; export a backup before changing Drive data.");
  }
  const parentProperties = Object.entries(file.appProperties ?? {})
    .filter(([key]) => key.startsWith(PARENT_PROPERTY_PREFIX))
    .sort(([left], [right]) => Number(left.slice(PARENT_PROPERTY_PREFIX.length)) - Number(right.slice(PARENT_PROPERTY_PREFIX.length)));
  if (parentProperties.some(([key, value], index) =>
    !/^\d+$/.test(key.slice(PARENT_PROPERTY_PREFIX.length)) ||
    Number(key.slice(PARENT_PROPERTY_PREFIX.length)) !== index ||
    !value
  )) throw new Error("Drive snapshot history is invalid. Your local vault is unchanged; export a backup before changing Drive data.");
  const parents = parentProperties.map(([, value]) => value);
  return { id: file.id, name: file.name, version: file.version, createdTime: file.createdTime, parents };
}

function newestFirst(left: DriveFile, right: DriveFile) {
  return Date.parse(right.createdTime) - Date.parse(left.createdTime) || right.id.localeCompare(left.id);
}

export class GoogleDriveSync {
  private token?: string;
  private expires = 0;
  conflict?: DriveConflict;
  private busy = false;
  private session = new AbortController();
  private operationSignal?: AbortSignal;
  private settled: Promise<void> = Promise.resolve();
  get running() { return this.busy; }
  cleanupWarning = false;
  syncedRevision?: string;
  constructor(private readonly vault: SyncVault) {}
  get connected() { return Boolean(this.token && Date.now() < this.expires); }
  async shouldResume(bookId: string) {
    const preference = await this.vault.store.get<SyncPreference>("drive-preference");
    if (preference) return preference.bookId === bookId && preference.enabled;
    // Existing installations already opted in when creating their sync baseline.
    const base = await this.vault.store.get<SyncBase>("drive-base");
    return base?.bookId === bookId;
  }
  async rememberSync(enabled: boolean) {
    const { id } = await this.vault.read();
    await this.vault.store.set("drive-preference", { bookId: id, enabled } satisfies SyncPreference);
  }
  async connect(automatic = false) {
    return this.exclusive(async () => {
      const signal = this.session.signal;
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      if (!clientId) throw new Error("Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and authorize this site's origin in Google Cloud.");
      await loadIdentity();
      signal.throwIfAborted();
      const google = window.google;
      if (!google) throw new Error("Google sign-in is unavailable.");
      await new Promise<void>((resolve, reject) => {
        const abort = () => { finish(); reject(signal.reason); };
        const timer = setTimeout(() => {
          finish();
          reject(new Error("Google sign-in timed out. Use Reconnect Google Drive to try again."));
        }, 60000);
        let completed = false;
        const finish = () => { completed = true; clearTimeout(timer); signal.removeEventListener("abort", abort); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const client = google.accounts.oauth2.initTokenClient({
            client_id: clientId, scope: "https://www.googleapis.com/auth/drive.appdata",
            callback: (response) => {
              if (completed) return;
              finish();
              if (!response.access_token || response.error) { reject(new Error(`Google sign-in failed: ${response.error ?? "no access token"}`)); return; }
              this.token = response.access_token;
              this.expires = Date.now() + (response.expires_in ?? 3600) * 1000;
              resolve();
            },
            error_callback: (error) => {
              if (completed) return;
              finish(); reject(new Error(`Google sign-in did not complete: ${error.type}`));
            },
          });
          client.requestAccessToken({ prompt: automatic ? "none" : "" });
        } catch (error) { finish(); reject(error); }
      });
    });
  }
  disconnect() {
    this.session.abort();
    this.session = new AbortController();
    this.token = undefined; this.expires = 0; this.conflict = undefined;
  }
  private async exclusive<T>(operation: () => Promise<T>) {
    if (this.busy) throw new Error("A Drive sync is already running.");
    this.busy = true;
    let release!: () => void;
    this.settled = new Promise<void>((resolve) => { release = resolve; });
    const signal = this.session.signal;
    this.operationSignal = signal;
    this.cleanupWarning = false;
    try {
      signal.throwIfAborted();
      return await operation();
    } finally { this.busy = false; this.operationSignal = undefined; release(); }
  }
  dismissConflict() { this.conflict = undefined; }
  private async request(path: string, init: RequestInit = {}, missingOk = false) {
    if (!this.connected) throw new Error("Connect to Google Drive again; your sign-in has expired.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    const signal = this.operationSignal ?? this.session.signal;
    signal.throwIfAborted();
    const response = await fetch(`https://www.googleapis.com${path}`, { ...init, headers, cache: "no-store", signal });
    signal.throwIfAborted();
    if (response.status === 401) { this.disconnect(); throw new Error("Google sign-in expired. Reconnect to sync."); }
    if (missingOk && response.status === 404) return response;
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}). Sync did not finish; check the current device and Drive copies before retrying.`);
    return response;
  }
  private async listSnapshots(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        spaces: "appDataFolder",
        q: `name = '${VAULT_NAME}' and trashed = false`,
        fields: "files(id,name,version,createdTime,appProperties),nextPageToken",
        pageSize: "1000",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const data = await (await this.request(`/drive/v3/files?${query}`)).json() as {
        files: DriveFileResponse[]; nextPageToken?: string;
      };
      files.push(...data.files.map(driveFile));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }
  private async currentCopies(): Promise<DriveFile[]> {
    const files = await this.listSnapshots();
    // Drive supplies the creation time; device clocks never choose the shared current copy.
    return files.sort(newestFirst);
  }
  private async pruneHistory() {
    const files = await this.listSnapshots();
    const cutoff = Date.now() - SNAPSHOT_RETENTION_MS;
    const current = [...files].sort(newestFirst)[0];
    const obsolete = files.filter((file) => file.id !== current?.id && Date.parse(file.createdTime) < cutoff);
    for (const file of obsolete) {
      await this.request(`/drive/v3/files/${encodeURIComponent(file.id)}`, { method: "DELETE" }, true);
    }
  }
  private async cleanup() {
    try { await this.pruneHistory(); }
    catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      this.cleanupWarning = true;
      console.warn("Drive sync completed, but snapshot cleanup failed.", error);
    }
  }
  private async download(file: DriveFile) {
    const response = await this.request(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    parseEnvelope(bytes);
    const latest = (await this.listSnapshots()).find((candidate) => candidate.id === file.id);
    if (!latest || latest.version !== file.version) throw new Error("The Drive vault changed while downloading. Sync again.");
    return bytes;
  }
  private async captureConflict(file: DriveFile) {
    const bytes = await this.download(file);
    this.operationSignal?.throwIfAborted();
    this.conflict = { file, bytes };
  }
  async sync(): Promise<"uploaded" | "restored" | "current" | "conflict"> {
    return this.exclusive(async () => {
      const result = await this.vault.serial<"uploaded" | "current" | "conflict" | Restore>(async () => {
        const copies = await this.currentCopies();
        const file = copies[0];
        if (!this.vault.isOpen()) {
          if (!file) throw new Error("There is no vault in this Google account yet. Create a local vault first.");
          await this.captureConflict(file);
          return "conflict";
        }
        const state = await this.vault.read();
        const bytes = await this.vault.export();
        const base = await this.vault.store.get<SyncBase>("drive-base");
        if (!file) {
          if (base) throw new Error("The previously synced Drive vault is missing. Disconnect and clear the sync link in settings before creating a new remote copy.");
          const created = await this.createSnapshot(bytes, []);
          await this.saveBase(created, state.revision, state.id);
          await this.cleanup();
          return "uploaded";
        }
        const sameRemote = base?.fileId === file.id && base.bookId === state.id && base.remoteVersion === file.version;
        if (sameRemote && base.localRevision === state.revision) {
          this.syncedRevision = state.revision;
          await this.cleanup();
          return "current";
        }
        if (!sameRemote) {
          const remoteBytes = await this.download(file);
          const remote = await this.vault.inspectSyncCopy(remoteBytes);
          if (remote?.id === state.id && remote.revision === state.revision) {
            await this.saveBase(file, state.revision, state.id);
            await this.cleanup();
            return "current";
          }
          // Drive versions include metadata changes; compare the decrypted baseline before declaring a conflict.
          const remoteUnchanged = remote?.id === state.id && base?.bookId === state.id && remote.revision === base.localRevision;
          if (!remoteUnchanged) {
            if (remote?.id === state.id && base?.bookId === state.id && base.localRevision === state.revision) {
              return { file, bytes: remoteBytes, expectedRevision: state.revision };
            }
            this.conflict = { file, bytes: remoteBytes };
            return "conflict";
          }
        }
        const created = await this.createSnapshot(bytes, [file.id]);
        await this.saveBase(created, state.revision, state.id);
        await this.cleanup();
        return "uploaded";
      });
      if (typeof result === "string") return result;
      this.operationSignal?.throwIfAborted();
      const restored = await this.vault.restoreSyncCopy(result.bytes, result.expectedRevision, this.operationSignal);
      if (!restored) {
        this.conflict = { file: result.file, bytes: result.bytes };
        return "conflict";
      }
      try {
        await this.saveBase(result.file, restored.revision, restored.id);
      } catch (error) {
        throw new Error("The Drive choice could not be fully applied. Device data may have changed; review the displayed records and sync again. Your encrypted backup and Drive snapshots are preserved.", { cause: error });
      }
      await this.cleanup();
      return "restored";
    });
  }
  private async createSnapshot(bytes: Uint8Array, parents: string[]) {
    if (parents.length > 30) throw new Error("Too many concurrent Drive copies to resolve automatically. Your vaults are unchanged; export backups and contact support.");
    const boundary = `simplytrack_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata = JSON.stringify({
      name: VAULT_NAME,
      parents: ["appDataFolder"],
      appProperties: Object.fromEntries(parents.map((id, index) => [`${PARENT_PROPERTY_PREFIX}${index}`, id])),
    });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      buffer(bytes),
      `\r\n--${boundary}--\r\n`,
    ]);
    const response = await this.request("/upload/drive/v3/files?uploadType=multipart&fields=id,name,version,createdTime,appProperties", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    return driveFile(await response.json() as DriveFileResponse);
  }
  private async saveBase(file: DriveFile, localRevision: string, bookId: string) {
    this.operationSignal?.throwIfAborted();
    await this.vault.store.set("drive-base", { fileId: file.id, remoteVersion: file.version, localRevision, bookId } satisfies SyncBase);
    this.syncedRevision = localRevision;
  }
  private async verifyConflictIsCurrent(pending: DriveConflict) {
    const current = (await this.currentCopies()).slice(0, 1);
    if (current[0]?.id !== pending.file.id || current[0]?.version !== pending.file.version) {
      throw new Error("The Drive copies changed. Sync again before resolving.");
    }
  }
  async useDrive(password: string) {
    return this.exclusive(async () => {
      const signal = this.session.signal;
      const pending = this.conflict;
      if (!pending) throw new Error("No Drive conflict is pending.");
      await this.verifyConflictIsCurrent(pending);
      const commit = await this.vault.prepareReplacement(pending.bytes, password);
      signal.throwIfAborted();
      const resolved = pending.file;
      signal.throwIfAborted();
      try {
        await commit();
        await this.vault.serial(async () => {
          const state = await this.vault.read();
          await this.saveBase(resolved, state.revision, state.id);
        });
      } catch (error) {
        throw new Error("The Drive choice could not be fully applied. Device data may have changed; review the displayed records and sync again. Your encrypted backup and Drive snapshots are preserved.", { cause: error });
      }
      this.conflict = undefined;
      await this.cleanup();
    });
  }
  async useDevice() {
    return this.exclusive(async () => {
      const pending = this.conflict;
      if (!pending) throw new Error("No Drive conflict is pending.");
      await this.vault.serial(async () => {
        await this.verifyConflictIsCurrent(pending);
        const state = await this.vault.read();
        const resolved = await this.createSnapshot(await this.vault.export(), [pending.file.id]);
        await this.saveBase(resolved, state.revision, state.id);
        this.conflict = undefined;
        await this.cleanup();
      });
    });
  }
  async forgetLink() {
    this.disconnect();
    await this.settled;
    await this.vault.store.set("drive-base", undefined);
    await this.vault.store.set("drive-preference", undefined);
  }
}
