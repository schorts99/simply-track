import { base64, buffer, unbase64 } from "./crypto";
import type { DeviceStore } from "./device-store";

interface BiometricRecord { id: string; input: string; iv: string; wrappedKey: string; salt: string; }
type PRFInput = AuthenticationExtensionsClientInputs & { prf: { eval: { first: ArrayBuffer } } };
type PRFOutput = AuthenticationExtensionsClientOutputs & { prf?: { enabled?: boolean; results?: { first: ArrayBuffer } } };

export class BiometricUnlock {
  constructor(private readonly store: DeviceStore) {}
  async available() {
    return typeof PublicKeyCredential !== "undefined" && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }
  async enrolled(salt: string) { return (await this.store.get<BiometricRecord>("biometric"))?.salt === salt; }
  private async prf(id: string, input: string): Promise<CryptoKey> {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: unbase64(id), type: "public-key" }],
        userVerification: "required",
        extensions: { prf: { eval: { first: buffer(unbase64(input)) } } } as PRFInput,
      },
    });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Device unlock was cancelled.");
    const result = (credential.getClientExtensionResults() as PRFOutput).prf?.results?.first;
    if (!result) throw new Error("This authenticator does not support secure PRF unlock. Use your vault password.");
    return crypto.subtle.importKey("raw", result, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async enroll(key: CryptoKey, salt: string) {
    const input = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "SimplyTrack" },
        user: { id: crypto.getRandomValues(new Uint8Array(32)), name: "vault-owner", displayName: "SimplyTrack vault" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: buffer(input) } } } as PRFInput,
      },
    });
    if (!(credential instanceof PublicKeyCredential)) throw new Error("Device unlock setup was cancelled.");
    if (!(credential.getClientExtensionResults() as PRFOutput).prf?.enabled) throw new Error("Secure PRF is not supported by this authenticator. Password unlock remains available.");
    const id = base64(new Uint8Array(credential.rawId));
    const wrappingKey = await this.prf(id, base64(input));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const rawKey = await crypto.subtle.exportKey("raw", key);
    const wrappedKey = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(salt) }, wrappingKey, rawKey);
    await this.store.set("biometric", { id, input: base64(input), iv: base64(iv), wrappedKey: base64(new Uint8Array(wrappedKey)), salt } satisfies BiometricRecord);
  }
  async unlock(salt: string) {
    const record = await this.store.get<BiometricRecord>("biometric");
    if (!record || record.salt !== salt) throw new Error("Device unlock is not configured for this vault.");
    const wrappingKey = await this.prf(record.id, record.input);
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(record.iv), additionalData: new TextEncoder().encode(salt) }, wrappingKey, unbase64(record.wrappedKey));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  disable() { return this.store.set("biometric", undefined); }
}
