import { beforeAll, describe, expect, it } from "vitest";
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

  const { data, error } = await alice
    .from("captures")
    .insert({ user_id: aliceId, raw_text: `rls fixture ${randomUUID()}` })
    .select()
    .single();
  if (error) throw error;
  aliceCaptureId = data.id;
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
});

describe("signed-in access", () => {
  it("reads its own captures", async () => {
    const { data, error } = await alice.from("captures").select("*").eq("id", aliceCaptureId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("reads areas", async () => {
    const { data, error } = await alice.from("areas").select("*");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    // Triage routes low-confidence captures here instead of failing them.
    expect(data!.map((a) => a.id)).toContain("unsorted");
  });

  it("cannot write to areas", async () => {
    const { error } = await alice
      .from("areas")
      .insert({ id: "injected", label: "x", classifier_hint: "x", colour: "#000" });
    expect(error).not.toBeNull();
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

  it("keeps bob and alice distinct", () => {
    expect(bobId).not.toBe(aliceId);
  });
});
