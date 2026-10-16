import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the REAL app (production build) against a FAKE backend
 * (tests/e2e/fake-backend.ts) so no real accounts or keys are needed.
 */
const APP_PORT = 3100;
const BACKEND_PORT = 54399;
const fakeEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${BACKEND_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake_for_tests",
  YOUTUBE_API_KEY: "fake-youtube-key",
  YOUTUBE_API_BASE_URL: `http://127.0.0.1:${BACKEND_PORT}/youtube/v3`,
  E2E_FAKE_SERVICES: "1",
  FAKE_BACKEND_PORT: String(BACKEND_PORT),
};

// Optional: use an already-installed Chromium (set CHROMIUM_PATH). Otherwise Playwright's own is used.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
  webServer: [
    {
      command: "npx tsx tests/e2e/fake-backend.ts",
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      env: fakeEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npx next build && npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      env: fakeEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
