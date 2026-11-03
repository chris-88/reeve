import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { purgeTestData, resolveTestUserId } from "../tests/support/test-accounts.ts";

const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;

const EMAIL = "e2e@reeve.test";
const PASSWORD = "e2e-" + "x".repeat(20);

const admin = createClient(URL, SECRET, { auth: { persistSession: false } });

let testUserId: string | undefined;

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (testUserId) await purgeTestData(admin, testUserId);
});

test.beforeAll(async () => {
  test.setTimeout(120_000);
  testUserId = await resolveTestUserId(admin, { url: URL, anonKey: ANON, email: EMAIL, password: PASSWORD });
  await purgeTestData(admin, testUserId);
  // The test account needs its own taxonomy (P1-F0); `unsorted` must exist.
  await admin.from("areas").upsert(
    [
      { id: "site", label: "Site", classifier_hint: "Building work: materials, subcontractors, pours, deliveries.", colour: "#b45309", sort_order: 0 },
      { id: "admin", label: "Admin", classifier_hint: "Invoices, insurance, tax, paperwork of any kind.", colour: "#0369a1", sort_order: 1 },
      { id: "unsorted", label: "Unsorted", classifier_hint: "Anything that cannot be placed confidently.", colour: "#71717a", sort_order: 99 },
    ].map((a) => ({ ...a, owner_id: testUserId })),
    { onConflict: "owner_id,id" },
  );
});

/** Signs in through the UI, so the sign-in screen is covered too. */
export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Tell Reeve")).toBeVisible();
}

test("a message is sent, filed, and comes back as a proposal you can hand over", async ({ page }) => {
  const marker = randomUUID().slice(0, 8);
  const text = `e2e ${marker} ring the site foreman about the concrete pour on thursday`;

  await signIn(page);
  await page.getByLabel("Tell Reeve").fill(text);
  await page.getByLabel("Tell Reeve").press("Enter");

  // The field clears once the capture is durable locally (rule 3); your
  // message is in the thread at once. No success toast.
  await expect(page.getByLabel("Tell Reeve")).toHaveValue("");
  await expect(page.getByRole("log").getByText(text)).toBeVisible();

  const user = createClient(URL, ANON, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });

  await expect
    .poll(
      async () => {
        const { data } = await user.from("captures").select("status").like("raw_text", `%${marker}%`).maybeSingle();
        return data?.status ?? "absent";
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe("done");

  const { data: row } = await user.from("captures").select("*").like("raw_text", `%${marker}%`).single();
  expect(row.area_id, "every capture gets a domain, never null").toBeTruthy();
  expect(row.title).toBeTruthy();

  // Reeve's "Filed" bubble arrives by realtime, no reload.
  await expect(page.getByText(/^Filed/).last()).toBeVisible({ timeout: 30_000 });

  // The commitment in that sentence became a row with a resolved date.
  const { data: commitments } = await user.from("commitments").select("*").eq("capture_id", row.id as string);
  expect(commitments!.length, "a stated intention becomes a commitment").toBeGreaterThan(0);
  expect(commitments![0]!.due_at, "and resolved to a real date").toBeTruthy();

  // An actionable capture becomes a proposed action: a card with its own title.
  const { data: action } = await user.from("actions").select("title").eq("capture_id", row.id).maybeSingle();
  expect(action?.title, "an actionable capture becomes a proposed action").toBeTruthy();
  await expect(page.getByText(action!.title as string).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/thread-after-filing.png", fullPage: false });

  // Hand to Reeve: the card becomes "On it." in place.
  await page.getByRole("button", { name: "Hand to Reeve" }).first().click();
  await expect(page.getByText("On it.")).toBeVisible();
  await expect
    .poll(
      async () => {
        const { data } = await user.from("actions").select("status").eq("capture_id", row.id).maybeSingle();
        return data?.status ?? "absent";
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe("dispatched");

  // The run is logged.
  const { data: runs } = await user.from("agent_runs").select("*").eq("capture_id", row.id as string);
  expect(runs!.length).toBeGreaterThan(0);
  expect(runs![0]!.ok).toBe(true);
});

test("a draft survives a reload", async ({ page }) => {
  const draft = `half-written thought ${randomUUID().slice(0, 6)}`;
  await signIn(page);
  await page.getByLabel("Tell Reeve").fill(draft);
  await page.reload();
  await expect(page.getByLabel("Tell Reeve")).toHaveValue(draft);
});

test("send is inert with no text", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.getByLabel("Tell Reeve").fill("   ");
  await expect(page.getByRole("button", { name: "Send" }), "whitespace is not a thought").toBeDisabled();
});

test("search filters the thread in place and clears with one tap", async ({ page }) => {
  const marker = randomUUID().slice(0, 8);
  await admin.from("captures").insert({ user_id: testUserId, raw_text: `searchable ${marker}`, status: "done", area_id: "admin", title: `Searchable ${marker}` });
  await admin.from("captures").insert({ user_id: testUserId, raw_text: `other ${marker}`, status: "done", area_id: "site", title: `Other ${marker}` });
  await signIn(page);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Search the thread").fill(`searchable ${marker}`);
  await expect(page.getByText(`searchable ${marker}`)).toBeVisible();
  await expect(page.getByText(`other ${marker}`)).toBeHidden();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByText(`other ${marker}`)).toBeVisible();
});
