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
     * Chromium locally, Chromium + WebKit in CI.
     *
     * The app targets iOS Safari, so WebKit is the faithful choice, but it
     * needs system libraries the dev machine cannot install without root.
     * Neither engine catches PWA install or storage eviction behaviour — those
     * still need a real phone.
     */
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    // WebKit only where its system dependencies can be installed.
    ...(process.env.CI ? [{ name: "mobile-webkit", use: { ...devices["iPhone 14"] } }] : []),
  ],
  /**
   * Preview, not dev.
   *
   * The service worker is disabled in dev, so the offline test — the acceptance
   * criterion for the whole hardening effort — cannot run against it. Testing
   * the built artefact is also closer to what actually ships.
   */
  webServer: {
    command: "pnpm --filter @reeve/web build && pnpm --filter @reeve/web preview --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
