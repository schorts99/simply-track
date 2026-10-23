import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "@schorts/shared-kernel/event-bus";
import { FinanceService } from "../src/modules/finance/application/finance-service";
import { emptyState } from "../src/modules/finance/domain/finance";
import { base64, buffer, decrypt, deriveKey, encrypt, parseEnvelope, unbase64 } from "../src/modules/vault/infrastructure/crypto";
import { loadSqlite, SqliteFinanceRepository } from "../src/modules/finance/infrastructure/sqlite-repository";
import { Vault } from "../src/composition/vault";
import { GoogleDriveSync } from "../src/modules/vault/infrastructure/google-drive";

describe("encrypted SQLite persistence", () => {
  it("converges two devices after replacing Drive, without prompting unchanged devices again", async () => {
    const password = "a safe two device sync password";
    const sql = await loadSqlite();
    const db = SqliteFinanceRepository.create(sql, emptyState());
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(password, unbase64(salt));
    const original = await encrypt(db.export(), key, salt);
    db.close();
    const devices = [new Vault(), new Vault()];
    const snapshots: { id: string; name: string; version: string; createdTime: string; bytes: Uint8Array }[] = [];
    vi.stubGlobal("sessionStorage", { setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client");
    vi.stubGlobal("window", { google: { accounts: { oauth2: {
      initTokenClient: ({ callback }: { callback: (response: unknown) => void }) => ({
        requestAccessToken: () => callback({ access_token: "test-token", expires_in: 3600 }),
      }),
    } } } });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
        const text = new TextDecoder().decode(bytes);
        const header = "Content-Type: application/octet-stream\r\n\r\n";
        const start = text.indexOf(header) + header.length;
        const end = text.lastIndexOf("\r\n--");
        // The encrypted envelope is ASCII JSON, so string and byte offsets match.
        const snapshot = {
          id: `snapshot-${snapshots.length + 1}`, name: "simply-track.vault", version: "1",
          createdTime: new Date(Date.UTC(2026, 9, 23, 12, 0, snapshots.length)).toISOString(),
          bytes: bytes.slice(start, end),
        };
        snapshots.push(snapshot);
        return Response.json(snapshot);
      }
      if (url.includes("alt=media")) {
        const id = new URL(url).pathname.split("/").at(-1);
        const snapshot = snapshots.find((file) => file.id === id);
        if (!snapshot) throw new Error("Test snapshot not found.");
        return new Response(buffer(snapshot.bytes));
      }
      return Response.json({ files: snapshots.map((snapshot) => ({ ...snapshot, version: "2" })) });
    });
    try {
      for (const vault of devices) {
        let stored: Uint8Array = original;
        const metadata = new Map<string, unknown>();
        vi.spyOn(vault, "initialize").mockResolvedValue();
        vi.spyOn(vault.store, "readVault").mockImplementation(async () => stored);
        vi.spyOn(vault.store, "writeVault").mockImplementation(async (bytes) => { stored = bytes; });
        vi.spyOn(vault.store, "get").mockImplementation(async <T>(name: string) => metadata.get(name) as T | undefined);
        vi.spyOn(vault.store, "set").mockImplementation(async (name, value) => { metadata.set(name, value); });
        await vault.replace(original, password);
      }
      const [first, second] = devices;
      const a = new GoogleDriveSync(first);
      const b = new GoogleDriveSync(second);
      await a.connect(); await b.connect();
      expect(await a.sync()).toBe("uploaded");
      expect(await b.sync()).toBe("current");

      await first.execute({ type: "goal.save", data: { id: crypto.randomUUID(), name: "First device", saved: 0, target: 10000, date: "2027-01-01" } });
      expect(await a.sync()).toBe("uploaded");
      await second.execute({ type: "goal.save", data: { id: crypto.randomUUID(), name: "Second device", saved: 0, target: 20000, date: "2027-01-01" } });
      expect(await b.sync()).toBe("conflict");
      await b.useDevice();

      expect(await a.sync()).toBe("restored");
      expect(await first.read()).toEqual(await second.read());
      expect(await a.sync()).toBe("current");
      expect(await b.sync()).toBe("current");
      await first.execute({ type: "goal.save", data: { id: crypto.randomUUID(), name: "Next edit", saved: 0, target: 30000, date: "2027-01-01" } });
      expect(await a.sync()).toBe("uploaded");
      expect(await b.sync()).toBe("restored");
      expect(await first.read()).toEqual(await second.read());
      expect(a.conflict).toBeUndefined();
      expect(b.conflict).toBeUndefined();
    } finally {
      for (const vault of devices) await vault.logout();
      vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  it("restores same-key sync data only if the device has not changed, keeping its unlock session", async () => {
    const sql = await loadSqlite();
    const original = emptyState();
    const newer = { ...original, revision: crypto.randomUUID(), settings: { ...original.settings, workspaceName: "Updated on another device" } };
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const password = "a safe automatic restore password";
    const key = await deriveKey(password, unbase64(salt));
    const seal = async (state: typeof original) => {
      const db = SqliteFinanceRepository.create(sql, state);
      try { return await encrypt(db.export(), key, salt); } finally { db.close(); }
    };
    const before = await seal(original);
    const after = await seal(newer);
    const otherBook = await seal({ ...newer, id: crypto.randomUUID() });
    const vault = new Vault();
    const initialize = vi.spyOn(vault, "initialize").mockResolvedValue();
    const write = vi.spyOn(vault.store, "writeVault").mockResolvedValue();
    const set = vi.spyOn(vault.store, "set").mockResolvedValue();
    const disable = vi.spyOn(vault.biometrics, "disable").mockResolvedValue();
    vi.stubGlobal("sessionStorage", { setItem: vi.fn(), removeItem: vi.fn() });
    try {
      await vault.replace(before, password);
      expect(await vault.inspectSyncCopy(after)).toEqual({ id: original.id, revision: newer.revision });
      expect(await vault.restoreSyncCopy(after, "a revision that is no longer current")).toBeUndefined();
      expect(await vault.restoreSyncCopy(otherBook, original.revision)).toBeUndefined();
      expect(write).toHaveBeenCalledTimes(1);
      expect(await vault.restoreSyncCopy(after, original.revision)).toEqual({ id: original.id, revision: newer.revision });
      expect(await vault.read()).toMatchObject(newer);
      expect(write).toHaveBeenCalledTimes(2);
      expect(disable).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
    } finally {
      await vault.logout();
      initialize.mockRestore(); write.mockRestore(); set.mockRestore(); disable.mockRestore(); vi.unstubAllGlobals();
    }
  });
  it("validates a replacement and password without changing the device vault", async () => {
    const sql = await loadSqlite();
    const db = SqliteFinanceRepository.create(sql, emptyState());
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey("a safe replacement password", unbase64(salt));
    const bytes = await encrypt(db.export(), key, salt);
    db.close();
    const vault = new Vault();
    const initialize = vi.spyOn(vault, "initialize").mockResolvedValue();
    const write = vi.spyOn(vault.store, "writeVault").mockResolvedValue();
    try {
      const commit = await vault.prepareReplacement(bytes, "a safe replacement password");
      expect(typeof commit).toBe("function");
      expect(write).not.toHaveBeenCalled();
      expect(vault.isOpen()).toBe(false);
      await expect(vault.prepareReplacement(bytes, "wrong password")).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
    } finally { initialize.mockRestore(); write.mockRestore(); }
  });
  it("upgrades legacy settings in existing SQLite books without changing records or revision", async () => {
    const sql = await loadSqlite();
    const state = emptyState();
    state.transactions.push({ id: crypto.randomUUID(), title: "Original record", amount: 500, category: "Groceries", paymentMethod: "Card", date: "2026-10-20", type: "expense", notes: "", recurring: false });
    const db = SqliteFinanceRepository.create(sql, state);
    db.run("UPDATE book SET data = ? WHERE id = 1", [JSON.stringify({ ...state, settings: { currency: "CRC", incomeBaseline: 12300 } })]);
    const restored = SqliteFinanceRepository.validate(db);
    expect(restored).toMatchObject({ id: state.id, revision: state.revision, transactions: state.transactions, settings: { currency: "CRC", incomeBaseline: 12300, forecastMonths: 6, openingBalance: 0 } });
    const repo = new SqliteFinanceRepository(db, async () => {});
    const service = new FinanceService(repo, new InMemoryEventBus(undefined, { enableLogging: false }));
    const settings = { ...restored.settings, profileName: "My name", workspaceName: "Private space", forecastMonths: 12 };
    await service.execute({ type: "settings.save", data: settings });
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey("a safe migration password", unbase64(salt));
    const sealed = await encrypt(repo.export(), key, salt);
    const reopened = new sql.Database(await decrypt(parseEnvelope(sealed), key));
    expect(SqliteFinanceRepository.validate(reopened).settings).toEqual(settings);
    expect(SqliteFinanceRepository.validate(reopened).transactions).toEqual(state.transactions);
    repo.close(); reopened.close();
  });
  it("round-trips an actual SQLite database; rejects wrong passwords and tampering", async () => {
    const sql = await loadSqlite();
    const db = SqliteFinanceRepository.create(sql, emptyState());
    const plain = db.export();
    expect(new TextDecoder().decode(plain.slice(0, 15))).toBe("SQLite format 3");
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey("a very long test password", unbase64(salt));
    const sealed = await encrypt(plain, key, salt);
    const envelope = parseEnvelope(sealed);
    expect(new TextDecoder().decode(sealed)).not.toContain("SQLite format");
    const opened = new sql.Database(await decrypt(envelope, key));
    expect(SqliteFinanceRepository.validate(opened).id).toBe(SqliteFinanceRepository.validate(db).id);
    const wrongKey = await deriveKey("the wrong test password", unbase64(salt));
    await expect(decrypt(envelope, wrongKey)).rejects.toThrow("incorrect");
    const ciphertext = unbase64(envelope.ciphertext);
    ciphertext[50] ^= 1;
    await expect(decrypt({ ...envelope, ciphertext: base64(ciphertext) }, key)).rejects.toThrow("damaged");
    await expect(decrypt({ ...envelope, salt: base64(crypto.getRandomValues(new Uint8Array(16))) }, key)).rejects.toThrow();
    expect(() => parseEnvelope(new TextEncoder().encode('{"format":"not a vault"}'))).toThrow();
    db.close(); opened.close();
  });
  it("commits before publishing and restores the prior snapshot when device persistence fails", async () => {
    const sql = await loadSqlite();
    const initial = emptyState();
    const persist = vi.fn<(bytes: Uint8Array) => Promise<void>>().mockResolvedValue(undefined);
    const repository = new SqliteFinanceRepository(SqliteFinanceRepository.create(sql, initial), persist);
    const bus = new InMemoryEventBus(undefined, { enableLogging: false });
    const handler = vi.fn(async () => { expect(persist).toHaveBeenCalledTimes(1); });
    bus.subscribe("finance.changed", { subscribedTo: () => ["finance.changed"], handle: handler });
    const service = new FinanceService(repository, bus);
    await service.execute({ type: "budget.save", data: { id: crypto.randomUUID(), category: "Groceries", limit: 30000 } });
    expect(handler).toHaveBeenCalledTimes(1);
    const before = await service.read();
    persist.mockRejectedValueOnce(new Error("Device full"));
    await expect(service.execute({ type: "goal.save", data: { id: crypto.randomUUID(), name: "Trip", saved: 0, target: 10000, date: "2027-01-01" } })).rejects.toThrow("Device full");
    expect(await service.read()).toEqual(before);
    expect(handler).toHaveBeenCalledTimes(1);
    const exported = new sql.Database(repository.export());
    expect(exported.exec("SELECT COUNT(*) FROM domain_events")[0].values[0][0]).toBe(1);
    expect(exported.exec("SELECT COUNT(*) FROM budgets")[0].values[0][0]).toBe(1);
    exported.close(); repository.close();
  });
});
