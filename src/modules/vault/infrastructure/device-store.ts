export class DeviceStore {
  private db?: IDBDatabase;
  private async database() {
    if (this.db) return this.db;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("simply-track-device", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("device");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const request = db.transaction("device").objectStore("device").get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }
  async set(key: string, value: unknown): Promise<void> {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("device", "readwrite");
      const store = tx.objectStore("device");
      if (value === undefined) store.delete(key); else store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Device storage failed."));
    });
  }
  // The storage backend is pinned, so a later capability change cannot hide a vault.
  async backend(): Promise<"opfs" | "indexeddb"> {
    const existing = await this.get<"opfs" | "indexeddb">("backend");
    if (existing) return existing;
    let backend: "opfs" | "indexeddb" = "indexeddb";
    if (navigator.storage?.getDirectory) {
      try { await navigator.storage.getDirectory(); backend = "opfs"; }
      catch (error) {
        if (!(error instanceof DOMException) || !["SecurityError", "NotAllowedError", "NotSupportedError"].includes(error.name)) throw error;
      }
    }
    await this.set("backend", backend);
    return backend;
  }
  async readVault(): Promise<Uint8Array | undefined> {
    if (await this.backend() === "indexeddb") return this.get<Uint8Array>("vault");
    const root = await navigator.storage.getDirectory();
    try { return new Uint8Array(await (await (await root.getFileHandle("simply-track.vault")).getFile()).arrayBuffer()); }
    catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
      throw error;
    }
  }
  async writeVault(bytes: Uint8Array): Promise<void> {
    if (await this.backend() === "indexeddb") return this.set("vault", bytes);
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("simply-track.vault", { create: true });
    const stream = await handle.createWritable();
    try { await stream.write(new Uint8Array(bytes)); await stream.close(); }
    catch (error) { await stream.abort(); throw error; }
  }
}
