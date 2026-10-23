export interface SyncVault {
  isOpen(): boolean;
  read(): Promise<{ id: string; revision: string }>;
  export(): Promise<Uint8Array>;
  replace(bytes: Uint8Array, password: string): Promise<void>;
  prepareReplacement(bytes: Uint8Array, password: string): Promise<() => Promise<void>>;
  inspectSyncCopy(bytes: Uint8Array): Promise<{ id: string; revision: string } | undefined>;
  restoreSyncCopy(bytes: Uint8Array, expectedRevision: string, signal?: AbortSignal): Promise<{ id: string; revision: string } | undefined>;
  serial<T>(operation: () => Promise<T>): Promise<T>;
  readonly store: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
}
