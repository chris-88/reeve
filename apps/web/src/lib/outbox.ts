import { get, set } from "idb-keyval";
import { supabase } from "./supabase";

/**
 * Local-first capture queue.
 *
 * A thought is fleeting and the network in a car or on a site is not reliable.
 * Saving therefore writes to IndexedDB and returns immediately; syncing to
 * Supabase happens afterwards and retries until it lands.
 *
 * Each item carries a client-generated id, so a retry after a lost response
 * inserts the same primary key rather than a duplicate row.
 */

const KEY = "reeve.outbox.v1";

export type PendingCapture = {
  id: string;
  raw_text: string;
  created_at: string;
  attempts: number;
  last_error?: string;
};

type Listener = (items: PendingCapture[]) => void;
const listeners = new Set<Listener>();
let flushing = false;
let flushAgain = false;

async function read(): Promise<PendingCapture[]> {
  return (await get<PendingCapture[]>(KEY)) ?? [];
}

async function write(items: PendingCapture[]): Promise<void> {
  await set(KEY, items);
  for (const fn of listeners) fn(items);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  void read().then(fn);
  return () => listeners.delete(fn);
}

export async function peek(): Promise<PendingCapture[]> {
  return read();
}

/** Queue a capture. Resolves as soon as it is durable locally. */
export async function enqueue(rawText: string): Promise<PendingCapture> {
  const item: PendingCapture = {
    id: crypto.randomUUID(),
    raw_text: rawText.trim(),
    created_at: new Date().toISOString(),
    attempts: 0,
  };
  await write([item, ...(await read())]);
  void flush();
  return item;
}

/**
 * Attempt to sync every queued capture. Safe to call concurrently.
 *
 * A concurrent call coalesces into one more pass rather than being dropped.
 * Returning early instead loses the capture that triggered it: the app fires a
 * flush on mount, and a capture saved while that is still in flight would sit
 * in IndexedDB until the next reconnect or foreground event.
 */
export async function flush(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return;
  }
  if (!navigator.onLine) return;
  flushing = true;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    for (const item of await read()) {
      const { error } = await supabase.from("captures").insert({
        id: item.id,
        user_id: user.id,
        raw_text: item.raw_text,
        created_at: item.created_at,
      });

      // 23505 is a unique violation: this row already landed on a previous
      // attempt whose response we never saw. That is success, not failure.
      const landed = !error || error.code === "23505";

      if (landed) {
        await write((await read()).filter((i) => i.id !== item.id));
        void triage(item.id);
      } else {
        await write(
          (await read()).map((i) =>
            i.id === item.id
              ? { ...i, attempts: i.attempts + 1, last_error: error.message }
              : i,
          ),
        );
      }
    }

    await sweepQueued();
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      void flush();
    }
  }
}

/**
 * Ask the Edge Function to triage a capture.
 *
 * Failures here are recoverable but must not be silent: an earlier version
 * swallowed them, and a CORS misconfiguration left captures sitting at
 * 'queued' indefinitely with nothing anywhere to say why.
 */
async function triage(captureId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("triage", {
      body: { capture_id: captureId },
    });
    if (error) throw error;
  } catch (err) {
    console.error("[reeve] triage failed for", captureId, err);
    // The row is safe in Supabase and sweepQueued() below will retry it.
  }
}

/**
 * Re-trigger triage for anything still sitting at 'queued'.
 *
 * The invocation is a separate step from the insert, so a capture can land in
 * the database and then never be picked up — a dropped request, a closed tab,
 * a bad deploy. Without this, such a row stays queued forever: the function's
 * own retry only covers failures *inside* a run that already started.
 */
async function sweepQueued(): Promise<void> {
  const { data, error } = await supabase
    .from("captures")
    .select("id")
    .eq("status", "queued")
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error || !data?.length) return;
  for (const row of data) await triage(row.id as string);
}

/** Retry syncing on reconnect and whenever the app comes back to the foreground. */
export function startOutboxWatcher(): () => void {
  const onOnline = () => void flush();
  const onVisible = () => {
    if (document.visibilityState === "visible") void flush();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void flush();
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
