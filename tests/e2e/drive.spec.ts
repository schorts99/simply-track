import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Run against a build with NEXT_PUBLIC_GOOGLE_CLIENT_ID set; all Google traffic is mocked.
test("Drive import stays connected, manual sync does not duplicate, and deletions sync", async ({ page }, testInfo) => {
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.google = { accounts: { oauth2: { initTokenClient: ({ callback }) => ({
      requestAccessToken: () => callback({ access_token: "test-token", expires_in: 3600 })
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

  const snapshots = [{ id: "remote", name: "simply-track.vault", version: "1", createdTime: new Date().toISOString(), appProperties: {} as Record<string, string> }];
  let uploads = 0;
  let lists = 0;
  let slow = false;
  await page.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request();
    if (request.url().includes("alt=media")) {
      await route.fulfill({ contentType: "application/octet-stream", body: bytes });
    } else if (request.method() === "POST") {
      expect(request.headers()["content-type"]).toContain("multipart/related");
      const metadata = JSON.parse(request.postDataBuffer()!.toString().match(/\r\n\r\n([\s\S]*?)\r\n--/)![1]);
      uploads++;
      const file = { id: `snapshot-${uploads}`, name: metadata.name, version: "1", createdTime: new Date().toISOString(), appProperties: metadata.appProperties };
      snapshots.push(file);
      await route.fulfill({ json: file });
    } else {
      lists++;
      if (slow) await new Promise((resolve) => setTimeout(resolve, 2400));
      await route.fulfill({ json: { files: snapshots } });
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
  await conflict.getByRole("button", { name: "Use the Drive copy on this device" }).click();
  await expect(conflict).not.toBeVisible();
  await page.waitForTimeout(2500);
  await expect(conflict).not.toBeVisible();
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
});
