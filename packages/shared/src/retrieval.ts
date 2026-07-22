import type { Capture } from "./schemas.ts";

/**
 * Cross-capture retrieval — the single entry point.
 *
 * P1-F4.3 asks for one documented function used by every downstream consumer,
 * and the reason is worth restating at the call site: two places assembling
 * context two different ways is how agent quality becomes unexplainable. When
 * a brief misses something, the question has to be "did retrieval find it?"
 * with one answer, not two.
 *
 * The work happens in `retrieve_captures` in migration 0006. This is a typed
 * wrapper over the RPC, not a second implementation.
 */

/** Structurally typed rather than importing supabase-js — this package has no client dependency, and it is consumed from Deno as well as the browser. */
type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type RetrieveOptions = {
  /**
   * Whose captures. Required, and passed to the query rather than left to RLS:
   * the Edge Function's client holds the secret key and has no RLS.
   */
  userId: string;
  /**
   * Free text. Matched by full-text search over raw_text, title and summary,
   * and by trigram word similarity over raw_text so a name that dictation
   * garbled still resolves. Omit to get the most recent captures.
   */
  query?: string | null;
  /** Capped at 100 server-side. */
  limit?: number;
};

/** Most relevant first, then most recent. */
export async function retrieveCaptures(
  db: RpcClient,
  { userId, query = null, limit = 20 }: RetrieveOptions,
): Promise<Capture[]> {
  const { data, error } = await db.rpc("retrieve_captures", {
    p_user_id: userId,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw new Error(`retrieve_captures: ${error.message}`);
  return (data ?? []) as Capture[];
}
