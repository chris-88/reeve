import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;

const EMAIL = "e2e@reeve.test";
const PASSWORD = "e2e-" + "x".repeat(20);

const admin = createClient(URL, SECRET, { auth: { persistSession: false } });

test.beforeAll(async () => {
  const { error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already|registered/i.test(error.message)) throw error;

  // Clear this user's captures between runs. Without it, rows accumulate in the
  // real project and repeated runs produce duplicate titles, which turn strict
  // locators into false failures. Scoped to the test account only.
  const { data: users } = await admin.auth.admin.listUsers();
  const testUser = users.users.find((u) => u.email === EMAIL);
  if (testUser) {
    await admin.from("agent_runs").delete().eq("user_id", testUser.id);
    await admin.from("captures").delete().eq("user_id", testUser.id);
  }
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
  // a network round-trip, and never before the write has resolved.
  await expect(page.getByLabel("Capture a thought")).toHaveValue("");
  await expect(page.getByText("Captured")).toBeVisible();

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
      { timeout: 45_000, intervals: [1000] },
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
