import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveSync } from "../src/modules/vault/infrastructure/google-drive";
import type { SyncVault } from "../src/modules/vault/application/sync-vault";
import { base64, deriveKey, encrypt, unbase64 } from "../src/modules/vault/infrastructure/crypto";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function file(id: string, parents: string[] = [], createdTime = "2026-10-23T12:00:00.000Z") {
  return {
    id, name: "simply-track.vault", version: "1", createdTime,
    appProperties: Object.fromEntries(parents.map((parent, index) => [`stParent${index}`, parent])),
  };
}
async function fixture() {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client");
  vi.stubGlobal("window", { google: { accounts: { oauth2: { initTokenClient: ({ callback }: { callback: (r: unknown) => void }) => ({ requestAccessToken: () => callback({ access_token: "test-token", expires_in: 3600 }) }) } } } });
  const salt = base64(new Uint8Array(16));
  const bytes = await encrypt(new Uint8Array([1, 2, 3]), await deriveKey("test password long", unbase64(salt)), salt);
  let local = { id: "book", revision: "local-edit" };
  const remote = { id: "book", revision: "remote-edit" };
  const storage = new Map<string, unknown>([["drive-base", { fileId: "root", remoteVersion: "1", localRevision: "old", bookId: "book" }]]);
  const commit = vi.fn(async () => { local = { ...remote }; });
  const vault = {
    isOpen: vi.fn(() => true),
    read: vi.fn(async () => ({ ...local })),
    export: vi.fn(async () => bytes),
    replace: vi.fn(async () => { await commit(); }),
    prepareReplacement: vi.fn(async () => commit),
    inspectSyncCopy: vi.fn<SyncVault["inspectSyncCopy"]>(async () => ({ ...remote })),
    restoreSyncCopy: vi.fn(async (_bytes: Uint8Array, expectedRevision: string) => {
      if (local.revision !== expectedRevision) return undefined;
      local = { ...remote };
      return { ...local };
    }),
    serial: async <T>(operation: () => Promise<T>) => operation(),
    store: {
      get: async <T>(key: string) => storage.get(key) as T | undefined,
      set: vi.fn(async (key: string, value: unknown) => { storage.set(key, value); }),
    },
  } satisfies SyncVault;
  let snapshots = [file("root")];
  let uploads = 0;
  let failUpload = false;
  let failCleanup = false;
  let listings = 0;
  const deleted: string[] = [];
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("alt=media")) return new Response(new Uint8Array(bytes));
    if (init?.method === "DELETE") {
      deleted.push(url.split("/").at(-1)!);
      return new Response(null, { status: 404 });
    }
    if (url.includes("/upload/drive/v3/files")) {
      if (failUpload) return json({}, 503);
      expect(new Headers(init?.headers).get("Content-Type")).toMatch(/^multipart\/related; boundary=/);
      const body = await (init?.body as Blob).text();
      const metadata = JSON.parse(body.match(/\r\n\r\n([\s\S]*?)\r\n--/)![1]);
      const created = { ...file(`created-${++uploads}`, [], "2026-10-24T12:00:00.000Z"), appProperties: metadata.appProperties };
      snapshots.push(created);
      return json(created);
    }
    if (failCleanup && ++listings > 1) return json({}, 503);
    return json({ files: snapshots });
  });
  vi.stubGlobal("fetch", request);
  const drive = new GoogleDriveSync(vault);
  await drive.connect();
  return {
    drive, vault, bytes, remote, storage, commit, request, deleted,
    setLocal: (state: typeof local) => { local = state; },
    setFiles: (files: typeof snapshots) => { snapshots = files; },
    failUpload: () => { failUpload = true; },
    failCleanup: () => { failCleanup = true; },
    uploads: () => uploads,
  };
}

describe("one shared Drive vault", () => {
  it("remembers enabled sync for this vault across sessions, but honors explicit disconnect", async () => {
    const f = await fixture();
    f.storage.clear();
    expect(await f.drive.shouldResume("book")).toBe(false);
    await f.drive.rememberSync(true);
    f.drive.disconnect();
    const next = new GoogleDriveSync(f.vault);
    expect(await next.shouldResume("book")).toBe(true);
    expect(await next.shouldResume("another-book")).toBe(false);
    expect(f.storage.get("drive-preference")).toEqual({ bookId: "book", enabled: true });
    await next.rememberSync(false);
    expect(await next.shouldResume("book")).toBe(false);
    await next.forgetLink();
    expect(f.storage.get("drive-preference")).toBeUndefined();
    expect(f.storage.get("drive-base")).toBeUndefined();
  });

  it("resumes existing installations from their baseline without overriding a disabled preference", async () => {
    const f = await fixture();
    expect(await f.drive.shouldResume("book")).toBe(true);
    await f.drive.rememberSync(false);
    expect(await f.drive.shouldResume("book")).toBe(false);
  });

  it("uses no-prompt authorization for automatic reconnect and ignores callbacks after cancellation", async () => {
    const f = await fixture();
    let callback!: (response: { access_token: string }) => void;
    const requestAccessToken = vi.fn();
    window.google!.accounts.oauth2.initTokenClient = vi.fn((config) => {
      callback = config.callback;
      return { requestAccessToken };
    });
    f.drive.disconnect();
    const reconnect = f.drive.connect(true);
    await vi.waitFor(() => expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "none" }));
    f.drive.disconnect();
    await expect(reconnect).rejects.toThrow();
    callback({ access_token: "late-token" });
    expect(f.drive.connected).toBe(false);
  });

  it("surfaces blocked popups and allows a later manual reconnect", async () => {
    const f = await fixture();
    f.drive.disconnect();
    window.google!.accounts.oauth2.initTokenClient = vi.fn((config) => ({
      requestAccessToken: (options: { prompt: string }) => {
        if (options.prompt === "none") config.error_callback({ type: "popup_failed_to_open" });
        else config.callback({ access_token: "manual-token", expires_in: 3600 });
      },
    }));
    await expect(f.drive.connect(true)).rejects.toThrow("popup_failed_to_open");
    expect(f.drive.running).toBe(false);
    await f.drive.connect();
    expect(f.drive.connected).toBe(true);
  });

  it("creates the initial encrypted copy and remembers its baseline", async () => {
    const f = await fixture();
    f.storage.clear(); f.setFiles([]);
    expect(await f.drive.sync()).toBe("uploaded");
    expect(f.storage.get("drive-base")).toMatchObject({ fileId: "created-1", localRevision: "local-edit" });
  });

  it("uploads local edits to the shared current copy without overwriting backups", async () => {
    const f = await fixture();
    expect(await f.drive.sync()).toBe("uploaded");
    expect(await f.drive.sync()).toBe("current");
    expect(f.uploads()).toBe(1);
    expect(f.request.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("restores Drive once and recognizes the same vault after reconnecting with a new sync instance", async () => {
    const f = await fixture();
    f.setFiles([file("remote")]);
    expect(await f.drive.sync()).toBe("conflict");
    await f.drive.useDrive("password");
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.uploads()).toBe(0);
    f.drive.disconnect();
    const reopened = new GoogleDriveSync(f.vault);
    await reopened.connect();
    expect(await reopened.sync()).toBe("current");
    expect(reopened.conflict).toBeUndefined();
  });

  it("recognizes identical decrypted vault identity and revision even without a baseline", async () => {
    const f = await fixture();
    f.storage.clear(); f.setLocal({ ...f.remote }); f.setFiles([file("remote")]);
    expect(await f.drive.sync()).toBe("current");
    expect(f.storage.get("drive-base")).toMatchObject({ fileId: "remote", localRevision: "remote-edit" });
  });

  it("uploads edits after opening Drive when only Google's file version has changed", async () => {
    const f = await fixture();
    f.vault.isOpen.mockReturnValueOnce(false);
    f.setFiles([file("remote")]);
    expect(await f.drive.sync()).toBe("conflict");
    await f.drive.useDrive("password");
    f.setLocal({ id: "book", revision: "first-transaction" });
    f.setFiles([{ ...file("remote"), version: "2" }]);
    expect(await f.drive.sync()).toBe("uploaded");
    expect(f.drive.conflict).toBeUndefined();
    expect(f.storage.get("drive-base")).toMatchObject({ fileId: "created-1", localRevision: "first-transaction" });

    f.remote.revision = "first-transaction";
    f.setLocal({ id: "book", revision: "second-transaction" });
    f.setFiles([{ ...file("created-1"), version: "2" }]);
    expect(await f.drive.sync()).toBe("uploaded");
    expect(f.drive.conflict).toBeUndefined();
    expect(f.uploads()).toBe(2);
  });

  it("uploads local edits when a new snapshot contains the unchanged synced revision", async () => {
    const f = await fixture();
    f.remote.revision = "old";
    f.setFiles([file("duplicate")]);
    expect(await f.drive.sync()).toBe("uploaded");
    expect(f.drive.conflict).toBeUndefined();
  });

  it("automatically restores newer remote data when there are no local edits", async () => {
    const f = await fixture();
    f.setLocal({ id: "book", revision: "old" });
    f.setFiles([file("new", ["root"])]);
    expect(await f.drive.sync()).toBe("restored");
    expect(f.vault.restoreSyncCopy).toHaveBeenCalledWith(f.bytes, "old", expect.any(AbortSignal));
    expect(await f.vault.read()).toEqual(f.remote);
    expect(await f.drive.sync()).toBe("current");
    expect(f.uploads()).toBe(0);
  });

  it("asks restore or replace only when local and remote have both changed", async () => {
    const f = await fixture();
    f.setFiles([file("new", ["root"])]);
    expect(await f.drive.sync()).toBe("conflict");
    expect(f.drive.conflict?.file.id).toBe("new");
    expect(f.vault.restoreSyncCopy).not.toHaveBeenCalled();
  });

  it("offers only one deterministic current Drive version, not device branches", async () => {
    const f = await fixture();
    f.setFiles([file("left", ["root"], "2026-10-22T00:00:00.000Z"), file("right", ["root"])]);
    expect(await f.drive.sync()).toBe("conflict");
    expect(f.drive.conflict?.file.id).toBe("right");
    await f.drive.useDevice();
    expect(await f.drive.sync()).toBe("current");
    expect(f.uploads()).toBe(1);
  });

  it("automatically follows the newest shared version despite old divergent backups", async () => {
    const f = await fixture();
    f.setLocal({ id: "book", revision: "old" });
    f.setFiles([file("left", ["root"], "2026-10-22T00:00:00.000Z"), file("right", ["root"])]);
    expect(await f.drive.sync()).toBe("restored");
    expect(f.drive.conflict).toBeUndefined();
  });

  it("does not automatically import another vault or one encrypted with a different key", async () => {
    const f = await fixture();
    f.setLocal({ id: "book", revision: "old" }); f.setFiles([file("remote")]);
    f.vault.inspectSyncCopy.mockResolvedValueOnce({ id: "another-book", revision: "remote-edit" });
    expect(await f.drive.sync()).toBe("conflict");
    f.vault.inspectSyncCopy.mockResolvedValueOnce(undefined);
    expect(await f.drive.sync()).toBe("conflict");
    expect(f.vault.restoreSyncCopy).not.toHaveBeenCalled();
  });

  it("does not lose an edit committed while an automatic restore is being prepared", async () => {
    const f = await fixture();
    f.setLocal({ id: "book", revision: "old" }); f.setFiles([file("remote")]);
    f.vault.restoreSyncCopy.mockResolvedValueOnce(undefined);
    expect(await f.drive.sync()).toBe("conflict");
    expect(f.storage.get("drive-base")).toMatchObject({ fileId: "root" });
  });

  it("requires a fresh decision if the shared Drive version changes before resolution", async () => {
    const f = await fixture();
    f.setFiles([file("remote")]); await f.drive.sync();
    f.setFiles([file("newer", [], "2026-10-24T00:00:00.000Z")]);
    await expect(f.drive.useDevice()).rejects.toThrow("Sync again");
    expect(f.uploads()).toBe(0);
  });

  it("rejects a wrong password without changing local records", async () => {
    const f = await fixture();
    f.setFiles([file("remote")]); await f.drive.sync();
    f.vault.prepareReplacement.mockRejectedValueOnce(new Error("Password incorrect"));
    await expect(f.drive.useDrive("wrong")).rejects.toThrow("incorrect");
    expect(f.commit).not.toHaveBeenCalled();
  });

  it("keeps both copies intact when replacing Drive fails", async () => {
    const f = await fixture();
    f.setFiles([file("remote")]); await f.drive.sync();
    f.failUpload();
    await expect(f.drive.useDevice()).rejects.toThrow("Sync did not finish");
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.drive.conflict).toBeDefined();
  });

  it("reports a partial local apply explicitly when baseline persistence fails", async () => {
    const f = await fixture();
    f.setFiles([file("remote")]); await f.drive.sync();
    f.vault.store.set.mockRejectedValueOnce(new Error("Device full"));
    await expect(f.drive.useDrive("password")).rejects.toThrow("Device data may have changed");
    expect(f.commit).toHaveBeenCalledOnce();
  });

  it("guards resolution operations and cancels a pending request on disconnect", async () => {
    const f = await fixture();
    let finish!: (response: Response) => void;
    const request = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", request);
    const syncing = f.drive.sync();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await expect(f.drive.useDevice()).rejects.toThrow("already running");
    f.drive.disconnect(); finish(json({ files: [file("root")] }));
    await expect(syncing).rejects.toThrow();
    expect(f.drive.connected).toBe(false);
    expect(f.drive.conflict).toBeUndefined();
  });

  it("reports cleanup failure separately from successful synchronization", async () => {
    const f = await fixture();
    f.failCleanup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await f.drive.sync()).toBe("uploaded");
    expect(f.drive.cleanupWarning).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
  });

  it("keeps the shared current vault and removes all backups older than 30 days, including old branches", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const f = await fixture();
    f.setLocal({ id: "book", revision: "old" });
    f.setFiles([
      file("root"),
      file("old-branch", [], "2026-09-01T12:00:00.000Z"),
      file("old-parent", [], "2026-09-10T12:00:00.000Z"),
      file("recent", [], "2026-10-10T12:00:00.000Z"),
    ]);
    expect(await f.drive.sync()).toBe("current");
    expect(f.deleted.sort()).toEqual(["old-branch", "old-parent"]);
  });
});
