import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const chromeOnMac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (existsSync(chromeOnMac) ? chromeOnMac : undefined);
const port = 3103;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "live-api-flow.spec.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath },
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
