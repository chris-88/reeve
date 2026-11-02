import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { purgeTestData, resolveTestUserId } from "../tests/support/test-accounts.ts";

/**
 * PN-1 and PN-2 (docs/arc-spec-notifications.md): a notification's address
 * opens the card it names, and the app-icon badge follows the Needs you count.
 * A real push cannot be delivered to Playwright (WP-F6.2), so this drives the
 * address directly and stubs the Badging API.
 */
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
  await purgeTestData(admin, userId);
  await admin.from("areas").upsert(
    [{ id: "unsorted", label: "Unsorted", classifier_hint: "Test fixture.", colour: "#71717a", sort_order: 99, owner_id: userId }],
    { onConflict: "owner_id,id" },
  );
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (userId) await purgeTestData(admin, userId);
});

test("a notification's address opens its card, and the badge is the Needs you count", async ({ page }) => {
  // One action waiting for review, as the bridge would leave it.
  const marker = randomUUID().slice(0, 8);
  const { data: capture } = await admin
    .from("captures")
    .insert({ user_id: userId, raw_text: `e2e ${marker} notification fixture`, status: "done", area_id: "unsorted" })
    .select("id")
    .single();
  const { data: action } = await admin
    .from("actions")
    .insert({
      user_id: userId,
      capture_id: capture!.id,
      title: `Notification fixture ${marker}`,
      status: "review",
      result: "What I did: nothing, this is a fixture.\nWhere: nothing written\nFor you: approve.",
      area_id: "unsorted",
    })
    .select("id")
    .single();

  // PN-2.4: record what the app asks the icon to show.
  await page.addInitScript(() => {
    const w = window as unknown as { __badge: number[] };
    w.__badge = [];
    Object.defineProperty(navigator, "setAppBadge", {
      configurable: true,
      value: (n?: number) => {
        w.__badge.push(n ?? 0);
        return Promise.resolve();
      },
    });
    Object.defineProperty(navigator, "clearAppBadge", {
      configurable: true,
      value: () => {
        w.__badge.push(0);
        return Promise.resolve();
      },
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeVisible();

  // PN-1.2: the address a bridge push carries.
  await page.goto(`/#/needs-you/${action!.id}`);
  await expect(page.getByRole("heading", { name: `Notification fixture ${marker}` })).toBeVisible();
  await expect(page.getByText("What I did: nothing, this is a fixture.")).toBeVisible();

  // PN-2.2: one thing needs him, so the icon says 1.
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __badge: number[] }).__badge.at(-1))).toBe(1);

  // PN-1.2: the focus is consumed — the id leaves the address without a history entry.
  await expect.poll(async () => page.evaluate(() => window.location.hash)).toBe("#/needs-you");

  // Approve clears it.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __badge: number[] }).__badge.at(-1))).toBe(0);
});
