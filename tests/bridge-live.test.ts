import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { purgeTestData, signInTestUser } from "./support/test-accounts.ts";
import { claimNext, connect, type Db } from "../apps/bridge/src/db.ts";
import { processOnce, type Deps } from "../apps/bridge/src/worker.ts";
import type { RunOutcome, RunRequest } from "../apps/bridge/src/run.ts";

dotenv.config({ path: ".env.local", quiet: true });

/**
 * The bridge against the real stack (docs/arc-spec-bridge.md §6 step 2): the
 * claim SQL, the state transitions, the agent_runs row and the push contract,
 * with Claude Code itself replaced by a stub runner. The one thing a stub
 * cannot prove — a real headless run — is proven by hand on the quinn machine
 * and recorded in the spec's §0.
 *
 * Its own test account with its own areas (P1-F13), torn down unconditionally.
 */
const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;
const PASSWORD = "test-".padEnd(32, "x");

/**
 * This suite needs the stack's Postgres directly (the claim SQL, NOTIFY). That
 * socket is never published, so the suite can only run on the machine that
 * hosts the stack. Anywhere DATABASE_URL is absent (CI, another checkout) the
 * whole file skips rather than failing the run.
 */
const LIVE = Boolean(URL && ANON && SECRET && DATABASE_URL);
const ASSIGNEE = `bridge-test@${randomUUID().slice(0, 8)}`;

let admin: SupabaseClient;
let db: Db;
let userId: string;
const pushes: { userId: string; title: string; body?: string; url?: string; tag?: string }[] =
  [];
const runs: RunRequest[] = [];
let nextOutcome: Partial<RunOutcome> = {};

const outcome = (over: Partial<RunOutcome>): RunOutcome => ({
  ok: true,
  output:
    "What I did: drafted it.\nWhere: nothing written\nFor you: approve means the draft is right.",
  error: null,
  model: "stub",
  costUsd: 0.01,
  durationMs: 1200,
  numTurns: 3,
  stderr: "",
  ...over,
});

const deps = (): Deps => ({
  db,
  run: async (req) => {
    runs.push(req);
    return outcome(nextOutcome);
  },
  push: async (uid, n) => {
    pushes.push({ userId: uid, title: n.title, body: n.body, url: n.url, tag: n.tag });
  },
  log: () => {},
  health: () => {},
  home: "/home/test",
  assignee: ASSIGNEE,
});

async function capture(text: string): Promise<string> {
  const { data, error } = await admin
    .from("captures")
    .insert({ user_id: userId, raw_text: text, status: "done", area_id: "home" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function action(over: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin
    .from("actions")
    .insert({
      user_id: userId,
      capture_id: await capture(`bridge fixture ${randomUUID()}`),
      area_id: "home",
      title: "Fixture",
      ...over,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function row(id: string) {
  const { data } = await admin.from("actions").select("*").eq("id", id).single();
  return data!;
}

describe.skipIf(!LIVE)("bridge live", () => {
  beforeAll(async () => {
    /**
     * The live worker must be stopped first. It LISTENs on the same database, so
     * it claims this suite's dispatched fixtures within a second of their insert
     * and runs Claude Code on them for real (it did, on 2026-11-02: a fixture
     * titled "Fixture" was claimed and run in ~/vault before the suite could).
     * Refusing is cheaper than racing it.
     */
    try {
      const state = execFileSync("systemctl", ["--user", "is-active", "reeve-bridge"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (state === "active") {
        throw new Error(
          "reeve-bridge is running and would claim this suite's fixtures: `systemctl --user stop reeve-bridge` first, start it again after",
        );
      }
    } catch (err) {
      if (err instanceof Error && /reeve-bridge is running/.test(err.message)) throw err;
      // systemctl missing or the unit unknown (CI, another machine): nothing to race.
    }
    if (!URL || !ANON || !SECRET || !DATABASE_URL)
      throw new Error("Missing config in .env.local");
    admin = createClient(URL, SECRET, { auth: { persistSession: false } });
    db = connect(DATABASE_URL);
    ({ id: userId } = await signInTestUser(admin, {
      url: URL,
      anonKey: ANON,
      email: "bridge@reeve.test",
      password: PASSWORD,
    }));
    await purgeTestData(admin, userId);
    const { error } = await admin.from("areas").upsert(
      ["unsorted", "home"].map((id, i) => ({
        owner_id: userId,
        id,
        label: id,
        classifier_hint: "Test fixture.",
        colour: "#000000",
        sort_order: i,
      })),
      { onConflict: "owner_id,id" },
    );
    if (error) throw error;
  });

  afterAll(async () => {
    if (admin && userId) {
      await purgeTestData(admin, userId);
      await admin.from("areas").delete().eq("owner_id", userId);
    }
    await db?.end();
  });

  describe("BR-1.1 claim", () => {
    it("takes the Queued lane in queue_position order and nothing that is not claimable", async () => {
      const later = await action({
        status: "dispatched",
        brief: "b",
        dispatched_at: new Date().toISOString(),
        queue_position: 2,
      });
      const first = await action({
        status: "dispatched",
        brief: "a",
        dispatched_at: new Date().toISOString(),
        queue_position: 1,
      });
      await action({ status: "proposed" }); // a plain proposed task must wait for Go
      await action({ status: "review", result: "x" });

      const a = await claimNext(db, ASSIGNEE);
      expect(a?.id).toBe(first);
      expect(a).toMatchObject({ status: "working", assignee: ASSIGNEE });
      expect(a?.started_at).toBeTruthy();

      const b = await claimNext(db, ASSIGNEE);
      expect(b?.id).toBe(later);
      expect(await claimNext(db, ASSIGNEE)).toBeNull();

      // leave them in review so they are not reclaimed below
      await admin
        .from("actions")
        .update({ status: "review", result: "claimed in test" })
        .in("id", [first, later]);
    });
  });

  describe("processOnce", () => {
    it("BR-3: dispatched → working → review with a result, a run row and a push", async () => {
      const id = await action({
        status: "dispatched",
        brief: "# Fixture\n\nDo the thing.",
        dispatched_at: new Date().toISOString(),
        queue_position: 10,
      });
      nextOutcome = {};
      pushes.length = 0;
      runs.length = 0;

      const tick = await processOnce(deps());
      expect(tick.kind).toBe("ran");
      if (tick.kind !== "ran") return;
      expect(tick.action.id).toBe(id);
      expect(tick.ok).toBe(true);

      const r = await row(id);
      expect(r.status).toBe("review");
      expect(r.assignee).toBe(ASSIGNEE);
      expect(r.result).toMatch(/^What I did: drafted it\./);
      expect(runs[0]?.prompt).toContain("Do the thing.");
      expect(runs[0]?.cwd).toBe("/home/test/vault");

      const { data: run } = await admin
        .from("agent_runs")
        .select("*")
        .eq("capture_id", r.capture_id)
        .eq("step", "bridge")
        .single();
      expect(run).toMatchObject({ ok: true, model: "stub", duration_ms: 1200 });
      // PN-1.3 / PN-5.1: the push opens this card and replaces any earlier one for it.
      expect(pushes).toEqual([
        {
          userId,
          title: "Reeve: Fixture",
          body: "What I did: drafted it.",
          url: `/#/m/action:${id}`,
          tag: `action:${id}`,
        },
      ]);
    });

    it("BR-4.1: a failed run lands in review with the failure text, never silently re-queued", async () => {
      const id = await action({
        status: "dispatched",
        brief: "x",
        dispatched_at: new Date().toISOString(),
        queue_position: 20,
      });
      nextOutcome = { ok: false, output: "", error: "timed out after 40 minutes" };
      pushes.length = 0;

      const tick = await processOnce(deps());
      expect(tick.kind).toBe("ran");
      const r = await row(id);
      expect(r.status).toBe("review");
      expect(r.result).toBe("Reeve could not complete this: timed out after 40 minutes");
      const { data: run } = await admin
        .from("agent_runs")
        .select("ok, error")
        .eq("capture_id", r.capture_id)
        .eq("step", "bridge")
        .single();
      expect(run).toEqual({ ok: false, error: "timed out after 40 minutes" });
      expect(pushes[0]?.body).toMatch(/Could not complete/);
      expect(pushes[0]?.url).toBe(`/#/m/action:${id}`);
      expect(await processOnce(deps())).toEqual({ kind: "idle" });
    });

    it("BR-5.2: a redo's feedback and previous result reach the prompt", async () => {
      const id = await action({
        status: "dispatched",
        brief: "x",
        dispatched_at: new Date().toISOString(),
        queue_position: 30,
        result: "What I did: first go",
        feedback: "shorter please",
      });
      nextOutcome = {};
      runs.length = 0;
      await processOnce(deps());
      expect(runs[0]?.prompt).toContain("Chris said:\nshorter please");
      expect(runs[0]?.prompt).toContain("Previous attempt:\nWhat I did: first go");
      expect((await row(id)).status).toBe("review");
    });

    it("BR-6.3: a proposed decompose is picked up without Go and creates proposed actions and commitments only", async () => {
      const id = await action({
        status: "proposed",
        kind: "decompose",
        title: "Break this down: school run",
      });
      const captureId = (await row(id)).capture_id as string;
      nextOutcome = {
        output:
          "```json\n" +
          JSON.stringify({
            summary: "Three things.",
            actions: [
              { title: "Book the dentist", brief: "Ring the practice." },
              { title: "Reply to the coach", brief: "Say yes." },
            ],
            commitments: [
              { text: "Pay the creche invoice", due_text: "Friday", due_at: "2026-11-06" },
              { text: "Pay the creche invoice", due_text: "Friday", due_at: "2026-11-06" },
            ],
            notes: [],
          }) +
          "\n```",
      };

      const tick = await processOnce(deps());
      expect(tick.kind).toBe("ran");
      expect((await row(id)).status).toBe("review");
      expect((await row(id)).result).toContain("2 proposed action(s), 2 commitment(s)");

      const { data: created } = await admin
        .from("actions")
        .select("title, status, kind, brief")
        .eq("capture_id", captureId)
        .neq("id", id)
        .order("title");
      expect(created).toEqual([
        {
          title: "Book the dentist",
          status: "proposed",
          kind: "task",
          brief: "Ring the practice.",
        },
        { title: "Reply to the coach", status: "proposed", kind: "task", brief: "Say yes." },
      ]);
      const { data: commitments } = await admin
        .from("commitments")
        .select("text, due_at")
        .eq("capture_id", captureId);
      expect(commitments).toEqual([
        { text: "Pay the creche invoice", due_at: "2026-11-06T00:00:00+00:00" },
      ]);
      // Nothing dispatched: the new actions wait for Go, so the next tick is idle.
      expect(await processOnce(deps())).toEqual({ kind: "idle" });
    });

    it("BR-8: pauses at the limit and leaves the queue untouched", async () => {
      const id = await action({
        status: "dispatched",
        brief: "x",
        dispatched_at: new Date().toISOString(),
        queue_position: 40,
      });
      const tick = await processOnce({ ...deps(), limits: { perHour: 1, perDay: 1 } });
      expect(tick).toMatchObject({ kind: "paused", reason: expect.stringMatching(/limit/) });
      expect((await row(id)).status).toBe("dispatched");
      await admin.from("actions").update({ status: "declined" }).eq("id", id);
    });
  });
});
