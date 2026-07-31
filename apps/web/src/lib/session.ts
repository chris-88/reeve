import { supabase } from "@/lib/supabase";
import { purgeQueryCache } from "@/lib/query";
import { clearDraft } from "@/lib/draft";
import { peek } from "@/lib/outbox";

/**
 * F10: signing out, done in the one order that is safe.
 *
 * A session in a bad state used to be unrecoverable without developer tools,
 * and — now that F2 persists the query cache and areas are owner-scoped —
 * there was no way to hand the device to a second account for testing either.
 */

/** How many writes are queued and unsent — sign-out warns before leaving them. */
export async function pendingOutboxCount(): Promise<number> {
  return (await peek()).length;
}

/**
 * Clear, in order (F10.2): the persisted query cache, the draft, then the
 * Supabase session. The outbox is deliberately NOT cleared — an unsynced
 * capture belongs to the device and to the person who wrote it, not to the
 * session, and must survive to sync when the same user signs back in.
 */
export async function signOut(): Promise<void> {
  await purgeQueryCache();
  clearDraft();
  await supabase.auth.signOut();
}
