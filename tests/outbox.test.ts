import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The outbox is the one module where a mock is the right tool: the behaviour
 * under test is the client's own state machine — idempotent replay, backoff,
 * dead-lettering, atomicity — not anything Supabase does.
 */

type InsertResult = { error: { code?: string; message: string } | null };

const insert = vi.fn<() => Promise<InsertResult>>();
const invoke = vi.fn(async () => ({ data: null, error: null }));

vi.mock("../apps/web/src/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      insert: () => ({ abortSignal: () => insert() }),
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

const { backoffFor, enqueue, flush, peek, retryItem } = await import(
  "../apps/web/src/lib/outbox"
);
const { clear } = await import("idb-keyval");

const USER = "11111111-1111-1111-1111-111111111111";

beforeEach(async () => {
  await clear();
  insert.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: null, error: null });
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
      const { update } = await import("idb-keyval");
      await update<Array<{ nextAttemptAt: number }>>("reeve.outbox.v1", (items) =>
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
    const { update } = await import("idb-keyval");
    await update<Array<Record<string, unknown>>>("reeve.outbox.v1", (items) =>
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
