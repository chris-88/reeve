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
  // captures cascade to commitments and change_request_captures, but not to
  // change_requests, briefs or push_subscriptions — nothing deletes a capture
  // in production, so those tables have no cascade from it. A test account has
  // to clear them itself.
  await admin.from("change_requests").delete().eq("user_id", userId);
  await admin.from("briefs").delete().eq("user_id", userId);
  await admin.from("push_subscriptions").delete().eq("user_id", userId);
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
type AuthResult<T> = { data: T; error: { message: string } | null };

/**
 * Per-attempt timeout, in ms.
 *
 * The Supabase client has no request timeout, so a transient API latency spike
 * — which is what took a CI hook past even a two-minute budget — hangs the
 * call indefinitely rather than failing it. Racing each attempt against a
 * timeout turns a hang into a retryable error, so three attempts finish in
 * bounded time instead of consuming the whole hook.
 */
const PER_ATTEMPT_MS = 20_000;

function withTimeout<T>(p: PromiseLike<AuthResult<T>>, ms: number): Promise<AuthResult<T>> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<AuthResult<T>>((resolve) =>
      setTimeout(
        () => resolve({ data: null as T, error: { message: `auth call timed out after ${ms}ms` } }),
        ms,
      ),
    ),
  ]);
}

export async function retryAuth<T>(
  call: () => PromiseLike<AuthResult<T>>,
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
    const { data, error } = await withTimeout(call(), PER_ATTEMPT_MS);
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
 * A test account's id, without the auth **admin** API.
 *
 * Three consecutive CI failures traced to GoTrue's admin endpoints
 * (`createUser`, `listUsers`) stalling under load — and a `beforeAll` that made
 * two retried admin calls could reach the hook budget even with per-attempt
 * timeouts. A normal password sign-in is a different, far more reliable
 * endpoint, and it returns the user id directly. The admin API is touched only
 * to create the account on a first-ever run, which in practice never happens
 * because the account persists between runs.
 */
export async function resolveTestUserId(
  admin: SupabaseClient,
  config: { url: string; anonKey: string; email: string; password: string },
): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
  const signIn = () => anon.auth.signInWithPassword({ email: config.email, password: config.password });

  const first = await withTimeout(signIn(), PER_ATTEMPT_MS);
  if (!first.error && first.data?.user) return first.data.user.id;

  // First-ever run, or the account was removed: create it, then sign in.
  await retryAuth(
    () =>
      admin.auth.admin.createUser({
        email: config.email,
        password: config.password,
        email_confirm: true,
      }),
    { accept: (e) => /already|registered/i.test(e.message) },
  );
  const created = await retryAuth(signIn);
  return created.user!.id;
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
