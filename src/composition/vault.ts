import { InMemoryEventBus } from "@schorts/shared-kernel/event-bus";
import { FinanceService } from "../modules/finance/application/finance-service";
import { emptyState, type Command, type FinanceState } from "../modules/finance/domain/finance";
import { base64, buffer, decrypt, deriveKey, encrypt, parseEnvelope, unbase64 } from "../modules/vault/infrastructure/crypto";
import { DeviceStore } from "../modules/vault/infrastructure/device-store";
import { BiometricUnlock } from "../modules/vault/infrastructure/biometrics";
import { loadSqlite, SqliteFinanceRepository } from "../modules/finance/infrastructure/sqlite-repository";

interface Session { token: string; salt: string; key: CryptoKey; }
export class Vault {
  readonly store = new DeviceStore();
  readonly biometrics = new BiometricUnlock(this.store);
  readonly events = new InMemoryEventBus(undefined, { enableLogging: false, enableMetrics: false });
  private key?: CryptoKey;
  private salt?: string;
  private repository?: SqliteFinanceRepository;
  private service?: FinanceService;
  private queue: Promise<unknown> = Promise.resolve();
  private ready?: Promise<void>;
  private active = true;

  initialize() {
    this.ready ??= this.init();
    return this.ready;
  }
  private async init() {
    if (!globalThis.crypto?.subtle) throw new Error("A secure HTTPS connection is required to protect your vault.");
    if (!navigator.locks) throw new Error("This browser cannot safely lock device storage. Use a current Safari, Chrome, Edge or Firefox.");
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request("simply-track-vault", { ifAvailable: true }, async (lock) => {
        if (!lock) { reject(new Error("SimplyTrack is already open in another tab. Close that tab and reload to avoid conflicting writes.")); return; }
        resolve();
        await new Promise<void>(() => {});
      }).catch(reject);
    });
    const bytes = await this.store.readVault();
    const session = await this.store.get<Session>("session");
    if (bytes && session && session.token === sessionStorage.getItem("simply-track-session") && session.salt === parseEnvelope(bytes).salt) {
      await this.open(bytes, session.key);
    }
  }
  async exists() { return Boolean(await this.store.readVault()); }
  isOpen() { return Boolean(this.service); }
  async read() {
    if (!this.service) throw new Error("Unlock the vault first.");
    return this.service.read();
  }
  private async remember(key: CryptoKey, salt: string) {
    const token = crypto.randomUUID();
    sessionStorage.setItem("simply-track-session", token);
    await this.store.set("session", { key, salt, token } satisfies Session);
  }
  private async open(bytes: Uint8Array, key: CryptoKey) {
    const envelope = parseEnvelope(bytes);
    const plain = await decrypt(envelope, key);
    const sql = await loadSqlite();
    const db = new sql.Database(plain);
    try { SqliteFinanceRepository.validate(db); }
    catch (error) { db.close(); throw error; }
    this.repository?.close();
    this.key = key; this.salt = envelope.salt;
    this.repository = new SqliteFinanceRepository(db, (data) => this.persist(data));
    this.service = new FinanceService(this.repository, this.events);
    this.active = true;
  }
  private async persist(data: Uint8Array) {
    if (!this.key || !this.salt) throw new Error("Vault is locked.");
    await this.store.writeVault(await encrypt(data, this.key, this.salt));
  }
  async create(password: string) {
    await this.initialize();
    if (await this.exists()) throw new Error("A vault already exists. Unlock it or import a replacement in settings.");
    if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
    const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(password, unbase64(salt));
    const sql = await loadSqlite();
    const db = SqliteFinanceRepository.create(sql, emptyState());
    const encrypted = await encrypt(db.export(), key, salt);
    db.close();
    await this.store.writeVault(encrypted);
    await this.open(encrypted, key);
    await this.remember(await this.nonExtractable(key), salt);
    if (navigator.storage?.persist) await navigator.storage.persist();
  }
  private async nonExtractable(key: CryptoKey) {
    return crypto.subtle.importKey("raw", await crypto.subtle.exportKey("raw", key), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async unlock(password: string) {
    await this.initialize();
    const bytes = await this.store.readVault();
    if (!bytes) throw new Error("No vault was found on this device.");
    const envelope = parseEnvelope(bytes);
    const key = await deriveKey(password, unbase64(envelope.salt));
    await this.open(bytes, key);
    await this.remember(await this.nonExtractable(key), envelope.salt);
  }
  async biometricUnlock() {
    const bytes = await this.export();
    const salt = parseEnvelope(bytes).salt;
    const key = await this.biometrics.unlock(salt);
    await this.open(bytes, key);
    await this.remember(key, salt);
  }
  async biometricStatus() {
    const bytes = await this.store.readVault();
    return bytes ? this.biometrics.enrolled(parseEnvelope(bytes).salt) : false;
  }
  async enrollBiometrics(password: string) {
    const bytes = await this.export();
    const envelope = parseEnvelope(bytes);
    const key = await deriveKey(password, unbase64(envelope.salt));
    await decrypt(envelope, key);
    await this.biometrics.enroll(key, envelope.salt);
  }
  execute(command: Command): Promise<FinanceState> {
    return this.serial(async () => {
      await this.initialize();
      if (!this.service || !this.active) throw new Error("Unlock the vault first.");
      return this.service.execute(command);
    });
  }
  serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  async export() {
    await this.initialize();
    const bytes = await this.store.readVault();
    if (!bytes) throw new Error("No vault is stored on this device.");
    return bytes;
  }
  async replace(bytes: Uint8Array, password: string) {
    await this.initialize();
    const envelope = parseEnvelope(bytes);
    const key = await deriveKey(password, unbase64(envelope.salt));
    const plain = await decrypt(envelope, key);
    const sql = await loadSqlite();
    const candidate = new sql.Database(plain);
    try { SqliteFinanceRepository.validate(candidate); } finally { candidate.close(); }
    await this.serial(async () => {
      await this.store.writeVault(bytes);
      await this.biometrics.disable();
      await this.open(bytes, key);
      await this.remember(await this.nonExtractable(key), envelope.salt);
    });
  }
  async logout() {
    this.active = false;
    await this.queue;
    sessionStorage.removeItem("simply-track-session");
    await this.store.set("session", undefined);
    this.repository?.close();
    this.repository = undefined; this.service = undefined; this.key = undefined; this.salt = undefined;
  }
}
let instance: Vault | undefined;
export function getVault() { return instance ??= new Vault(); }
export function downloadVault(bytes: Uint8Array, name = `simply-track-${new Date().toISOString().slice(0, 10)}.vault`) {
  const url = URL.createObjectURL(new Blob([buffer(bytes)], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
