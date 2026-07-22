import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

dotenv.config({ path: ".env.local", quiet: true });

/**
 * These run against the real project. RLS is enforced by Postgres, so a mocked
 * client would prove nothing — the whole point is that the actual policies
 * refuse the actual requests.
 */
const URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;

const PASSWORD = "test-".padEnd(32, "x");

/** Signed-out client, holding only the publishable key a browser would have. */
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let admin: SupabaseClient;
let alice: SupabaseClient;
let bob: SupabaseClient;
let aliceId: string;
let bobId: string;
let aliceCaptureId: string;
let aliceNameCaptureId: string;
let aliceCommitmentId: string;

/**
 * Areas are owner-scoped since 0003, so each account needs its own — including
 * its own `unsorted`. Seeding both here is also the proof that duplicating it
 * per user works: two rows sharing a slug is only possible because the primary
 * key became composite.
 */
async function seedAreas(ownerId: string, ids: readonly string[]): Promise<void> {
  const { error } = await admin.from("areas").upsert(
    ids.map((id, i) => ({
      owner_id: ownerId,
      id,
      label: id,
      classifier_hint: "Test fixture.",
      colour: "#000000",
      sort_order: i,
    })),
    { onConflict: "owner_id,id" },
  );
  if (error) throw error;
}

async function signIn(email: string): Promise<{ client: SupabaseClient; id: string }> {
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already|registered/i.test(error.message)) throw error;

  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
  return { client, id: data.user.id };
}

beforeAll(async () => {
  if (!URL || !ANON || !SECRET) {
    throw new Error("Missing Supabase config. Fill in .env.local — see .env.example.");
  }
  admin = createClient(URL, SECRET, { auth: { persistSession: false } });

  ({ client: alice, id: aliceId } = await signIn("rls-alice@reeve.test"));
  ({ client: bob, id: bobId } = await signIn("rls-bob@reeve.test"));

  await seedAreas(aliceId, ["unsorted", "alice-only"]);
  await seedAreas(bobId, ["unsorted"]);

  const { data, error } = await alice
    .from("captures")
    .insert({ user_id: aliceId, raw_text: `rls fixture ${randomUUID()}` })
    .select()
    .single();
  if (error) throw error;
  aliceCaptureId = data.id;

  // A surname, spelled correctly. The retrieval test searches for it spelled
  // the way dictation would get it wrong.
  const { data: named, error: namedError } = await alice
    .from("captures")
    .insert({ user_id: aliceId, raw_text: "Ring Beaumont about the retaining wall quote" })
    .select()
    .single();
  if (namedError) throw namedError;
  aliceNameCaptureId = named.id;

  const { data: commitment, error: commitmentError } = await alice
    .from("commitments")
    .insert({
      user_id: aliceId,
      capture_id: aliceCaptureId,
      text: "rls fixture commitment",
      fingerprint: `rls-${randomUUID()}`,
    })
    .select()
    .single();
  if (commitmentError) throw commitmentError;
  aliceCommitmentId = commitment.id;
});

/**
 * These run against the real project, and the pg_cron sweeper triages anything
 * it finds sitting at 'queued'. Left behind, every CI run would add fixtures
 * to the capture list and a model call to the bill. Deleted via the service
 * key, because there is deliberately no delete policy for the client — and
 * commitments go with them by cascade.
 */
afterAll(async () => {
  await admin.from("captures").delete().in("id", [aliceCaptureId, aliceNameCaptureId]);
});

describe("anonymous access", () => {
  it("cannot read captures", async () => {
    const { data, error } = await anon.from("captures").select("*");
    // RLS filters rows rather than erroring, so an empty set is the pass.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot insert a capture", async () => {
    const { error } = await anon
      .from("captures")
      .insert({ user_id: randomUUID(), raw_text: "should be refused" });
    expect(error?.code).toBe("42501");
  });

  it("cannot read areas", async () => {
    // The read policy grants `authenticated`, not `anon`.
    const { data } = await anon.from("areas").select("*");
    expect(data).toEqual([]);
  });

  it("cannot read agent_runs", async () => {
    const { data } = await anon.from("agent_runs").select("*");
    expect(data).toEqual([]);
  });

  it("cannot read commitments", async () => {
    const { data } = await anon.from("commitments").select("*");
    expect(data).toEqual([]);
  });
});

describe("signed-in access", () => {
  it("reads its own captures", async () => {
    const { data, error } = await alice.from("captures").select("*").eq("id", aliceCaptureId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("reads its own areas", async () => {
    const { data, error } = await alice.from("areas").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    // Triage routes low-confidence captures here instead of failing them.
    expect(data!.map((a) => a.id)).toContain("unsorted");
    expect(data!.every((a) => a.owner_id === aliceId)).toBe(true);
  });

  it("cannot write to areas", async () => {
    const { error } = await alice
      .from("areas")
      .insert({ owner_id: aliceId, id: "injected", label: "x", classifier_hint: "x", colour: "#000" });
    expect(error).not.toBeNull();
  });

  it("reads its own commitments", async () => {
    const { data, error } = await alice
      .from("commitments")
      .select("*")
      .eq("id", aliceCommitmentId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("cross-user isolation", () => {
  it("does not leak another user's captures", async () => {
    const { data } = await bob.from("captures").select("*").eq("id", aliceCaptureId);
    expect(data).toEqual([]);
  });

  it("cannot update another user's capture", async () => {
    const { data } = await bob
      .from("captures")
      .update({ raw_text: "tampered" })
      .eq("id", aliceCaptureId)
      .select();
    // The update matches no visible row, so it silently affects nothing.
    expect(data).toEqual([]);

    const { data: intact } = await alice
      .from("captures")
      .select("raw_text")
      .eq("id", aliceCaptureId)
      .single();
    expect(intact!.raw_text).not.toBe("tampered");
  });

  it("cannot insert a capture owned by someone else", async () => {
    const { error } = await bob
      .from("captures")
      .insert({ user_id: aliceId, raw_text: "forged" });
    expect(error?.code).toBe("42501");
  });

  it("does not leak another user's areas", async () => {
    // P1-F0.5. Every classifier_hint is one or two sentences describing a real
    // part of the owner's life — the seed file is gitignored on exactly those
    // grounds, and until 0003 the application served them to anyone with a
    // session. This is the test that fails if the policy is ever reverted.
    const { data } = await bob.from("areas").select("*");
    expect(data!.map((a) => a.id)).not.toContain("alice-only");
    expect(data!.every((a) => a.owner_id === bobId)).toBe(true);
  });

  it("gives each account its own unsorted", async () => {
    // The alternative was a globally-readable row and a special case in the
    // policy. Duplicating it costs one row per account and no exception.
    const { data } = await bob.from("areas").select("*").eq("id", "unsorted").single();
    expect(data!.owner_id).toBe(bobId);
  });

  it("does not leak another user's commitments", async () => {
    const { data } = await bob.from("commitments").select("*").eq("id", aliceCommitmentId);
    expect(data).toEqual([]);
  });

  it("cannot complete another user's commitment", async () => {
    const { data } = await bob
      .from("commitments")
      .update({ status: "done" })
      .eq("id", aliceCommitmentId)
      .select();
    expect(data).toEqual([]);

    const { data: intact } = await alice
      .from("commitments")
      .select("status")
      .eq("id", aliceCommitmentId)
      .single();
    expect(intact!.status).toBe("open");
  });

  it("cannot delete a commitment, even its own", async () => {
    // A dropped commitment moves to status 'dropped'. There is no delete
    // policy, so the record of having decided against something survives.
    await alice.from("commitments").delete().eq("id", aliceCommitmentId);
    const { data } = await alice.from("commitments").select("id").eq("id", aliceCommitmentId);
    expect(data).toHaveLength(1);
  });

  it("cannot file a capture into another user's area", async () => {
    // The composite foreign key, not a policy: cross-tenant filing is refused
    // by the schema rather than by a check someone could forget to write.
    const { error } = await bob
      .from("captures")
      .insert({ user_id: bobId, raw_text: "wrong area", area_id: "alice-only" });
    expect(error).not.toBeNull();
  });

  it("keeps bob and alice distinct", () => {
    expect(bobId).not.toBe(aliceId);
  });
});

describe("retrieval", () => {
  it("finds a capture by its words", async () => {
    const { data, error } = await alice.rpc("retrieve_captures", {
      p_user_id: aliceId,
      p_query: "fixture",
      p_limit: 20,
    });
    expect(error).toBeNull();
    expect(data.map((c: { id: string }) => c.id)).toContain(aliceCaptureId);
  });

  it("finds a name the dictation garbled", async () => {
    // P1-F4's acceptance criterion, and the reason 0007 exists: at pg_trgm's
    // default threshold this returns nothing.
    const { data } = await alice.rpc("retrieve_captures", {
      p_user_id: aliceId,
      p_query: "Beaumnt",
      p_limit: 20,
    });
    expect(data.map((c: { id: string }) => c.id)).toContain(aliceNameCaptureId);
  });

  it("returns nothing when asked for another user's captures", async () => {
    // P1-F4.4. The predicate is what makes this correct when the Edge
    // Function calls it with the secret key and no RLS at all; RLS is what
    // makes a mistake in the predicate survivable from the browser. This
    // exercises both at once.
    const { data, error } = await bob.rpc("retrieve_captures", {
      p_user_id: aliceId,
      p_query: "fixture",
      p_limit: 20,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
