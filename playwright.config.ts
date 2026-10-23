import { defineConfig, devices } from "@playwright/test";

const development = process.env.PLAYWRIGHT_DEV === "1";
const port = development ? 3000 : 3100;
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: { command: `pnpm ${development ? "dev" : "start"} --port ${port}`, url: `http://localhost:${port}`, reuseExistingServer: development, timeout: 60000 },
});
