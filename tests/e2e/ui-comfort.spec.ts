import { expect, test, type Page } from "@playwright/test";

async function createVault(page: Page) {
  await page.goto("/");
  await page.getByLabel("Vault password", { exact: true }).fill("a comfortable UI test password");
  await page.getByLabel("Confirm password", { exact: true }).fill("a comfortable UI test password");
  await page.getByRole("button", { name: "Create my private vault" }).click();
  await expect(page.getByRole("heading", { name: "A little clarity. A lot of possibility." })).toBeVisible();
}

test("filters offer a useful recovery and historical months have a quick return", async ({ page }, testInfo) => {
  await createVault(page);
  await page.getByRole("button", { name: "Coffee $5.25", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(page.locator(".toast")).not.toBeVisible();
  const nav = page.getByRole("navigation", { name: testInfo.project.name === "mobile" ? "Mobile navigation" : "Main navigation" });
  await nav.getByRole("button", { name: testInfo.project.name === "mobile" ? "Activity" : "Transactions", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search transactions" });
  await search.fill("  coffee  ");
  await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
  await search.fill("not a transaction");
  await expect(page.getByRole("heading", { name: "No matching transactions" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).last().click();
  await expect(search).toHaveValue("");
  await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Transaction type" }).selectOption("income");
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByRole("combobox", { name: "Transaction type" })).toHaveValue("all");
  const month = page.getByLabel("Selected month");
  const current = await month.inputValue();
  await month.fill("2020-01");
  await page.getByRole("button", { name: "This month", exact: true }).click();
  await expect(month).toHaveValue(current);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await nav.getByRole("button", { name: testInfo.project.name === "mobile" ? "Forecast" : "Cashflow forecast", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("#main-content")).toBeFocused();
  const table = page.getByRole("region", { name: "Monthly forecast details" });
  await table.focus();
  await expect(table).toBeFocused();
  await expect(page.getByRole("table")).toHaveAccessibleName("Monthly forecast details");
});

test("long forms retain reachable actions and reveal invalid collapsed fields", async ({ page }, testInfo) => {
  await createVault(page);
  await page.getByRole("button", { name: testInfo.project.name === "mobile" ? "Settings" : "Settings & storage", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit preferences" }).click();
  const save = dialog.getByRole("button", { name: "Save changes" });
  await expect(save).toBeInViewport();
  const before = await dialog.locator(".modal-heading").boundingBox();
  await dialog.evaluate((element) => { element.scrollTop = 500; });
  const after = await dialog.locator(".modal-heading").boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  await expect(save).toBeInViewport();
  const bounds = await dialog.boundingBox();
  const action = await save.boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height - 1);
  const expenses = dialog.locator("details").filter({ has: page.locator("summary").getByText("Expense categories", { exact: true }) });
  await expenses.locator("summary").click();
  await expenses.getByRole("button", { name: "Add option" }).click();
  const invalid = expenses.getByRole("textbox").last();
  await expenses.locator("summary").click();
  await save.click();
  await expect(expenses).toHaveAttribute("open", "");
  await expect(invalid).toBeFocused();
  await invalid.fill("My category");
  await save.click();
  await expect(dialog).not.toBeVisible();
});

test("responsive layouts handle long content with comfortable controls in both themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await createVault(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Expense", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await dialog.getByLabel("Description", { exact: true }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await dialog.getByLabel("Description", { exact: true }).fill("A".repeat(120));
  await dialog.getByLabel("Amount", { exact: true }).fill("10000000000");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    for (const name of ["Home", "Activity", "Plan", "Forecast", "What if"]) {
      const tab = nav.getByRole("button", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${theme}`).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${name.replaceAll(" ", "-")}-320.png`), fullPage: true, animations: "disabled" });
    }
    await nav.getByRole("button", { name: "Home", exact: true }).click();
    const targets = page.locator(".month-picker .icon-button, .mobile-settings, .row-delete, .bottom-nav button");
    for (const element of await targets.all()) {
      const bounds = await element.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    for (const element of await page.locator(".stat > strong, .amount, .transaction-description").all()) {
      expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    for (const value of await page.locator(".stat > strong").all()) {
      expect(await value.evaluate((node) => node.getBoundingClientRect().height <= parseFloat(getComputedStyle(node).lineHeight) + 1)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
