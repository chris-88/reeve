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

let testUserId: string | undefined;

/**
 * P1-F13.3: clean up on the way out as well as on the way in.
 *
 * Cleaning only in `beforeAll` leaves the last run's fixtures sitting in the
 * live project until the next one — which is how a test account came to hold
 * more captures than the owner, and how a migration came to believe it was the
 * owner. Runs whether the suite passed or failed.
 *
 * The accumulation *assertion* lives in CI's `check-test-accounts.mjs` step,
 * not here — an extra listUsers per hook against the flaky auth admin API is
 * what timed these hooks out.
 */
test.afterAll(async () => {
  test.setTimeout(120_000);
  if (testUserId) await purgeTestData(admin, testUserId);
});

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Identity via sign-in, not the auth admin API — see resolveTestUserId.
  testUserId = await resolveTestUserId(admin, {
    url: URL,
    anonKey: ANON,
    email: EMAIL,
    password: PASSWORD,
  });

  // Clear this user's captures between runs. Without it, rows accumulate in the
  // real project and repeated runs produce duplicate titles, which turn strict
  // locators into false failures. Scoped to the test account only.
  // Commitments go with the captures by cascade.
  await purgeTestData(admin, testUserId);

  /**
   * The test account needs its own taxonomy.
   *
   * Before areas were owner-scoped this suite read the owner's real one —
   * every classifier_hint describing a real part of his life — which is the
   * exposure P1-F0 closed. These hints are invented, and `unsorted` has to
   * exist or triage has nowhere to put a capture it cannot place.
   */
  await admin.from("areas").upsert(
    [
      {
        id: "site",
        label: "Site",
        classifier_hint: "Building work: materials, subcontractors, pours, deliveries.",
        colour: "#b45309",
        sort_order: 0,
      },
      {
        id: "admin",
        label: "Admin",
        classifier_hint: "Invoices, insurance, tax, paperwork of any kind.",
        colour: "#0369a1",
        sort_order: 1,
      },
      {
        id: "unsorted",
        label: "Unsorted",
        classifier_hint: "Anything that cannot be placed confidently.",
        colour: "#71717a",
        sort_order: 99,
      },
    ].map((a) => ({ ...a, owner_id: testUserId })),
    { onConflict: "owner_id,id" },
  );
});

/**
 * Signs in through the UI rather than injecting a session, so the sign-in
 * screen is covered too — it has broken twice already.
 */
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeVisible();
}

test("a capture is written, synced, triaged and filed", async ({ page }) => {
  // A marker keeps this run's row findable among real captures.
  const marker = randomUUID().slice(0, 8);
  const text = `e2e ${marker} ring the site foreman about the concrete pour on thursday`;

  await signIn(page);
  await page.getByLabel("Capture a thought").fill(text);
  await page.getByRole("main").getByRole("button", { name: /^Capture/ }).click();

  // The field clears as soon as the capture is durable locally — never after
  // a network round-trip, and never before the write has resolved. There is no
  // success toast: the departure animation is the acknowledgement (UI-6/UI-11).
  await expect(page.getByLabel("Capture a thought")).toHaveValue("");

  await page.getByRole("navigation").getByRole("button", { name: "Inbox" }).click();

  // Triage involves a real model call, so allow generous time.
  const user = createClient(URL, ANON, { auth: { persistSession: false } });
  await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });

  await expect
    .poll(
      async () => {
        const { data } = await user
          .from("captures")
          .select("status, area_id, title, summary, entities")
          .like("raw_text", `%${marker}%`)
          .maybeSingle();
        return data?.status ?? "absent";
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe("done");

  const { data: row } = await user
    .from("captures")
    .select("*")
    .like("raw_text", `%${marker}%`)
    .single();

  expect(row.area_id, "every capture gets an area, never null").toBeTruthy();
  expect(row.title).toBeTruthy();
  expect(row.summary).toBeTruthy();
  expect(row.entities, "empty arrays are valid, missing keys are not").toHaveProperty("people");

  // Realtime should have moved the row from "Filing…" to its summary in place,
  // without a reload.
  await expect(page.getByText(row.title as string)).toBeVisible();

  // The run is logged and costed.
  const { data: runs } = await user
    .from("agent_runs")
    .select("*")
    .eq("capture_id", row.id as string);
  expect(runs!.length).toBeGreaterThan(0);
  expect(runs![0]!.ok).toBe(true);
  expect(Number(runs![0]!.cost_usd)).toBeGreaterThan(0);

  /**
   * P1-F1: the promise in that sentence became a row.
   *
   * The capture says "ring the site foreman about the concrete pour on
   * thursday", so a commitment must exist, and its due date must be resolved
   * against the capture's own day rather than left as an unanchored word.
   */
  const { data: commitments } = await user
    .from("commitments")
    .select("*")
    .eq("capture_id", row.id as string);

  expect(commitments!.length, "a stated intention becomes a commitment").toBeGreaterThan(0);
  const commitment = commitments![0]!;
  expect(commitment.status).toBe("open");
  expect(commitment.origin).toBe("model");
  expect(commitment.due_text, "the words as spoken are kept").toMatch(/thursday/i);
  expect(commitment.due_at, "and resolved to a real date").toBeTruthy();

  // The Due view shows it, grouped by when it is owed rather than by area.
  await page.getByRole("navigation").getByRole("button", { name: "Due" }).click();
  await expect(page.getByText(commitment.text as string)).toBeVisible();
});

test("a draft survives a reload", async ({ page }) => {
  // An installed PWA can be evicted from memory mid-sentence.
  const draft = `half-written thought ${randomUUID().slice(0, 6)}`;
  await signIn(page);
  await page.getByLabel("Capture a thought").fill(draft);
  await page.reload();
  await expect(page.getByLabel("Capture a thought")).toHaveValue(draft);
});

test("the capture button is inert with no text", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("main").getByRole("button", { name: /^Capture/ })).toBeDisabled();
  await page.getByLabel("Capture a thought").fill("   ");
  await expect(
    page.getByRole("main").getByRole("button", { name: /^Capture/ }),
    "whitespace is not a thought",
  ).toBeDisabled();
});

/** UI-12: the dot must not change the nav button's accessible name. */
test("the inbox tab keeps its accessible name while showing the dot", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Capture a thought").fill(`dot check ${randomUUID().slice(0, 6)}`);
  await page.getByRole("main").getByRole("button", { name: /^Capture/ }).click();
  await expect(
    page.getByRole("navigation").getByRole("button", { name: "Inbox", exact: true }),
  ).toBeVisible();
});
