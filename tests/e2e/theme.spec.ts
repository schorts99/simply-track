import { expect, test } from "@playwright/test";

test("system is the default, explicit light/dark overrides persist, and returning to system follows changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const select = page.getByRole("combobox", { name: "Appearance", exact: true });
  await expect(select).toHaveValue("system");
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("simply-track-theme"))).toBeNull();
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(21, 21, 30)");
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).colorScheme)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f7f8fa");
  await select.selectOption("dark");
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("simply-track-theme"))).toBe("dark");
  await page.reload();
  await expect(select).toHaveValue("dark");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await select.selectOption("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(select).toHaveValue("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await select.selectOption("system");
  expect(await page.evaluate(() => localStorage.getItem("simply-track-theme"))).toBe("system");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

test("dark appearance covers unlocked screens, forms and settings and survives offline reload and logout", async ({ page, context }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByLabel("Vault password", { exact: true }).fill("a safe test theme password");
  await page.getByLabel("Confirm password", { exact: true }).fill("a safe test theme password");
  await page.getByRole("button", { name: "Create my private vault" }).click();
  await expect(page.getByRole("heading", { name: "A little clarity. A lot of possibility." })).toBeVisible();
  expect(await page.locator(".card").first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(30, 30, 42)");
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(30, 30, 42)");
  expect(await dialog.getByLabel("Description", { exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(21, 21, 30)");
  await dialog.getByLabel("Description", { exact: true }).fill("Dark mode purchase");
  await dialog.getByLabel("Amount", { exact: true }).fill("12");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Dark mode purchase", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: testInfo.project.name === "mobile" ? "Settings" : "Settings & storage", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("es");
  await expect(dialog.getByRole("combobox", { name: "Apariencia", exact: true })).toHaveValue("dark");
  await expect(dialog.getByRole("option", { name: "Claro", exact: true })).toHaveAttribute("value", "light");
  await expect(dialog.getByRole("option", { name: "Oscuro", exact: true })).toHaveAttribute("value", "dark");
  await expect(dialog.getByRole("option", { name: "Sistema", exact: true })).toHaveAttribute("value", "system");
  await dialog.getByRole("button", { name: "Cerrar ventana" }).click();
  await page.screenshot({ path: testInfo.outputPath("dark-overview.png"), fullPage: true });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Dark mode purchase", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#15151e");
  await page.getByRole("button", { name: testInfo.project.name === "mobile" ? "Ajustes" : "Ajustes y almacenamiento", exact: true }).click();
  await dialog.getByRole("button", { name: "Bloquear bóveda y cerrar sesión", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Te damos la bienvenida." })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Apariencia" })).toHaveValue("dark");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(false);
});

test("invalid saved values fall back to system and storage failures remain visible", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("simply-track-theme", "invalid"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Appearance" })).toHaveValue("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "simply-track-theme") throw new DOMException("Blocked", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("alert").filter({ hasText: "Appearance preferences could not be saved or read" })).toBeVisible();
});

test("applies a saved override before React loads", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("simply-track-theme", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(21, 21, 30)");
});

test("updates other tabs and falls back to system when the saved preference is removed", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const second = await context.newPage();
  await second.emulateMedia({ colorScheme: "light" });
  await second.goto("/");
  await expect(second.getByRole("combobox", { name: "Appearance" })).toHaveValue("system");
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await expect(second.getByRole("combobox", { name: "Appearance" })).toHaveValue("dark");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => sessionStorage.setItem("simply-track-theme", "light"));
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => localStorage.removeItem("simply-track-theme"));
  await expect(second.getByRole("combobox", { name: "Appearance" })).toHaveValue("system");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
  await second.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
  await page.evaluate(() => localStorage.clear());
  await expect(second.getByRole("combobox", { name: "Appearance" })).toHaveValue("system");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
  await second.close();
});

test("reports blocked reads without preventing appearance changes", async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "simply-track-theme") throw new DOMException("Blocked", "SecurityError");
      return getItem.call(this, key);
    };
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("alert").filter({ hasText: "Appearance preferences could not be saved or read" })).toBeVisible();
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("alert").filter({ hasText: "Appearance preferences could not be saved or read" })).not.toBeVisible();
});
