import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { purgeTestData, resolveTestUserId } from "../tests/support/test-accounts.ts";

const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const EMAIL = "e2e@reeve.test";
const PASSWORD = "e2e-" + "x".repeat(20);

const admin = createClient(URL, SECRET, { auth: { persistSession: false } });
let userId: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  userId = await resolveTestUserId(admin, { url: URL, anonKey: ANON, email: EMAIL, password: PASSWORD });
  await admin.from("areas").upsert(
    [{ id: "unsorted", label: "Unsorted", classifier_hint: "Test fixture.", colour: "#71717a", sort_order: 99, owner_id: userId }],
    { onConflict: "owner_id,id" },
  );
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (userId) await purgeTestData(admin, userId);
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Tell Reeve")).toBeVisible();
}

async function workerInControl(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      return !!reg?.active;
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
}

/**
 * §5 acceptance, rule 3: offline, type three messages; back online, all three
 * file within fifteen seconds of triage and their "Filed" replies appear
 * without a reload. Chromium only: Playwright's WebKit cannot reload offline.
 */
test("three messages sent offline survive a reload and file on reconnect", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "WebKit cannot emulate offline navigation");

  await signIn(page);
  await workerInControl(page);
  await page.waitForTimeout(2000);

  await context.setOffline(true);

  // F1: a cold load with no network renders the thread, not an error page.
  await page.reload();
  await expect(page.getByLabel("Tell Reeve")).toBeVisible();
  await expect(page.getByText(/Offline\./)).toBeVisible();

  const marker = randomUUID().slice(0, 8);
  const texts = [1, 2, 3].map((i) => `offline ${marker} note ${i}`);
  for (const t of texts) {
    await page.getByLabel("Tell Reeve").fill(t);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByLabel("Tell Reeve")).toHaveValue("");
    await expect(page.getByRole("log").getByText(t)).toBeVisible();
  }
  // Pending, visibly, and still here after a cold launch with no network.
  await expect(page.getByText("sending…")).toHaveCount(3);
  await page.reload();
  for (const t of texts) await expect(page.getByRole("log").getByText(t)).toBeVisible();

  await context.setOffline(false);

  const user = createClient(URL, ANON, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  await expect
    .poll(
      async () => {
        const { data } = await user.from("captures").select("status").like("raw_text", `%${marker}%`);
        return (data ?? []).filter((r) => r.status === "done").length;
      },
      { timeout: 120_000, intervals: [1500] },
    )
    .toBe(3);

  // Their replies arrive by realtime: no reload.
  await expect(page.getByText("sending…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/^Filed/)).toHaveCount(3, { timeout: 30_000 });
});

/**
 * A due item ticked with no signal has to stick: through the outbox, across a
 * cold reload, and onto the server when the network is back.
 */
test("a due item ticked offline survives a cold reload and syncs", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "WebKit cannot emulate offline navigation");

  const marker = randomUUID().slice(0, 8);
  const { data: capture } = await admin
    .from("captures")
    .insert({ user_id: userId, raw_text: `due fixture ${marker}`, status: "done", title: `Fixture ${marker}`, area_id: "unsorted" })
    .select()
    .single();
  const text = `Drop the trailer back ${marker}`;
  const dueAt = new Date().toISOString().slice(0, 10);
  const { data: commitment } = await admin
    .from("commitments")
    .insert({ user_id: userId, capture_id: capture!.id, text, due_at: dueAt, fingerprint: `e2e-${marker}` })
    .select()
    .single();
  // The morning digest, as notify-due would leave it.
  await admin.from("notices").insert({
    user_id: userId,
    kind: "due",
    body: `Due today: 1. ${text}`,
    meta: { items: [{ id: commitment!.id, text, due_at: dueAt }], today: 1, overdue: 0 },
  });

  await signIn(page);
  await workerInControl(page);
  await expect(page.getByText(text)).toBeVisible();
  // The persisted cache writes on a 2 s throttle; give it the thread.
  await page.waitForTimeout(2500);

  await context.setOffline(true);

  await page.getByRole("button", { name: `Mark done: ${text}` }).click();
  await expect(page.getByRole("button", { name: `Reopen: ${text}` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: `Reopen: ${text}` })).toBeVisible();

  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const { data } = await admin.from("commitments").select("status").eq("id", commitment!.id).maybeSingle();
        return data?.status ?? "absent";
      },
      { timeout: 90_000, intervals: [1500] },
    )
    .toBe("done");
});

/** Offline must read as offline, not as an endless spinner. */
test("offline shows an offline state, not a spinner", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "WebKit cannot emulate offline navigation");

  await signIn(page);
  await context.setOffline(true);
  await page.getByLabel("Tell Reeve").fill("offline copy check");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(/Offline\./)).toBeVisible();
  await expect(page.locator(".animate-spin")).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByText(/Offline\./)).toBeHidden({ timeout: 20_000 });
});
