import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveSync } from "../src/modules/vault/infrastructure/google-drive";
import { Vault } from "../src/composition/vault";
import { emptyState } from "../src/modules/finance/domain/finance";
import { base64, deriveKey, encrypt, unbase64 } from "../src/modules/vault/infrastructure/crypto";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function json(data: unknown, etag?: string, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: etag ? { etag } : {} });
}
async function fixture() {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client");
  vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (r: unknown) => void }) => ({ requestAccessToken: () => callback({ access_token: "test-token", expires_in: 3600 }) }) } } } });
  const vault = new Vault();
  const state = emptyState();
  const salt = base64(new Uint8Array(16));
  const bytes = await encrypt(new Uint8Array([1, 2, 3]), await deriveKey("test password long", unbase64(salt)), salt);
  vi.spyOn(vault, "serial").mockImplementation((operation) => operation());
  vi.spyOn(vault, "isOpen").mockReturnValue(true);
  vi.spyOn(vault, "read").mockResolvedValue(state);
  vi.spyOn(vault, "export").mockResolvedValue(bytes);
  vi.spyOn(vault.store, "get").mockResolvedValue({ fileId: "file", remoteVersion: "1", localRevision: "older", bookId: state.id });
  const store = vi.spyOn(vault.store, "set").mockResolvedValue();
  const drive = new GoogleDriveSync(vault);
  await drive.connect();
  return { drive, vault, state, bytes, store };
}
describe("Drive conflict safety", () => {
  it("uses a conditional upload and records the upload response's version, not a later writer's version", async () => {
    const { drive, state, store } = await fixture();
    const request = vi.fn().mockResolvedValueOnce(json({ files: [{ id: "file" }] }))
      .mockResolvedValueOnce(json({ id: "file", name: "simply-track.vault", version: "1" }, '"etag-1"'))
      .mockResolvedValueOnce(json({ id: "file", version: "2" }));
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("uploaded");
    expect(new Headers(request.mock.calls[2][1].headers).get("If-Match")).toBe('"etag-1"');
    expect(store).toHaveBeenCalledWith("drive-base", { fileId: "file", remoteVersion: "2", localRevision: state.revision, bookId: state.id });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("downloads and surfaces divergent copies without uploading", async () => {
    const { drive, bytes } = await fixture();
    const request = vi.fn().mockResolvedValueOnce(json({ files: [{ id: "file" }] }))
      .mockResolvedValueOnce(json({ id: "file", version: "3" }, '"etag-3"'))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)))
      .mockResolvedValueOnce(json({ id: "file", version: "3" }, '"etag-3"'));
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("conflict");
    expect(drive.conflict?.bytes).toEqual(bytes);
    expect(request.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("refuses uploads when conditional revision protection is unavailable or stale", async () => {
    const { drive, store } = await fixture();
    const request = vi.fn().mockResolvedValueOnce(json({ files: [{ id: "file" }] }))
      .mockResolvedValueOnce(json({ id: "file", version: "1" }));
    vi.stubGlobal("fetch", request);
    await expect(drive.sync()).rejects.toThrow("ETag");
    expect(store).not.toHaveBeenCalled();
    request.mockResolvedValueOnce(json({ files: [{ id: "file" }] }))
      .mockResolvedValueOnce(json({ id: "file", version: "1" }, '"etag-1"'))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    await expect(drive.sync()).rejects.toThrow("nothing was overwritten");
    expect(store).not.toHaveBeenCalled();
  });
});
