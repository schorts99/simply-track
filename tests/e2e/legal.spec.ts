import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    Object.defineProperty(navigator, "language", { get: () => "en-US" });
  });
});

test("legal pages are linked, localized and readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto("/");
  const legal = page.getByRole("navigation", { name: "Legal" });
  await legal.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("SimplyTrack never receives biometric data.", { exact: false })).toBeVisible();
  await expect(page).toHaveTitle("Privacy Policy | SimplyTrack");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("main").getByLabel(/Language/).selectOption("es");
  await expect(page.getByRole("heading", { level: 1, name: "Política de privacidad" })).toBeVisible();
  await expect(page).toHaveTitle("Política de privacidad | SimplyTrack");
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Términos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Términos y condiciones" })).toBeVisible();
  await expect(page).toHaveTitle("Términos y condiciones | SimplyTrack");
  await page.getByRole("link", { name: "Volver a SimplyTrack" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("legal pages work offline", async ({ page, context }) => {
  await page.goto("/terms");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms and Conditions" })).toBeVisible();
  await context.setOffline(false);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("legal pages are readable by anyone, including crawlers", async ({ page }) => {
    for (const [path, title] of [["/privacy", "Privacy Policy"], ["/terms", "Terms and Conditions"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Legal" })).toBeVisible();
    }
  });
});
