import { expect, test } from "@playwright/test";

test.use({ locale: "es-CR" });

test("detects Spanish and persists an explicit override without translating stored records", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Una relación más sencilla con tu dinero." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect(await page.evaluate(() => localStorage.getItem("simply-track-language"))).toBeNull();
  await page.getByLabel("Contraseña de la bóveda", { exact: true }).fill("una contraseña de prueba segura");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("una contraseña de prueba segura");
  await page.getByRole("button", { name: "Crear mi bóveda privada" }).click();
  await expect(page.getByRole("heading", { name: "Un poco de claridad. Muchas posibilidades." })).toBeVisible();
  await page.getByRole("button", { name: "Añadir movimiento", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Descripción", { exact: true }).fill("My original title");
  await dialog.getByLabel("Importe", { exact: true }).fill("55.29");
  await dialog.getByRole("combobox", { name: "Categoría", exact: true }).selectOption({ label: "Supermercado" });
  await dialog.getByRole("combobox", { name: "Método de pago", exact: true }).selectOption({ label: "Efectivo" });
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("My original title", { exact: true })).toBeVisible();
  const settingsName = testInfo.project.name === "mobile" ? "Ajustes" : "Ajustes y almacenamiento";
  await page.getByRole("button", { name: settingsName, exact: true }).click();
  await dialog.getByRole("combobox", { name: "Idioma" }).selectOption("en");
  await expect(dialog.getByRole("heading", { name: "Your space, your settings" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("simply-track-language"))).toBe("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "A little clarity. A lot of possibility." })).toBeVisible();
  await expect(page.getByText("My original title", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /My original title Groceries/ }).click();
  await expect(dialog.getByRole("combobox", { name: "Category", exact: true })).toHaveValue("Groceries");
  await expect(dialog.getByRole("combobox", { name: "Payment method", exact: true })).toHaveValue("Cash");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: testInfo.project.name === "mobile" ? "Settings" : "Settings & storage", exact: true }).click();
  await dialog.getByRole("button", { name: "Lock vault & log out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await page.getByLabel("Contraseña de la bóveda", { exact: true }).fill("una contraseña incorrecta");
  await page.getByRole("button", { name: "Desbloquear mi bóveda" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "la contraseña es incorrecta" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("saved Spanish wins over English device settings, survives reload, and works offline", async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    Object.defineProperty(navigator, "language", { get: () => "en-US" });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A simpler relationship with money." })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption("es");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Una relación más sencilla con tu dinero." })).toBeVisible();
  await page.getByLabel("Contraseña de la bóveda", { exact: true }).fill("otra contraseña segura 123");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("otra contraseña segura 123");
  await page.getByRole("button", { name: "Crear mi bóveda privada" }).click();
  const nav = page.getByRole("navigation", { name: testInfo.project.name === "mobile" ? "Navegación móvil" : "Navegación principal" });
  await nav.getByRole("button", { name: testInfo.project.name === "mobile" ? "¿Y si…?" : "Simulaciones", exact: true }).click();
  await page.getByRole("button", { name: "Explorar una simulación" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre de la simulación").fill("Vacaciones");
  await dialog.getByLabel("Cambio mensual en ingresos (+ o -)").fill("100");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("heading", { name: "Vacaciones", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: testInfo.project.name === "mobile" ? "Proyección" : "Proyección de flujo", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Saldo proyectado" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Un poco de claridad. Muchas posibilidades." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(false);
});

test("an unavailable local storage preference is reported and does not block the language switch", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "simply-track-language") throw new DOMException("Blocked", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "simply-track-language") throw new DOMException("Blocked", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo guardar o leer" })).toBeVisible();
  await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");
  await expect(page.getByRole("heading", { name: "A simpler relationship with money." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Language preferences could not be saved or read" })).toBeVisible();
});
