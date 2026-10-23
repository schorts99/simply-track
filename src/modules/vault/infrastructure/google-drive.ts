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
export interface DriveFile { id: string; name: string; version: string; etag: string; }
interface SyncBase { fileId: string; remoteVersion: string; localRevision: string; bookId: string; }
export interface DriveConflict { file: DriveFile; bytes: Uint8Array; }

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
    if (response.status === 412) throw new Error("The Drive vault changed during sync. Sync again to review the latest copy; nothing was overwritten.");
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}). Your local vault is unchanged.`);
    return response;
  }
  private async metadata(id: string): Promise<DriveFile> {
    const response = await this.request(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,version`);
    const data = await response.json() as Omit<DriveFile, "etag">;
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("Google Drive did not expose a revision ETag. Sync was stopped to prevent unsafe overwrites.");
    return { ...data, etag };
  }
  private async find(): Promise<DriveFile | undefined> {
    const query = new URLSearchParams({ spaces: "appDataFolder", q: "name = 'simply-track.vault' and trashed = false", fields: "files(id),nextPageToken", pageSize: "10" });
    const data = await (await this.request(`/drive/v3/files?${query}`)).json() as { files: { id: string }[]; nextPageToken?: string };
    if (data.files.length > 1 || data.nextPageToken) throw new Error("Multiple Drive vaults were found. Sync is paused; export your local backup before removing duplicate app data in Google Drive settings.");
    return data.files[0] ? this.metadata(data.files[0].id) : undefined;
  }
  private async download(file: DriveFile) {
    const response = await this.request(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers: { "If-Match": file.etag } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    parseEnvelope(bytes);
    const after = await this.metadata(file.id);
    if (after.version !== file.version) throw new Error("The Drive vault changed while downloading. Sync again.");
    return bytes;
  }
  async sync(): Promise<"uploaded" | "current" | "conflict"> {
    if (this.busy) throw new Error("A Drive sync is already running.");
    this.busy = true;
    try {
      return await this.vault.serial(async () => {
        const file = await this.find();
        if (!this.vault.isOpen()) {
          if (!file) throw new Error("There is no vault in this Google account yet. Create a local vault first.");
          this.conflict = { file, bytes: await this.download(file) };
          return "conflict";
        }
        const state = await this.vault.read();
        const bytes = await this.vault.export();
        const base = await this.vault.store.get<SyncBase>("drive-base");
        if (!file) {
          if (base) throw new Error("The previously synced Drive vault is missing. Disconnect and clear the sync link in settings before creating a new remote copy.");
          const form = new FormData();
          form.append("metadata", new Blob([JSON.stringify({ name: "simply-track.vault", parents: ["appDataFolder"] })], { type: "application/json" }));
          form.append("file", new Blob([buffer(bytes)], { type: "application/octet-stream" }));
          const created = await (await this.request("/upload/drive/v3/files?uploadType=multipart&fields=id,name,version", { method: "POST", body: form })).json() as DriveFile;
          await this.saveBase(created, state.revision, state.id);
          return "uploaded";
        }
        if (!base || base.fileId !== file.id || base.bookId !== state.id || base.remoteVersion !== file.version) {
          this.conflict = { file, bytes: await this.download(file) };
          return "conflict";
        }
        if (base.localRevision === state.revision) return "current";
        const uploaded = await this.upload(file, bytes);
        await this.saveBase(uploaded, state.revision, state.id);
        return "uploaded";
      });
    } finally { this.busy = false; }
  }
  private async upload(file: DriveFile, bytes: Uint8Array) {
    const response = await this.request(`/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name,version`, {
      method: "PATCH", headers: { "Content-Type": "application/octet-stream", "If-Match": file.etag }, body: buffer(bytes),
    });
    return response.json() as Promise<DriveFile>;
  }
  private saveBase(file: DriveFile, localRevision: string, bookId: string) {
    return this.vault.store.set("drive-base", { fileId: file.id, remoteVersion: file.version, localRevision, bookId } satisfies SyncBase);
  }
  async useDrive(password: string) {
    const pending = this.conflict;
    if (!pending) throw new Error("No Drive conflict is pending.");
    const latest = await this.metadata(pending.file.id);
    if (latest.version !== pending.file.version) throw new Error("The Drive copy changed. Sync again before resolving.");
    await this.vault.replace(pending.bytes, password);
    const state = await this.vault.read();
    await this.saveBase(pending.file, state.revision, state.id);
    this.conflict = undefined;
  }
  async useDevice() {
    const pending = this.conflict;
    if (!pending) throw new Error("No Drive conflict is pending.");
    await this.vault.serial(async () => {
      const latest = await this.metadata(pending.file.id);
      if (latest.version !== pending.file.version) throw new Error("The Drive copy changed. Sync again before resolving.");
      const state = await this.vault.read();
      const uploaded = await this.upload(pending.file, await this.vault.export());
      await this.saveBase(uploaded, state.revision, state.id);
      this.conflict = undefined;
    });
  }
  async forgetLink() {
    this.disconnect();
    await this.vault.store.set("drive-base", undefined);
  }
}
