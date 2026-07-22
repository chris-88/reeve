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
test("captures survive going offline and sync on reconnect", async ({ page, context }) => {
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
