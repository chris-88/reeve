/**
 * Identity and date handling for commitment rows.
 *
 * Shared because three things have to agree on them: the triage Edge Function
 * (Deno), the backfill script (Node) and the tests. Two implementations of a
 * fingerprint is two implementations of "is this the same commitment", which
 * is the whole basis of P1-F1.3's idempotency.
 */

/**
 * Web Crypto and TextEncoder are WinterCG globals — present in the browser,
 * in Deno and in Node — but this package's `lib` is deliberately ES2022 with
 * no DOM, because adding DOM here would put `window` and `document` in scope
 * for code that also runs in an Edge Function. Declaring exactly what is used
 * is narrower than the lib that would supply it.
 */
declare const crypto: {
  subtle: { digest(algorithm: string, data: ArrayBufferView): Promise<ArrayBuffer> };
};
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };

/** ISO 8601 date, no time. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Text reduced to what makes a commitment the same commitment.
 *
 * Re-triage produces prose that varies in casing, spacing and whether it ends
 * in a full stop. None of that is a different obligation.
 */
export function normaliseCommitmentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?\s]+$/, "")
    .trim();
}

/**
 * Stable identity for a commitment: its capture plus its normalised text.
 *
 * Scoped by capture rather than by user, so re-running triage on one capture
 * cannot collide with a genuinely separate promise made in another. Web Crypto
 * rather than node:crypto — this runs in Deno as well.
 */
export async function commitmentFingerprint(captureId: string, text: string): Promise<string> {
  const input = `${captureId}|${normaliseCommitmentText(text)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A resolved date as a timestamp.
 *
 * Midnight UTC, deliberately. Ireland is UTC+0 or UTC+1 and never behind, so
 * midnight UTC always falls on the intended day in local time — which is the
 * only property the Due view's day bucketing needs. Choosing a local midnight
 * instead would mean carrying a timezone database to gain nothing.
 *
 * Returns null for anything that is not a plain date, including the model
 * returning a phrase it failed to resolve. An unresolved date is a valid
 * commitment (P1-F1.5), not a reason to drop one.
 */
export function dueAtFromDate(date: string | null | undefined): string | null {
  if (!date || !DATE_ONLY.test(date.trim())) return null;
  const iso = `${date.trim()}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
