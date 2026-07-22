import { del, get, update } from "idb-keyval";
import type { CommitmentStatus } from "@reeve/shared";
import { supabase } from "./supabase";
import { report, trail } from "./observability";

/**
 * Local-first mutation queue.
 *
 * A thought is fleeting and the network in a car or on a site is not reliable.
 * Saving therefore writes to IndexedDB and returns immediately; syncing to
 * Supabase happens afterwards and retries until it lands.
 *
 * Each item carries a client-generated id, so a retry after a lost response
 * inserts the same primary key rather than a duplicate row. That is the part
 * that makes the whole thing safe.
 *
 * It began as a capture queue. P1-F2.3 requires the Due view's mutations to
 * travel the same road — a second sync mechanism would diverge from this one
 * on backoff, dead-lettering and atomicity, and the divergence would only show
 * up on a building site with no signal. So the item carries an `op` describing
 * what to send, and the machinery around it is unchanged.
 */

const KEY = "reeve.outbox.v2";

/**
 * Items queued before the Due view shipped. Captures still sitting here belong
 * to the device, not to the release that queued them, so they are migrated
 * rather than dropped.
 */
const LEGACY_KEY = "reeve.outbox.v1";

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

export type CaptureOp = {
  kind: "capture";
  raw_text: string;
  created_at: string;
};

/**
 * The subset of a commitment the user can change.
 *
 * `origin` is set to 'user' by every edit that touches the text or the date:
 * as with corrected_area_id, the divergence between what the model extracted
 * and what Chris meant is evidence about extraction quality. Completing or
 * dropping is not an edit of the extraction and leaves it alone.
 */
export type CommitmentPatch = {
  status?: CommitmentStatus;
  completed_at?: string | null;
  text?: string;
  due_text?: string | null;
  due_at?: string | null;
  origin?: "user";
};

export type CommitmentOp = {
  kind: "commitment";
  commitmentId: string;
  patch: CommitmentPatch;
};

export type PendingOp = {
  id: string;
  /**
   * Recorded at enqueue rather than looked up at flush time. Looking it up
   * needed a network round-trip issued precisely when the network is the
   * problem, and it misattributed a capture queued by one user and flushed
   * after a different sign-in.
   */
  userId: string;
  attempts: number;
  /** Epoch ms. Not eligible for another attempt before this. */
  nextAttemptAt: number;
  lastError?: string;
  /** Retries exhausted. Kept forever; only an explicit user retry revives it. */
  deadLettered: boolean;
  op: CaptureOp | CommitmentOp;
};

type Listener = (items: PendingOp[]) => void;
const listeners = new Set<Listener>();

let flushing = false;
let flushStartedAt = 0;
let flushAgain = false;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

type LegacyItem = {
  id: string;
  userId: string;
  raw_text: string;
  created_at: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  deadLettered: boolean;
};

let migration: Promise<void> | null = null;

/**
 * Carry v1 items across, once, before anything reads the queue.
 *
 * The latch is a module-level promise rather than a flag because read() and
 * mutate() are both called concurrently on mount; two migrations racing would
 * double every unsent capture.
 */
function ensureMigrated(): Promise<void> {
  return (migration ??= (async () => {
    try {
      const legacy = await get<LegacyItem[]>(LEGACY_KEY);
      if (legacy?.length) {
        await update<PendingOp[]>(KEY, (current) => {
          const known = new Set((current ?? []).map((i) => i.id));
          const carried = legacy
            .filter((i) => !known.has(i.id))
            .map<PendingOp>((i) => ({
              id: i.id,
              userId: i.userId,
              attempts: i.attempts,
              nextAttemptAt: i.nextAttemptAt,
              lastError: i.lastError,
              deadLettered: i.deadLettered,
              op: { kind: "capture", raw_text: i.raw_text, created_at: i.created_at },
            }));
          return [...(current ?? []), ...carried];
        });
      }
      await del(LEGACY_KEY);
    } catch (err) {
      // Losing the migration must not take the queue down with it: a v2 item
      // saved right now matters more than a v1 item we can retry next launch.
      console.error("[reeve] outbox migration failed", err);
    }
  })());
}

async function read(): Promise<PendingOp[]> {
  await ensureMigrated();
  return (await get<PendingOp[]>(KEY)) ?? [];
}

/**
 * Atomic read-modify-write.
 *
 * idb-keyval's update() runs the whole cycle inside one IndexedDB transaction.
 * Doing it as a separate get and set let a capture saved during a flush be
 * overwritten by the flush's own write.
 */
async function mutate(fn: (items: PendingOp[]) => PendingOp[]): Promise<PendingOp[]> {
  await ensureMigrated();
  let next: PendingOp[] = [];
  await update<PendingOp[]>(KEY, (current) => {
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

export async function peek(): Promise<PendingOp[]> {
  return read();
}

/** Only the capture ops. The capture screen has nothing to say about the rest. */
export function captureOps(items: readonly PendingOp[]): (PendingOp & { op: CaptureOp })[] {
  return items.filter((i): i is PendingOp & { op: CaptureOp } => i.op.kind === "capture");
}

/**
 * Every queued change to a commitment, merged, most recent last.
 *
 * The Due view lays this over the server rows so an unsynced change survives a
 * cold reload rather than appearing to have been forgotten.
 */
export function pendingPatch(
  items: readonly PendingOp[],
  commitmentId: string,
): CommitmentPatch | undefined {
  let merged: CommitmentPatch | undefined;
  for (const item of items) {
    if (item.op.kind !== "commitment" || item.op.commitmentId !== commitmentId) continue;
    merged = { ...merged, ...item.op.patch };
  }
  return merged;
}

export function backoffFor(attempts: number): number {
  const base = BACKOFF_MS[attempts] ?? MAX_BACKOFF_MS;
  // Jitter stops a batch of failures from retrying in lockstep.
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** Queue a capture. Resolves once it is durable locally, not when it syncs. */
export async function enqueue(rawText: string, userId: string): Promise<PendingOp> {
  const item: PendingOp = {
    id: crypto.randomUUID(),
    userId,
    attempts: 0,
    nextAttemptAt: 0,
    deadLettered: false,
    op: { kind: "capture", raw_text: rawText.trim(), created_at: new Date().toISOString() },
  };
  await mutate((items) => [item, ...items]);
  trail("capture enqueued", { id: item.id });
  void flush();
  return item;
}

/**
 * Queue a change to a commitment.
 *
 * Keyed on the commitment rather than on the action, so marking something done
 * and then dropping it queues one merged write instead of two that race. The
 * merge also revives a dead-lettered item: the user touching it again is the
 * same deliberate signal `retryItem` acts on.
 */
export async function enqueueCommitmentPatch(
  commitmentId: string,
  userId: string,
  patch: CommitmentPatch,
): Promise<void> {
  const id = `commitment:${commitmentId}`;
  await mutate((items) => {
    const existing = items.find((i) => i.id === id);
    const merged: PendingOp = {
      id,
      userId,
      attempts: 0,
      nextAttemptAt: 0,
      deadLettered: false,
      op: {
        kind: "commitment",
        commitmentId,
        patch: {
          ...(existing?.op.kind === "commitment" ? existing.op.patch : {}),
          ...patch,
        },
      },
    };
    return existing ? items.map((i) => (i.id === id ? merged : i)) : [...items, merged];
  });
  void flush();
}

/**
 * Make everything eligible again, immediately.
 *
 * Backoff exists so a failing server is not hammered. It is the wrong
 * behaviour when the failures were caused by having no signal: half an hour in
 * a basement widens every item's next attempt to five minutes, so the moment
 * the phone reconnects it does nothing, and the user watches a queue that
 * looks stuck. Connectivity returning is new information, and it should be
 * acted on rather than waited out.
 *
 * Dead-lettered items are left alone. Ten consecutive failures is not a
 * connectivity story, and reviving them here would make the dead-letter state
 * unreachable.
 */
export async function clearBackoff(): Promise<void> {
  await mutate((items) =>
    items.map((i) => (i.deadLettered ? i : { ...i, nextAttemptAt: 0 })),
  );
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
 * Attempt to sync every eligible item.
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

/** null on success; a message on failure. */
async function send(item: PendingOp): Promise<string | null> {
  if (item.op.kind === "capture") {
    const { error } = await supabase
      .from("captures")
      .insert({
        id: item.id,
        user_id: item.userId,
        raw_text: item.op.raw_text,
        created_at: item.op.created_at,
      })
      .abortSignal(timeout());

    // 23505 is a unique violation: this row already landed on an earlier
    // attempt whose response we never saw. That is success, not failure.
    if (!error || error.code === "23505") return null;
    return error.message;
  }

  // An update is idempotent by construction — replaying "status = done" is a
  // no-op — so there is no equivalent of the 23505 case to special-case here.
  // user_id is filtered as well as the id: RLS enforces it, but a client that
  // asks only for what it owns cannot be the thing that discovers RLS is off.
  const { error } = await supabase
    .from("commitments")
    .update(item.op.patch)
    .eq("id", item.op.commitmentId)
    .eq("user_id", item.userId)
    .abortSignal(timeout());

  return error ? error.message : null;
}

async function run(): Promise<void> {
  try {
    const now = Date.now();
    const due = (await read()).filter((i) => !i.deadLettered && i.nextAttemptAt <= now);
    if (due.length > 0) trail("outbox flush", { due: due.length });

    for (const item of due) {
      try {
        const failure = await send(item);
        if (failure === null) {
          await mutate((items) => items.filter((i) => i.id !== item.id));
          trail("outbox item synced", { id: item.id, kind: item.op.kind });
          if (item.op.kind === "capture") void triage(item.id);
          continue;
        }
        await recordFailure(item.id, failure);
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
      if (attempts >= DEAD_LETTER_AFTER) {
        // The one outbox event that means a capture is going nowhere without
        // the user intervening. If anything here deserves an alert, it is this.
        trail("outbox item dead-lettered", { id: i.id, kind: i.op.kind, attempts });
        report(new Error("outbox item dead-lettered"), { id: i.id, kind: i.op.kind });
      }
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
    report(err, { capture_id: captureId, step: "invoke" });
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
  const onOnline = () => void clearBackoff().then(flush);
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
