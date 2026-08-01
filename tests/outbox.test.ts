import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The outbox is the one module where a mock is the right tool: the behaviour
 * under test is the client's own state machine — idempotent replay, backoff,
 * dead-lettering, atomicity — not anything Supabase does.
 */

type Result = { error: { code?: string; message: string } | null };

const insert = vi.fn<(row?: unknown) => Promise<Result>>();
const patch = vi.fn<() => Promise<Result>>();
const invoke = vi.fn(async () => ({ data: null, error: null }));
/** (bucket, path, blob, options) — the storage call an attached image makes. */
const upload = vi.fn<(...args: unknown[]) => Promise<Result>>();

vi.mock("../apps/web/src/lib/supabase", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, blob: unknown, options: unknown) =>
          upload(bucket, path, blob, options),
      }),
    },
    from: (table: string) => ({
      insert: (row: unknown) => ({ abortSignal: () => insert(row) }),
      update: () => ({ eq: () => ({ eq: () => ({ abortSignal: () => patch() }) }) }),
      select: () => ({
        eq: () => ({
          lt: () => ({
            order: () => ({
              limit: () => ({
                abortSignal: async () => ({ data: [], error: null, table }),
              }),
            }),
          }),
        }),
      }),
    }),
    functions: { invoke },
  },
}));

const OUTBOX = await import("../apps/web/src/lib/outbox");
const { backoffFor, captureOps, enqueue, flush, peek, pendingPatch, retryItem } = OUTBOX;
const { clear, update } = await import("idb-keyval");

const USER = "11111111-1111-1111-1111-111111111111";
const KEY = "reeve.outbox.v2";

beforeEach(async () => {
  await clear();
  insert.mockReset();
  patch.mockReset();
  patch.mockResolvedValue({ error: null });
  invoke.mockReset();
  invoke.mockResolvedValue({ data: null, error: null });
  upload.mockReset();
  upload.mockResolvedValue({ error: null });
});

describe("enqueue", () => {
  it("is durable before it resolves", async () => {
    insert.mockResolvedValue({ error: { message: "offline" } });
    const item = await enqueue("a thought", USER);
    const queued = await peek();
    expect(queued.map((i) => i.id)).toContain(item.id);
  });

  it("records the user at enqueue time, not at flush time", async () => {
    insert.mockResolvedValue({ error: { message: "offline" } });
    await enqueue("a thought", USER);
    expect((await peek())[0]!.userId).toBe(USER);
  });
});

describe("idempotent replay", () => {
  it("treats a unique violation as success", async () => {
    // The row landed on an earlier attempt whose response we never saw.
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    await enqueue("already landed", USER);
    await flush();
    expect(await peek()).toHaveLength(0);
  });

  it("keeps the item when the insert genuinely fails", async () => {
    insert.mockResolvedValue({ error: { code: "08006", message: "connection failure" } });
    await enqueue("did not land", USER);
    await flush();
    expect(await peek()).toHaveLength(1);
  });
});

describe("backoff", () => {
  it("widens with each attempt", () => {
    // Jittered, so compare bands rather than exact values.
    expect(backoffFor(0)).toBeLessThan(backoffFor(3));
    expect(backoffFor(3)).toBeLessThan(backoffFor(9));
  });

  it("is capped", () => {
    expect(backoffFor(50)).toBeLessThanOrEqual(5 * 60_000 * 1.25);
  });

  it("is cleared when connectivity returns", async () => {
    // Found by the P1-F2 offline end-to-end test, which sat at "open" for the
    // full sixty seconds after reconnecting. Every failed flush while offline
    // widens the wait, so a long enough outage pushes the next attempt five
    // minutes out — and the queue then does nothing at the exact moment it
    // finally could. Backoff is for a failing server, not for a dead radio.
    insert.mockResolvedValue({ error: { message: "offline" } });
    await enqueue("written in a basement", USER);
    await flush();
    expect((await peek())[0]!.nextAttemptAt).toBeGreaterThan(Date.now());

    await OUTBOX.clearBackoff();
    expect((await peek())[0]!.nextAttemptAt).toBe(0);

    insert.mockResolvedValue({ error: null });
    await flush();
    expect(await peek()).toHaveLength(0);
  });

  it("does not revive a dead-lettered item", async () => {
    // Ten consecutive failures is not a connectivity story, and clearing it
    // here would make the dead-letter state unreachable.
    insert.mockResolvedValue({ error: { message: "poison" } });
    await enqueue("poison", USER);
    // Settle the flush enqueue() fires, or its recordFailure lands after the
    // update below and overwrites it.
    await flush();
    await update<Array<Record<string, unknown>>>(KEY, (items) =>
      (items ?? []).map((x) => ({ ...x, deadLettered: true, nextAttemptAt: 9_999_999_999_999 })),
    );

    await OUTBOX.clearBackoff();
    expect((await peek())[0]!.nextAttemptAt).toBe(9_999_999_999_999);
    expect((await peek())[0]!.deadLettered).toBe(true);
  });

  it("holds an item back until it is due", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    await enqueue("failing", USER);
    await flush();
    expect(insert).toHaveBeenCalledTimes(1);

    // Not yet due — a second flush must not re-fire it.
    await flush();
    expect(insert).toHaveBeenCalledTimes(1);
    expect((await peek())[0]!.nextAttemptAt).toBeGreaterThan(Date.now());
  });
});

describe("dead-lettering", () => {
  it("stops retrying after the ceiling but never deletes", async () => {
    insert.mockResolvedValue({ error: { message: "poison" } });
    await enqueue("poison item", USER);

    // Drive it past the ceiling, clearing the backoff each time.
    for (let i = 0; i < 12; i++) {
      await update<Array<{ nextAttemptAt: number }>>(KEY, (items) =>
        (items ?? []).map((x) => ({ ...x, nextAttemptAt: 0 })),
      );
      await flush();
    }

    const [item] = await peek();
    expect(item, "a dead-lettered item is never dropped").toBeDefined();
    expect(item!.deadLettered).toBe(true);

    // Dead items are skipped entirely.
    const before = insert.mock.calls.length;
    await flush();
    expect(insert).toHaveBeenCalledTimes(before);
  });

  it("an explicit retry revives it", async () => {
    insert.mockResolvedValue({ error: { message: "poison" } });
    const item = await enqueue("poison item", USER);
    await update<Array<Record<string, unknown>>>(KEY, (items) =>
      (items ?? []).map((x) => ({ ...x, deadLettered: true, attempts: 10 })),
    );

    insert.mockResolvedValue({ error: null });
    await retryItem(item.id);
    await flush();
    expect(await peek()).toHaveLength(0);
  });
});

describe("concurrency", () => {
  it("does not lose a capture enqueued during a flush", async () => {
    // The failure this guards: a non-atomic read-modify-write in flush
    // overwriting a capture saved while it was in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    insert.mockImplementation(async () => {
      await gate;
      return { error: null };
    });

    await enqueue("first", USER);
    const inFlight = flush();
    const second = await enqueue("second", USER);
    release();
    await inFlight;

    const ids = (await peek()).map((i) => i.id);
    const landed = insert.mock.calls.length;
    expect(ids.includes(second.id) || landed >= 2, "the second capture survived").toBe(true);
  });
});

describe("commitment ops", () => {
  const COMMITMENT = "22222222-2222-2222-2222-222222222222";

  it("syncs a patch and clears it", async () => {
    await OUTBOX.enqueueCommitmentPatch(COMMITMENT, USER, { status: "done" });
    await flush();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(await peek()).toHaveLength(0);
  });

  it("survives a failure and stays queued", async () => {
    patch.mockResolvedValue({ error: { message: "offline" } });
    await OUTBOX.enqueueCommitmentPatch(COMMITMENT, USER, { status: "done" });
    await flush();
    expect(await peek()).toHaveLength(1);
    // The optimistic overlay reads from the queue, so an unsynced change is
    // still the thing the Due view shows after a cold reload.
    expect(pendingPatch(await peek(), COMMITMENT)).toEqual({ status: "done" });
  });

  it("merges two changes to the same commitment into one write", async () => {
    // Marking done then dropping must not queue two updates that race.
    patch.mockResolvedValue({ error: { message: "offline" } });
    await OUTBOX.enqueueCommitmentPatch(COMMITMENT, USER, { status: "done", completed_at: "x" });
    await OUTBOX.enqueueCommitmentPatch(COMMITMENT, USER, { status: "dropped" });

    const queued = await peek();
    expect(queued).toHaveLength(1);
    expect(pendingPatch(queued, COMMITMENT)).toEqual({ status: "dropped", completed_at: "x" });
  });

  it("does not appear on the capture screen's queue", async () => {
    patch.mockResolvedValue({ error: { message: "offline" } });
    insert.mockResolvedValue({ error: { message: "offline" } });
    await enqueue("a thought", USER);
    await OUTBOX.enqueueCommitmentPatch(COMMITMENT, USER, { status: "done" });
    expect(captureOps(await peek())).toHaveLength(1);
  });
});

describe("an attached image", () => {
  const image = () => ({
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    mime: "image/png" as const,
    bytes: 3,
  });

  it("is uploaded before the row is inserted", async () => {
    // Order, not merely both: a row whose image_path points at bytes that are
    // not there renders as a broken attachment, which the user cannot tell
    // apart from having lost the screenshot.
    const order: string[] = [];
    upload.mockImplementation(async () => {
      order.push("upload");
      return { error: null };
    });
    insert.mockImplementation(async () => {
      order.push("insert");
      return { error: null };
    });

    await enqueue("look at this", USER, image());
    await flush();
    expect(order).toEqual(["upload", "insert"]);
  });

  it("puts the object in the owner's folder, named after the capture", async () => {
    insert.mockResolvedValue({ error: null });
    const item = await enqueue("look at this", USER, image());
    await flush();

    const [bucket, path, , options] = upload.mock.calls[0]!;
    expect(bucket).toBe("capture-images");
    expect(path).toBe(`${USER}/${item.id}.png`);
    // Upsert, because the key is derived: a retry after a lost response must
    // overwrite the same object rather than fail on "already exists".
    expect(options).toMatchObject({ upsert: true, contentType: "image/png" });
  });

  it("points the row at what it uploaded", async () => {
    insert.mockResolvedValue({ error: null });
    const item = await enqueue("look at this", USER, image());
    await flush();
    expect(insert.mock.calls[0]![0]).toMatchObject({
      image_path: `${USER}/${item.id}.png`,
      image_mime: "image/png",
      image_bytes: 3,
    });
  });

  it("keeps the whole capture queued when the upload fails", async () => {
    // The text must not land without the picture: a capture that syncs half of
    // itself has silently dropped the context it was written for.
    upload.mockResolvedValue({ error: { message: "storage unreachable" } });
    insert.mockResolvedValue({ error: null });
    await enqueue("look at this", USER, image());
    await flush();

    expect(insert).not.toHaveBeenCalled();
    const [queued] = await peek();
    expect(queued).toBeDefined();
    expect(queued!.op.kind === "capture" && queued!.op.image).toBeTruthy();
  });

  it("leaves a capture without one alone", async () => {
    // Not merely "no upload": the row must not name the image columns at all.
    // A bundle carrying this feature has to keep working against a database
    // where 0016 has not been applied, and naming a column that does not exist
    // is a PostgREST error that would strand every text capture.
    insert.mockResolvedValue({ error: null });
    await enqueue("just words", USER);
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(Object.keys(insert.mock.calls[0]![0] as object)).toEqual([
      "id",
      "user_id",
      "raw_text",
      "created_at",
    ]);
  });
});

describe("action ops", () => {
  const ACTION = "33333333-3333-3333-3333-333333333333";

  it("syncs a decision and clears it", async () => {
    await OUTBOX.enqueueActionPatch(ACTION, USER, { status: "declined", decided_at: "x" });
    await flush();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(await peek()).toHaveLength(0);
  });

  it("survives a failure and stays queued, overlaid by pendingActionPatch", async () => {
    patch.mockResolvedValue({ error: { message: "offline" } });
    await OUTBOX.enqueueActionPatch(ACTION, USER, { status: "done", decided_at: "x" });
    await flush();
    expect(await peek()).toHaveLength(1);
    // The stream reads the overlay, so an approve made with no signal keeps the
    // action out of "Needs you" across a cold reload.
    expect(OUTBOX.pendingActionPatch(await peek(), ACTION)).toEqual({
      status: "done",
      decided_at: "x",
    });
  });

  it("merges a decision and an undo into one write", async () => {
    // Decline then Undo must be one durable write, not two that race.
    patch.mockResolvedValue({ error: { message: "offline" } });
    await OUTBOX.enqueueActionPatch(ACTION, USER, { status: "declined", decided_at: "x" });
    await OUTBOX.enqueueActionPatch(ACTION, USER, { status: "proposed", decided_at: null });
    const queued = await peek();
    expect(queued).toHaveLength(1);
    expect(OUTBOX.pendingActionPatch(queued, ACTION)).toEqual({
      status: "proposed",
      decided_at: null,
    });
  });
});

// The v1 -> v2 migration runs once per module instance, so it gets its own
// file: see tests/outbox-migration.test.ts.
