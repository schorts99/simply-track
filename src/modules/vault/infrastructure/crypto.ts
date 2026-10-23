const encoder = new TextEncoder();
const ITERATIONS = 600_000;
const MAX_VAULT_BYTES = 64 * 1024 * 1024;
export interface Envelope {
  format: "simply-track";
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}
export function buffer(bytes: Uint8Array): ArrayBuffer { return new Uint8Array(bytes).buffer; }
export function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: buffer(salt), iterations: ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
function aad(salt: string) { return encoder.encode(`simply-track:1:${salt}`); }
export function parseEnvelope(bytes: Uint8Array): Envelope {
  if (bytes.length > MAX_VAULT_BYTES) throw new Error("Vault exceeds the 64 MB size limit.");
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== "simply-track" ||
    !("version" in value) || value.version !== 1 || !("salt" in value) || typeof value.salt !== "string" ||
    !("iv" in value) || typeof value.iv !== "string" || !("ciphertext" in value) || typeof value.ciphertext !== "string") throw new Error("This is not a supported SimplyTrack vault.");
  if (unbase64(value.salt).length !== 16 || unbase64(value.iv).length !== 12 || unbase64(value.ciphertext).length < 16) throw new Error("The vault header is damaged.");
  return value as Envelope;
}
export async function encrypt(bytes: Uint8Array, key: CryptoKey, salt: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(salt) }, key, buffer(bytes));
  const sealed = encoder.encode(JSON.stringify({ format: "simply-track", version: 1, salt, iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) } satisfies Envelope));
  if (sealed.length > MAX_VAULT_BYTES) throw new Error("The vault would exceed the 64 MB size limit. This change was not saved.");
  return sealed;
}
export async function decrypt(envelope: Envelope, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(envelope.iv), additionalData: aad(envelope.salt) }, key, unbase64(envelope.ciphertext)));
  } catch {
    throw new Error("Unable to unlock: the password is incorrect or the vault has been damaged.");
  }
}
