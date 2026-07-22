import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const EMAIL = "e2e@reeve.test";
const PASSWORD = "e2e-" + "x".repeat(20);

const admin = createClient(URL, SECRET, { auth: { persistSession: false } });

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

/**
 * P1-F2's acceptance criterion, and the one that matters most: marking a
 * commitment done on a building site with no signal has to work.
 *
 * The fixture is written straight to the database rather than dictated,
 * because what is under test is the mutation path — the model call would only
 * add cost and flakiness to a test that is not about triage.
 */
test("a commitment completed offline survives a cold reload and syncs", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName === "webkit", "WebKit cannot emulate offline navigation");

  const marker = randomUUID().slice(0, 8);
  const { data: users } = await admin.auth.admin.listUsers();
  const userId = users.users.find((u) => u.email === EMAIL)!.id;

  const { data: capture } = await admin
    .from("captures")
    .insert({
      user_id: userId,
      raw_text: `offline commitment fixture ${marker}`,
      status: "done",
      title: `Fixture ${marker}`,
      summary: "A fixture.",
      entities: { people: [], dates: [], amounts: [], orgs: [] },
    })
    .select()
    .single();

  const text = `Drop the trailer back ${marker}`;
  const { data: commitment } = await admin
    .from("commitments")
    .insert({
      user_id: userId,
      capture_id: capture!.id,
      text,
      due_at: new Date().toISOString().slice(0, 10),
      fingerprint: `e2e-${marker}`,
    })
    .select()
    .single();

  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeVisible();

  // The worker has to be in control before the page can survive a reload.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30_000,
  });

  await page.getByRole("navigation").getByRole("button", { name: "Due" }).click();
  await expect(page.getByText(text)).toBeVisible();

  await context.setOffline(true);

  // Immediately, with no network: the tap is the acknowledgement.
  await page.getByRole("button", { name: `Mark done: ${text}` }).click();
  await expect(page.getByText(text)).toBeHidden();

  // Still done after a cold launch. This is the part a purely in-memory
  // optimistic update gets wrong — the state lives in IndexedDB, so the app
  // does not come back up telling him he still owes it.
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Due" }).click();
  await expect(page.getByText(text)).toBeHidden();

  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("commitments")
          .select("status")
          .eq("id", commitment!.id)
          .maybeSingle();
        return data?.status ?? "absent";
      },
      { timeout: 60_000, intervals: [1500] },
    )
    .toBe("done");

  await admin.from("captures").delete().eq("id", capture!.id);
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
