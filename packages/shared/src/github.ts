/**
 * The two pure, security-critical pieces of the GitHub webhook (P1-F10).
 *
 * Shared so they can be unit-tested away from the Edge Function runtime: the
 * signature check is the whole defence of the one public endpoint the project
 * exposes, and the issue-reference parser is the link between a merged pull
 * request and the change request it closes. Both are where the bugs would be.
 */

/**
 * Issue numbers a pull request's text closes.
 *
 * GitHub's own closing keywords first (close/fix/resolve and their
 * inflections), then a fallback to any bare `#123`. Convention-dependent — the
 * honest limit is a PR that links its issue only through GitHub's UI with no
 * reference in the text — but the handoff writes "Closes #N", so in practice
 * this resolves. Deduplicated, because "Fixes #5 ... see #5" is one issue.
 */
export function referencedIssues(text: string): number[] {
  const found = new Set<number>();
  const keyword = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const bare = /(?:^|\s)#(\d+)\b/g;
  for (const re of [keyword, bare]) {
    for (const m of text.matchAll(re)) found.add(Number(m[1]));
  }
  return [...found];
}

/** Web Crypto is a WinterCG global — declared in globals.d.ts for this package. */

/**
 * Verify GitHub's `X-Hub-Signature-256` over the raw body.
 *
 * HMAC-SHA256 with the webhook secret, compared to the `sha256=` header in
 * length-independent constant time so a mismatch cannot be timed. Async
 * because Web Crypto is; returns false for a missing or malformed header
 * rather than throwing, so the caller's reject path is a plain boolean.
 */
export async function verifyGithubSignature(
  secret: string,
  body: string,
  header: string | null | undefined,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const actual = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
