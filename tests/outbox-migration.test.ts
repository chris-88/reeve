import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

/**
 * The v1 -> v2 outbox migration.
 *
 * Its own file because it runs exactly once per module instance — a latch that
 * exists so two concurrent reads on mount cannot double every unsent capture.
 * Sharing a file with the other outbox tests would mean it had already run
 * before its own test started.
 *
 * The invariant under test is the one from CLAUDE.md: unsent captures belong
 * to the device, not to the session or the release that queued them. Bumping
 * the storage key without carrying them across would bin a thought that the
 * app had already promised was safe.
 */

vi.mock("../apps/web/src/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ abortSignal: async () => ({ error: { message: "offline" } }) }),
      update: () => ({
        eq: () => ({ eq: () => ({ abortSignal: async () => ({ error: null }) }) }),
      }),
      select: () => ({
        eq: () => ({
          lt: () => ({
            order: () => ({ limit: () => ({ abortSignal: async () => ({ data: [], error: null }) }) }),
          }),
        }),
      }),
    }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

const { get, set } = await import("idb-keyval");

const LEGACY = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userId: "11111111-1111-1111-1111-111111111111",
  raw_text: "queued before the Due view existed",
  created_at: "2026-07-01T00:00:00.000Z",
  attempts: 2,
  nextAttemptAt: 0,
  deadLettered: false,
};

await set("reeve.outbox.v1", [LEGACY]);

const { peek } = await import("../apps/web/src/lib/outbox");

describe("outbox v1 -> v2", () => {
  it("carries an unsent capture across, with its backoff state", async () => {
    const items = await peek();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(LEGACY.id);
    expect(items[0]!.userId).toBe(LEGACY.userId);
    expect(items[0]!.op).toEqual({
      kind: "capture",
      raw_text: LEGACY.raw_text,
      created_at: LEGACY.created_at,
    });
    // Not reset to zero: an item that has already failed twice should not get
    // a fresh three attempts every time the app is updated.
    expect(items[0]!.attempts).toBe(2);
  });

  it("clears the old key so it cannot be applied twice", async () => {
    await peek();
    expect(await get("reeve.outbox.v1")).toBeUndefined();
  });
});
