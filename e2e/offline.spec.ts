import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const EMAIL = "e2e@reeve.test";
const PASSWORD = "e2e-" + "x".repeat(20);

/**
 * The acceptance test for F1 through F4 together: the shell boots with no
 * network, a capture typed offline survives, and it syncs on reconnect.
 * None of this is exercisable against the dev server.
 */
test("captures survive going offline and sync on reconnect", async ({
  page,
  context,
  browserName,
}) => {
  /**
   * Chromium only.
   *
   * Playwright's WebKit throws "WebKit encountered an internal error" on a
   * reload while offline, so it cannot exercise a service-worker-served
   * navigation at all. That is a harness limitation, not an app defect — the
   * same assertions pass on Chromium.
   *
   * The consequence is real though: offline behaviour on the engine the app
   * actually ships to is NOT covered by CI, and still has to be checked by
   * hand on a device. WebKit continues to run every other test in the suite.
   */
  test.skip(browserName === "webkit", "WebKit cannot emulate offline navigation");

  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeVisible();

  // Wait for the worker to register and activate, then confirm it controls
  // the page. Registration alone is not enough — an uncontrolled page has no
  // offline capability.
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      return !!reg?.active;
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30_000,
  });
  await page.getByRole("navigation").getByRole("button", { name: "Inbox" }).click();
  await page.waitForTimeout(2500);

  await context.setOffline(true);

  // F1: a cold load with no network must render the app, not an error page.
  await page.reload();
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeVisible();

  // F2: the inbox must never claim emptiness when it has cached rows.
  await page.getByRole("navigation").getByRole("button", { name: "Inbox" }).click();
  await expect(page.getByText("Nothing captured yet.")).toBeHidden();

  // F3/F4: a capture taken offline is durable and visible as pending.
  const marker = randomUUID().slice(0, 8);
  await page.getByRole("navigation").getByRole("button", { name: "Write" }).click();
  await page.getByLabel("Capture a thought").fill(`offline ${marker} drop the trailer back`);
  await page.getByRole("main").getByRole("button", { name: /^Capture/ }).click();
  await expect(page.getByLabel("Capture a thought")).toHaveValue("");

  await context.setOffline(false);
  await page.reload();

  const user = createClient(URL, ANON, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });

  await expect
    .poll(
      async () => {
        const { data } = await user
          .from("captures")
          .select("status")
          .like("raw_text", `%${marker}%`)
          .maybeSingle();
        return data?.status ?? "absent";
      },
      { timeout: 60_000, intervals: [1500] },
    )
    .toBe("done");
});

/** UI-3: offline must read as offline, not as an endless spinner. */
test("offline shows an offline state, not a spinner", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "WebKit cannot emulate offline navigation");

  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeVisible();

  await context.setOffline(true);
  await page.getByLabel("Capture a thought").fill("offline copy check");
  await page.getByRole("main").getByRole("button", { name: /^Capture/ }).click();

  await expect(page.getByText("Offline. Saved on this device.")).toBeVisible();
  // A spinner that can never resolve is a lie.
  await expect(page.locator(".animate-spin")).toHaveCount(0);
  await expect(page.getByText("Retry")).toBeHidden();

  await context.setOffline(false);
  await expect(page.getByText("Offline. Saved on this device.")).toBeHidden({ timeout: 20_000 });
});
