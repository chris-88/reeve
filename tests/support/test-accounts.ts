import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P1-F13: the whole definition of a test account, in one place.
 *
 * Reeve's suites run against the live Supabase project. Hardening F8.3 asked
 * for either a separate project or a clearly-scoped set of test users, was
 * marked done with neither, and the cost was the only irrecoverable data loss
 * this project has had — a migration derived ownership from row counts and
 * picked the test account, because the fixtures had quietly outgrown the real
 * data.
 *
 * "Scoped" was nominally true then. These helpers are what make it true: one
 * naming convention, one teardown, and one guard that fails loudly when
 * fixtures start accumulating again.
 */

/** The convention. An account is a test account if and only if it ends in this. */
export const TEST_DOMAIN = "@reeve.test";

export function isTestAccount(email: string | undefined | null): boolean {
  return !!email?.endsWith(TEST_DOMAIN);
}

/**
 * The point at which accumulation stops being noise and becomes the thing that
 * misled a migration. Deliberately far below the 24 rows it took to do damage,
 * and far above the handful a single suite holds mid-run.
 */
export const ACCUMULATION_LIMIT = 10;

/**
 * P1-F13.3: remove everything a suite created.
 *
 * Captures cascade to commitments, but `agent_runs` has its own `on delete
 * cascade` from captures and is deleted first anyway — a run belonging to a
 * capture that no longer exists is noise in the spend view P1-F5 will read.
 *
 * Uses the service key: there is deliberately no delete policy for the client
 * on captures or commitments, which is the correct production behaviour and
 * exactly why teardown cannot be a client concern.
 */
export async function purgeTestData(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from("agent_runs").delete().eq("user_id", userId);
  await admin.from("captures").delete().eq("user_id", userId);
}

/**
 * Retry a Supabase auth-admin call.
 *
 * The auth admin API returns an occasional transient 403 — `bad_jwt`,
 * complaining about a signing key id it verifies fine seconds later — observed
 * three times in a couple of dozen calls during this round. Every suite's
 * `beforeAll` depends on one of these, and `main` now requires the jobs they
 * run in, so an unretried call is a gate that blocks merges at random.
 *
 * Three attempts, short backoff. A genuine credential problem still fails.
 */
export async function retryAuth<T>(
  call: () => PromiseLike<{ data: T; error: { message: string } | null }>,
  options: {
    attempts?: number;
    /**
     * Errors that mean "already in the state you wanted". Creating a test user
     * that exists is success, not something to retry — and retrying it three
     * times would turn every run after the first into a slow one.
     */
    accept?: (error: { message: string }) => boolean;
  } = {},
): Promise<T> {
  const { attempts = 3, accept } = options;
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const { data, error } = await call();
    if (!error || accept?.(error)) return data;
    lastError = error;
  }
  throw new Error(`auth admin call failed after ${attempts} attempts: ${lastError?.message}`);
}

/** Every `@reeve.test` account, by id. */
export async function testAccountIds(admin: SupabaseClient): Promise<string[]> {
  const data = await retryAuth(() => admin.auth.admin.listUsers());
  return data.users.filter((u) => isTestAccount(u.email)).map((u) => u.id);
}

/**
 * P1-F13.5: fail when fixtures are piling up.
 *
 * Accumulation is the early, silent symptom of every failure in this class. It
 * was visible for weeks before it mattered and nobody was looking, so this
 * looks on every run.
 */
export async function assertNoAccumulation(
  admin: SupabaseClient,
  limit = ACCUMULATION_LIMIT,
): Promise<{ userId: string; captures: number }[]> {
  const offenders: { userId: string; captures: number }[] = [];
  for (const userId of await testAccountIds(admin)) {
    const { count } = await admin
      .from("captures")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) > limit) offenders.push({ userId, captures: count ?? 0 });
  }
  return offenders;
}
