import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveSync } from "../src/modules/vault/infrastructure/google-drive";
import { Vault } from "../src/composition/vault";
import { emptyState } from "../src/modules/finance/domain/finance";
import { base64, deriveKey, encrypt, unbase64 } from "../src/modules/vault/infrastructure/crypto";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function file(id: string, parents: string[] = [], version = "1", createdTime = "2026-10-22T12:00:00.000Z") {
  return {
    id, name: "simply-track.vault", version, createdTime,
    appProperties: Object.fromEntries(parents.map((parent, index) => [`stParent${index}`, parent])),
  };
}
function list(...files: ReturnType<typeof file>[]) { return json({ files }); }
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
  const commit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.spyOn(vault, "prepareReplacement").mockResolvedValue(commit);
  vi.spyOn(vault.store, "get").mockResolvedValue({ fileId: "root", remoteVersion: "1", localRevision: "older", bookId: state.id });
  const store = vi.spyOn(vault.store, "set").mockResolvedValue();
  const drive = new GoogleDriveSync(vault);
  await drive.connect();
  return { drive, vault, state, bytes, store, commit };
}
function fetchDrive(files: ReturnType<typeof file>[], bytes: Uint8Array, laterFiles = files) {
  let listCalls = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("alt=media")) return new Response(new Uint8Array(bytes));
    if (url.includes("/upload/drive/v3/files")) {
      const body = await (init?.body as Blob).text();
      const metadataPart = body.match(/\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
      if (!metadataPart) throw new Error("No snapshot metadata part found.");
      const metadata = JSON.parse(metadataPart);
      const parents = Object.entries(metadata.appProperties as Record<string, string>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, parent]) => parent);
      return json(file("created", parents, "2"));
    }
    listCalls++;
    return list(...(listCalls > 3 ? laterFiles : files));
  });
}

describe("Drive immutable snapshot sync", () => {
  it("adopts a single Drive head without creating another snapshot and stays current", async () => {
    const { drive, vault, bytes, commit, store } = await fixture();
    const request = fetchDrive([file("remote")], bytes);
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("conflict");
    await drive.useDrive("remote", "password");
    expect(commit).toHaveBeenCalledOnce();
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    vi.mocked(vault.store.get).mockResolvedValue(store.mock.calls[0][1]);
    expect(await drive.sync()).toBe("current");
  });

  it("does not replace the device when the resolution upload fails", async () => {
    const { drive, bytes, commit } = await fixture();
    const request = fetchDrive([file("left"), file("right")], bytes);
    vi.stubGlobal("fetch", request);
    await drive.sync();
    request.mockImplementationOnce(async () => list(file("left"), file("right")));
    request.mockImplementationOnce(async () => json({}, 503));
    await expect(drive.useDrive("left", "password")).rejects.toThrow("Sync did not finish");
    expect(commit).not.toHaveBeenCalled();
    expect(drive.conflict).toBeDefined();
  });

  it("rejects a wrong password before uploading or replacing anything", async () => {
    const { drive, vault, bytes, commit } = await fixture();
    const request = fetchDrive([file("left"), file("right")], bytes);
    vi.stubGlobal("fetch", request);
    await drive.sync();
    vi.mocked(vault.prepareReplacement).mockRejectedValue(new Error("Password incorrect"));
    await expect(drive.useDrive("left", "wrong")).rejects.toThrow("incorrect");
    expect(commit).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("uploads a multi-branch choice before committing it locally", async () => {
    const { drive, bytes, commit } = await fixture();
    const request = fetchDrive([file("left"), file("right")], bytes);
    vi.stubGlobal("fetch", request);
    await drive.sync();
    commit.mockImplementation(async () => {
      expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    });
    await drive.useDrive("right", "password");
    expect(commit).toHaveBeenCalledOnce();
    expect(drive.conflict).toBeUndefined();
  });

  it("reports a partial local apply explicitly when baseline persistence fails", async () => {
    const { drive, bytes, commit, store } = await fixture();
    vi.stubGlobal("fetch", fetchDrive([file("remote")], bytes));
    await drive.sync();
    store.mockRejectedValueOnce(new Error("Device full"));
    await expect(drive.useDrive("remote", "password")).rejects.toThrow("Device data may have changed");
    expect(commit).toHaveBeenCalledOnce();
    expect(drive.conflict).toBeDefined();
  });

  it("guards resolution operations and cancels a pending request on disconnect", async () => {
    const { drive } = await fixture();
    let finish!: (response: Response) => void;
    const request = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", request);
    const syncing = drive.sync();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await expect(drive.useDevice()).rejects.toThrow("already running");
    drive.disconnect();
    finish(list(file("root")));
    await expect(syncing).rejects.toThrow();
    expect(drive.connected).toBe(false);
    expect(drive.conflict).toBeUndefined();
  });

  it("reports cleanup failure separately from a successfully synced vault", async () => {
    const { drive, vault, state } = await fixture();
    vi.mocked(vault.store.get).mockResolvedValue({ fileId: "root", remoteVersion: "1", localRevision: state.revision, bookId: state.id });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(list(file("root"))).mockResolvedValueOnce(json({}, 503)));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await drive.sync()).toBe("current");
    expect(drive.cleanupWarning).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
  });
  it("creates the initial encrypted snapshot without a parent", async () => {
    const { drive, vault, state, store } = await fixture();
    vi.spyOn(vault.store, "get").mockResolvedValue(undefined);
    const request = fetchDrive([], new Uint8Array(), []);
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("uploaded");
    const upload = request.mock.calls.find(([url]) => String(url).includes("/upload/drive/v3/files"))?.[1] as RequestInit;
    const body = await (upload.body as Blob).text();
    const metadata = JSON.parse(body.match(/\r\n\r\n([\s\S]*?)\r\n--/)![1]);
    expect(metadata.appProperties).toEqual({});
    expect(store).toHaveBeenCalledWith("drive-base", { fileId: "created", remoteVersion: "2", localRevision: state.revision, bookId: state.id });
  });

  it("creates a child snapshot instead of overwriting the synced file", async () => {
    const { drive, state, store } = await fixture();
    const request = fetchDrive([file("root")], new Uint8Array(), []);
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("uploaded");
    expect(request).toHaveBeenCalledTimes(3);
    const upload = request.mock.calls[1][1] as RequestInit;
    expect(upload.method).toBe("POST");
    expect(new Headers(upload.headers).has("If-Match")).toBe(false);
    expect(new Headers(upload.headers).get("Content-Type")).toMatch(/^multipart\/related; boundary=/);
    const body = await (upload.body as Blob).text();
    const metadata = JSON.parse(body.match(/\r\n\r\n([\s\S]*?)\r\n--/)![1]);
    expect(metadata.appProperties).toEqual({ stParent0: "root" });
    expect(store).toHaveBeenCalledWith("drive-base", { fileId: "created", remoteVersion: "2", localRevision: state.revision, bookId: state.id });
  });

  it("treats sibling snapshots as a conflict and retains all encrypted branches", async () => {
    const { drive, bytes } = await fixture();
    const branches = [file("left", ["root"]), file("right", ["root"])];
    const request = fetchDrive(branches, bytes);
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("conflict");
    expect(drive.conflict?.snapshots.map(({ file: snapshot }) => snapshot.id)).toEqual(["left", "right"]);
    expect(drive.conflict?.snapshots[0].bytes).toEqual(bytes);
  });

  it("resolves sibling branches by creating a merge snapshot with all parents", async () => {
    const { drive, state, bytes, store } = await fixture();
    const branches = [file("left", ["root"]), file("right", ["root"])];
    const request = fetchDrive(branches, bytes);
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("conflict");
    await drive.useDevice();
    const uploadCall = request.mock.calls.find(([url]) => String(url).includes("/upload/drive/v3/files"));
    const upload = uploadCall?.[1] as RequestInit;
    const body = await (upload.body as Blob).text();
    const metadata = JSON.parse(body.match(/\r\n\r\n([\s\S]*?)\r\n--/)![1]);
    expect(metadata.appProperties).toEqual({ stParent0: "left", stParent1: "right" });
    expect(store).toHaveBeenCalledWith("drive-base", { fileId: "created", remoteVersion: "2", localRevision: state.revision, bookId: state.id });
  });

  it("rejects resolving a conflict if another device adds a snapshot in the meantime", async () => {
    const { drive, bytes, store } = await fixture();
    const branches = [file("left", ["root"]), file("right", ["root"])];
    const changed = [...branches, file("new", ["left"])];
    const request = fetchDrive(branches, bytes, changed);
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("conflict");
    await expect(drive.useDevice()).rejects.toThrow("Sync again before resolving");
    expect(store).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("prunes ancestors older than 30 days but always retains every branch head", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    const { drive, state, vault } = await fixture();
    vi.spyOn(vault.store, "get").mockResolvedValue({
      fileId: "current", remoteVersion: "1", localRevision: state.revision, bookId: state.id,
    });
    const snapshots = [
      file("old-root", [], "1", "2026-09-01T12:00:00.000Z"),
      file("recent-parent", ["old-root"], "1", "2026-10-10T12:00:00.000Z"),
      file("current", ["recent-parent"], "1", "2026-10-22T11:00:00.000Z"),
    ];
    const deleted: string[] = [];
    let listings = 0;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        deleted.push(decodeURIComponent(url.split("/").at(-1)!));
        return new Response(null, { status: 404 });
      }
      listings++;
      return list(...snapshots, ...(listings > 1 ? [file("old-branch-head", [], "1", "2026-09-01T12:00:00.000Z")] : []));
    });
    vi.stubGlobal("fetch", request);
    expect(await drive.sync()).toBe("current");
    expect(deleted).toEqual(["old-root"]);
  });
});
