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
export interface DriveSnapshot { file: DriveFile; bytes: Uint8Array; }
export interface DriveConflict { snapshots: DriveSnapshot[]; }

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

export class GoogleDriveSync {
  private token?: string;
  private expires = 0;
  conflict?: DriveConflict;
  private busy = false;
  constructor(private readonly vault: SyncVault) {}
  get connected() { return Boolean(this.token && Date.now() < this.expires); }
  async connect() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and authorize this site's origin in Google Cloud.");
    await loadIdentity();
    const google = window.google;
    if (!google) throw new Error("Google sign-in is unavailable.");
    await new Promise<void>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: "https://www.googleapis.com/auth/drive.appdata",
        callback: (response) => {
          if (!response.access_token || response.error) { reject(new Error(`Google sign-in failed: ${response.error ?? "no access token"}`)); return; }
          this.token = response.access_token;
          this.expires = Date.now() + (response.expires_in ?? 3600) * 1000;
          resolve();
        },
        error_callback: (error) => reject(new Error(`Google sign-in did not complete: ${error.type}`)),
      });
      client.requestAccessToken({ prompt: "" });
    });
  }
  disconnect() { this.token = undefined; this.expires = 0; this.conflict = undefined; }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.connected) throw new Error("Connect to Google Drive again; your sign-in has expired.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    const response = await fetch(`https://www.googleapis.com${path}`, { ...init, headers, cache: "no-store" });
    if (response.status === 401) { this.disconnect(); throw new Error("Google sign-in expired. Reconnect to sync."); }
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}). Your local vault is unchanged.`);
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
  private async leaves(): Promise<DriveFile[]> {
    const files = await this.listSnapshots();
    const parents = new Set(files.flatMap((file) => file.parents));
    const leaves = files.filter((file) => !parents.has(file.id));
    if (!leaves.length && files.length) throw new Error("Drive snapshot history is invalid. Your local vault is unchanged; export a backup before changing Drive data.");
    return leaves.sort((left, right) => right.createdTime.localeCompare(left.createdTime) || left.id.localeCompare(right.id));
  }
  private async pruneHistory() {
    const files = await this.listSnapshots();
    const parentIds = new Set(files.flatMap((file) => file.parents));
    const cutoff = Date.now() - SNAPSHOT_RETENTION_MS;
    const heads = new Set(files.filter((file) => !parentIds.has(file.id)).map((file) => file.id));
    const obsolete = files.filter((file) => !heads.has(file.id) && Date.parse(file.createdTime) < cutoff);
    for (const file of obsolete) {
      await this.request(`/drive/v3/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
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
  private async captureConflict(files: DriveFile[]) {
    const snapshots = await Promise.all(files.map(async (file) => ({ file, bytes: await this.download(file) })));
    this.conflict = { snapshots };
  }
  async sync(): Promise<"uploaded" | "current" | "conflict"> {
    if (this.busy) throw new Error("A Drive sync is already running.");
    this.busy = true;
    try {
      return await this.vault.serial(async () => {
        const leaves = await this.leaves();
        if (!this.vault.isOpen()) {
          if (!leaves.length) throw new Error("There is no vault in this Google account yet. Create a local vault first.");
          await this.captureConflict(leaves);
          return "conflict";
        }
        const state = await this.vault.read();
        const bytes = await this.vault.export();
        const base = await this.vault.store.get<SyncBase>("drive-base");
        if (!leaves.length) {
          if (base) throw new Error("The previously synced Drive vault is missing. Disconnect and clear the sync link in settings before creating a new remote copy.");
          const created = await this.createSnapshot(bytes, []);
          await this.saveBase(created, state.revision, state.id);
          await this.pruneHistory();
          return "uploaded";
        }
        if (leaves.length !== 1) {
          await this.captureConflict(leaves);
          return "conflict";
        }
        const file = leaves[0];
        if (!base || base.fileId !== file.id || base.bookId !== state.id || base.remoteVersion !== file.version) {
          await this.captureConflict(leaves);
          return "conflict";
        }
        if (base.localRevision === state.revision) {
          await this.pruneHistory();
          return "current";
        }
        const created = await this.createSnapshot(bytes, [file.id]);
        await this.saveBase(created, state.revision, state.id);
        await this.pruneHistory();
        return "uploaded";
      });
    } finally { this.busy = false; }
  }
  private async createSnapshot(bytes: Uint8Array, parents: string[]) {
    if (parents.length > 30) throw new Error("Too many concurrent Drive copies to resolve automatically. Your vaults are unchanged; export backups and contact support.");
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({
      name: VAULT_NAME,
      parents: ["appDataFolder"],
      appProperties: Object.fromEntries(parents.map((id, index) => [`${PARENT_PROPERTY_PREFIX}${index}`, id])),
    })], { type: "application/json" }));
    form.append("file", new Blob([buffer(bytes)], { type: "application/octet-stream" }));
    const response = await this.request("/upload/drive/v3/files?uploadType=multipart&fields=id,name,version,createdTime,appProperties", {
      method: "POST", body: form,
    });
    return driveFile(await response.json() as DriveFileResponse);
  }
  private saveBase(file: DriveFile, localRevision: string, bookId: string) {
    return this.vault.store.set("drive-base", { fileId: file.id, remoteVersion: file.version, localRevision, bookId } satisfies SyncBase);
  }
  private async verifyConflictIsCurrent(pending: DriveConflict) {
    const current = await this.leaves();
    const expected = pending.snapshots.map(({ file }) => `${file.id}:${file.version}`).sort();
    const actual = current.map((file) => `${file.id}:${file.version}`).sort();
    if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) {
      throw new Error("The Drive copies changed. Sync again before resolving.");
    }
  }
  async useDrive(fileId: string, password: string) {
    const pending = this.conflict;
    if (!pending) throw new Error("No Drive conflict is pending.");
    await this.verifyConflictIsCurrent(pending);
    const selected = pending.snapshots.find(({ file }) => file.id === fileId);
    if (!selected) throw new Error("Choose a current Drive snapshot before resolving.");
    await this.vault.replace(selected.bytes, password);
    const state = await this.vault.read();
    const resolved = await this.createSnapshot(await this.vault.export(), pending.snapshots.map(({ file }) => file.id));
    await this.saveBase(resolved, state.revision, state.id);
    this.conflict = undefined;
    await this.pruneHistory();
  }
  async useDevice() {
    const pending = this.conflict;
    if (!pending) throw new Error("No Drive conflict is pending.");
    await this.vault.serial(async () => {
      await this.verifyConflictIsCurrent(pending);
      const state = await this.vault.read();
      const resolved = await this.createSnapshot(await this.vault.export(), pending.snapshots.map(({ file }) => file.id));
      await this.saveBase(resolved, state.revision, state.id);
      this.conflict = undefined;
      await this.pruneHistory();
    });
  }
  async forgetLink() {
    this.disconnect();
    await this.vault.store.set("drive-base", undefined);
  }
}
