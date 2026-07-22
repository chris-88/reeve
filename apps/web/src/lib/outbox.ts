import { get, update } from "idb-keyval";
import { supabase } from "./supabase";

/**
 * Local-first capture queue.
 *
 * A thought is fleeting and the network in a car or on a site is not reliable.
 * Saving therefore writes to IndexedDB and returns immediately; syncing to
 * Supabase happens afterwards and retries until it lands.
 *
 * Each item carries a client-generated id, so a retry after a lost response
 * inserts the same primary key rather than a duplicate row. That is the part
 * that makes the whole thing safe.
 */

const KEY = "reeve.outbox.v1";

/** Attempts before an item stops retrying by itself and waits for the user. */
const DEAD_LETTER_AFTER = 10;

/**
 * Backoff between attempts. A poison item must not re-fire on every foreground
 * event forever, and a transient outage should not be hammered.
 */
const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000];
const MAX_BACKOFF_MS = 5 * 60_000;

/** No single request may hold the queue for longer than this. */
const REQUEST_TIMEOUT_MS = 15_000;

/** If a flush somehow outlives this, the latch is forced open. */
const FLUSH_CEILING_MS = 90_000;

export type PendingCapture = {
  id: string;
  /**
   * Recorded at enqueue rather than looked up at flush time. Looking it up
   * needed a network round-trip issued precisely when the network is the
   * problem, and it misattributed a capture queued by one user and flushed
   * after a different sign-in.
   */
  userId: string;
  raw_text: string;
  created_at: string;
  attempts: number;
  /** Epoch ms. Not eligible for another attempt before this. */
  nextAttemptAt: number;
  lastError?: string;
  /** Retries exhausted. Kept forever; only an explicit user retry revives it. */
  deadLettered: boolean;
};

type Listener = (items: PendingCapture[]) => void;
const listeners = new Set<Listener>();

let flushing = false;
let flushStartedAt = 0;
let flushAgain = false;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function read(): Promise<PendingCapture[]> {
  return (await get<PendingCapture[]>(KEY)) ?? [];
}

/**
 * Atomic read-modify-write.
 *
 * idb-keyval's update() runs the whole cycle inside one IndexedDB transaction.
 * Doing it as a separate get and set let a capture saved during a flush be
 * overwritten by the flush's own write.
 */
async function mutate(
  fn: (items: PendingCapture[]) => PendingCapture[],
): Promise<PendingCapture[]> {
  let next: PendingCapture[] = [];
  await update<PendingCapture[]>(KEY, (current) => {
    next = fn(current ?? []);
    return next;
  });
  for (const listener of listeners) listener(next);
  return next;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  void read().then(fn);
  return () => listeners.delete(fn);
}

export async function peek(): Promise<PendingCapture[]> {
  return read();
}

export function backoffFor(attempts: number): number {
  const base = BACKOFF_MS[attempts] ?? MAX_BACKOFF_MS;
  // Jitter stops a batch of failures from retrying in lockstep.
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** Queue a capture. Resolves once it is durable locally, not when it syncs. */
export async function enqueue(rawText: string, userId: string): Promise<PendingCapture> {
  const item: PendingCapture = {
    id: crypto.randomUUID(),
    userId,
    raw_text: rawText.trim(),
    created_at: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    deadLettered: false,
  };
  await mutate((items) => [item, ...items]);
  void flush();
  return item;
}

/** Revive a dead-lettered item. Only ever called by an explicit user action. */
export async function retryItem(id: string): Promise<void> {
  await mutate((items) =>
    items.map((i) =>
      i.id === id ? { ...i, attempts: 0, nextAttemptAt: 0, deadLettered: false } : i,
    ),
  );
  void flush();
}

function timeout(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

/**
 * Attempt to sync every eligible capture.
 *
 * Concurrent calls coalesce into one more pass rather than being dropped:
 * returning early would lose the capture that triggered it, since the app
 * fires a flush on mount.
 */
export function flush(): Promise<void> {
  if (flushing) {
    // A hung request would otherwise hold this latch forever, and because it
    // is only cleared in `finally`, no later flush would ever run.
    if (Date.now() - flushStartedAt > FLUSH_CEILING_MS) {
      console.warn("[reeve] flush exceeded its ceiling; forcing the latch open");
      flushing = false;
    } else {
      flushAgain = true;
      // Return the run in progress rather than a resolved promise, so that
      // awaiting flush() always means "the queue has been worked", not
      // "someone else is working it".
      return inFlight ?? Promise.resolve();
    }
  }

  // navigator.onLine is deliberately not consulted. It reports true behind a
  // captive portal and false during some VPN transitions, so as a gate it
  // blocks syncs that would have worked. A failed insert is handled anyway.
  flushing = true;
  flushStartedAt = Date.now();
  inFlight = run();
  return inFlight;
}

async function run(): Promise<void> {
  try {
    const now = Date.now();
    const due = (await read()).filter((i) => !i.deadLettered && i.nextAttemptAt <= now);

    for (const item of due) {
      try {
        const { error } = await supabase
          .from("captures")
          .insert({
            id: item.id,
            user_id: item.userId,
            raw_text: item.raw_text,
            created_at: item.created_at,
          })
          .abortSignal(timeout());

        // 23505 is a unique violation: this row already landed on an earlier
        // attempt whose response we never saw. That is success, not failure.
        if (!error || error.code === "23505") {
          await mutate((items) => items.filter((i) => i.id !== item.id));
          void triage(item.id);
          continue;
        }
        await recordFailure(item.id, error.message);
      } catch (err) {
        await recordFailure(item.id, err instanceof Error ? err.message : String(err));
      }
    }

    await sweepQueued();
  } finally {
    flushing = false;
    inFlight = null;
    if (flushAgain) {
      flushAgain = false;
      await flush();
    }
  }
}

async function recordFailure(id: string, message: string): Promise<void> {
  await mutate((items) =>
    items.map((i) => {
      if (i.id !== id) return i;
      const attempts = i.attempts + 1;
      return {
        ...i,
        attempts,
        lastError: message,
        // Never deleted, never silently dropped — it waits for the user.
        deadLettered: attempts >= DEAD_LETTER_AFTER,
        nextAttemptAt: Date.now() + backoffFor(attempts),
      };
    }),
  );
}

/**
 * Ask the Edge Function to triage a capture.
 *
 * Failures are logged rather than swallowed: an earlier version hid a CORS
 * misconfiguration that left every capture sitting at 'queued' indefinitely.
 */
async function triage(captureId: string): Promise<void> {
  try {
    const invoke = supabase.functions.invoke("triage", { body: { capture_id: captureId } });
    const { error } = await Promise.race([
      invoke,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("triage invoke timed out")), REQUEST_TIMEOUT_MS),
      ),
    ]);
    if (error) throw error;
  } catch (err) {
    console.error("[reeve] triage failed for", captureId, err);
    // Recoverable: sweepQueued below and the server-side cron both retry.
  }
}

/**
 * Re-trigger triage for rows still sitting at 'queued'.
 *
 * Invoking is a separate step from inserting, so a capture can land in the
 * database and never be picked up. The server-side cron sweeper is the durable
 * backstop; this closes the gap faster while the app is open.
 */
async function sweepQueued(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("captures")
      .select("id")
      .eq("status", "queued")
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(20)
      .abortSignal(timeout());
    if (error || !data?.length) return;
    for (const row of data) await triage(row.id as string);
  } catch (err) {
    console.warn("[reeve] sweep failed", err);
  }
}

/**
 * Retry on reconnect, on foreground, and on a timer.
 *
 * The `online` event alone misses an app left open on a desktop while
 * connectivity returns without firing one.
 */
export function startOutboxWatcher(): () => void {
  const onOnline = () => void flush();
  const onVisible = () => {
    if (document.visibilityState === "visible") void flush();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void flush();
  }, 60_000);
  void flush();

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
