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

/** Attempt to sync every queued capture. Safe to call concurrently. */
export async function flush(): Promise<void> {
  if (flushing || !navigator.onLine) return;
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
  } finally {
    flushing = false;
  }
}

/**
 * Kick off triage. Fire-and-forget: the row is already safe in Supabase, and
 * the inbox reflects its status over Realtime regardless of what happens here.
 */
async function triage(captureId: string): Promise<void> {
  try {
    await supabase.functions.invoke("triage", { body: { capture_id: captureId } });
  } catch {
    // Swallowed deliberately — see doc comment. Retry is handled server-side
    // via the attempts column, and a stuck row is visible in the inbox.
  }
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
