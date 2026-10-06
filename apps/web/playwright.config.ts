import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const SERVER_PORT = 3000;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter @hitstop/server start",
      url: `http://127.0.0.1:${SERVER_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The preview server proxies /ws to the game server (vite.config.ts).
      command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
