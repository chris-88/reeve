import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

/**
 * Runs against the real Supabase project and the real triage Edge Function.
 * The point of this suite is to prove a capture survives the whole path —
 * mocking the backend would test the mock.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    /**
     * Chromium at phone size, not WebKit.
     *
     * WebKit would be the faithful choice — the app targets iOS Safari — but it
     * needs system libraries this machine can't install without root. Chromium
     * still covers the logic this suite exists to protect: capture, sync,
     * triage, and the row appearing.
     *
     * It will NOT catch iOS-Safari-specific behaviour: safe-area insets,
     * keyboard/viewport interaction, PWA install and eviction. Those still need
     * checking on a real phone. If e2e moves into CI, add a webkit project
     * there — GitHub's runners can install its dependencies.
     */
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @reeve/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
