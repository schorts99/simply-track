import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Run against a build with NEXT_PUBLIC_GOOGLE_CLIENT_ID set; all Google traffic is mocked.
test("Drive import stays connected, manual sync does not duplicate, and deletions sync", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.google = { accounts: { oauth2: { initTokenClient: ({ callback, error_callback }) => ({
      requestAccessToken: ({ prompt }) => {
        if (prompt === "none" && sessionStorage.getItem("test-block-google")) {
          error_callback({ type: "popup_failed_to_open" });
        } else callback({ access_token: "test-token", expires_in: 3600 });
      }
    }) } } };`,
  }));
  await page.goto("/");
  await page.getByLabel("Vault password", { exact: true }).fill("a secure drive test password");
  await page.getByLabel("Confirm password", { exact: true }).fill("a secure drive test password");
  await page.getByRole("button", { name: "Create my private vault" }).click();
  const settings = page.getByRole("button", { name: testInfo.project.name === "mobile" ? "Settings" : "Settings & storage", exact: true });
  await settings.click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const downloaded = await downloadEvent;
  const path = await downloaded.path();
  if (!path) throw new Error("No encrypted backup was downloaded.");
  const bytes = await readFile(path);
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Remote update record");
  await page.getByLabel("Amount", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Save changes" }).click();
  await settings.click();
  const newerDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const newerDownload = await newerDownloadEvent;
  const newerPath = await newerDownload.path();
  if (!newerPath) throw new Error("No newer backup was downloaded.");
  const newerBytes = await readFile(newerPath);

  const snapshots = [{ id: "remote", name: "simply-track.vault", version: "1", createdTime: new Date().toISOString(), appProperties: {} as Record<string, string> }];
  const contents = new Map([["remote", bytes], ["remote-new", newerBytes], ["another-device", bytes]]);
  let uploads = 0;
  let lists = 0;
  let slow = false;
  await page.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request();
    if (request.url().includes("alt=media")) {
      const id = new URL(request.url()).pathname.split("/").at(-1)!;
      const body = contents.get(id);
      if (!body) throw new Error(`Missing test snapshot: ${id}`);
      await route.fulfill({ contentType: "application/octet-stream", body });
    } else if (request.method() === "POST") {
      expect(request.headers()["content-type"]).toContain("multipart/related");
      const metadata = JSON.parse(request.postDataBuffer()!.toString().match(/\r\n\r\n([\s\S]*?)\r\n--/)![1]);
      uploads++;
      const file = { id: `snapshot-${uploads}`, name: metadata.name, version: "1", createdTime: new Date().toISOString(), appProperties: metadata.appProperties };
      const payload = request.postDataBuffer()!;
      const header = Buffer.from("Content-Type: application/octet-stream\r\n\r\n");
      contents.set(file.id, Buffer.from(payload.subarray(payload.indexOf(header) + header.length, payload.lastIndexOf("\r\n--"))));
      snapshots.push(file);
      await route.fulfill({ json: file });
    } else {
      lists++;
      if (slow) await new Promise((resolve) => setTimeout(resolve, 2400));
      // Drive may advance metadata versions without changing the uploaded vault.
      await route.fulfill({ json: { files: snapshots.map((file) => ({ ...file, version: file.id.startsWith("snapshot-") ? "2" : file.version })) } });
    }
  });
  await page.getByRole("button", { name: "Connect Google Drive", exact: true }).click();
  const conflict = page.getByRole("dialog", { name: "Choose the vault to keep" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Close dialog" }).click();
  await page.waitForTimeout(2200);
  await expect(conflict).not.toBeVisible();
  await settings.click();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(conflict).toBeVisible();
  await conflict.getByLabel("Drive vault password").fill("a secure drive test password");
  await conflict.getByRole("button", { name: "Restore from Drive" }).click();
  await expect(conflict).not.toBeVisible();
  await page.waitForTimeout(2500);
  await expect(conflict).not.toBeVisible();
  expect(uploads).toBe(0);

  // A fresh sync instance reuses the persisted baseline after a full page reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "Up to date with Google Drive", exact: true })).toBeVisible();
  await expect(conflict).not.toBeVisible();

  // Another device publishes newer data. A clean device restores it without prompting.
  snapshots.push({ id: "remote-new", name: "simply-track.vault", version: "1", createdTime: new Date(Date.now() + 1000).toISOString(), appProperties: { stParent0: "remote" } });
  await settings.click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
  await expect(conflict).not.toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByText("Remote update record", { exact: true })).toBeVisible();
  expect(uploads).toBe(0);

  await settings.click();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  slow = true;
  const before = lists;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled({ timeout: 15000 });
  expect(lists - before).toBe(2);
  slow = false;
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Drive regression record");
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => uploads).toBe(1);
  await page.getByRole("button", { name: "Delete Drive regression record", exact: true }).click();
  await page.getByRole("button", { name: "Remove record", exact: true }).click();
  await expect.poll(() => uploads).toBe(2);

  // Disconnect during a slow background request; no stale conflict/status may return.
  await settings.click();
  slow = true;
  const requestsBeforeDisconnect = lists;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(() => lists).toBeGreaterThan(requestsBeforeDisconnect);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeVisible();
  await page.waitForTimeout(2600);
  await expect(conflict).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeVisible();

  // Both copies change: offer exactly one restore/replace decision, never a branch picker.
  slow = false;
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Unsynced device edit");
  await page.getByLabel("Amount", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Save changes" }).click();
  snapshots.push({ id: "another-device", name: "simply-track.vault", version: "1", createdTime: new Date().toISOString(), appProperties: {} });
  await settings.click();
  await page.getByRole("button", { name: "Connect Google Drive", exact: true }).click();
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole("combobox")).toHaveCount(0);
  await expect(conflict.getByRole("button", { name: "Restore from Drive", exact: true })).toBeVisible();
  await conflict.getByRole("checkbox", { name: "Use this device's records as the shared current vault on Drive." }).check();
  await conflict.getByRole("button", { name: "Replace Drive with this device", exact: true }).click();
  await expect(conflict).not.toBeVisible();
  expect(uploads).toBe(3);
  await page.reload();
  await expect(page.getByRole("button", { name: "Up to date with Google Drive", exact: true })).toBeVisible();
  await expect(conflict).not.toBeVisible();
  await expect(page.getByText("Unsynced device edit", { exact: true })).toBeVisible();

  // Logging out drops the token, but unlocking again resumes the previous opt-in.
  await settings.click();
  await page.getByRole("button", { name: "Lock vault & log out", exact: true }).click();
  await page.getByLabel("Vault password", { exact: true }).fill("a secure drive test password");
  await page.getByRole("button", { name: "Unlock my vault", exact: true }).click();
  await expect(page.getByRole("button", { name: "Up to date with Google Drive", exact: true })).toBeVisible();

  // If interaction is required, reconnect is available on the dashboard without settings.
  await page.evaluate(() => sessionStorage.setItem("test-block-google", "yes"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Reconnect Google Drive", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reconnect Google Drive", exact: true }).click();
  await expect(page.getByRole("button", { name: "Up to date with Google Drive", exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem("test-block-google"));

  // Explicit disconnect disables automatic reconnect on the next visit.
  await settings.click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeEnabled();
  const requestsBeforeReload = lists;
  await page.reload();
  await expect(page.getByRole("heading", { name: "A little clarity. A lot of possibility." })).toBeVisible();
  await page.waitForTimeout(2200);
  expect(lists).toBe(requestsBeforeReload);
  await settings.click();
  await expect(page.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeVisible();
});
