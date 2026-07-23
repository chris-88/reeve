import { describe, expect, it, vi } from "vitest";
import type { Action } from "@reeve/shared";

// orderActions is pure, but its module imports the supabase client and sonner;
// stub both so importing it needs no browser env, the way the outbox test does.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

const { orderActions } = await import("../apps/web/src/lib/actions");

function action(over: Partial<Action> & { id: string }): Action {
  return {
    user_id: "u",
    capture_id: over.id,
    title: over.id,
    brief: null,
    status: "proposed",
    area_id: null,
    pinned_at: null,
    result: null,
    dispatched_at: null,
    decided_at: null,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...over,
  };
}

const ids = (as: Action[]) => as.map((a) => a.id);

describe("orderActions", () => {
  it("puts pinned first, most recent pin leading", () => {
    const out = orderActions(
      [
        action({ id: "old-pin", pinned_at: "2026-07-01T00:00:00Z" }),
        action({ id: "unpinned" }),
        action({ id: "new-pin", pinned_at: "2026-07-02T00:00:00Z" }),
      ],
      new Map(),
    );
    expect(ids(out).slice(0, 2)).toEqual(["new-pin", "old-pin"]);
    expect(ids(out).at(-1)).toBe("unpinned");
  });

  it("orders by due date — soonest first — ahead of the undated", () => {
    const due = new Map([
      ["soon", "2026-07-10"],
      ["later", "2026-07-20"],
    ]);
    const out = orderActions(
      [action({ id: "later" }), action({ id: "undated" }), action({ id: "soon" })],
      due,
    );
    expect(ids(out)).toEqual(["soon", "later", "undated"]);
  });

  it("falls back to recency, newest first", () => {
    const out = orderActions(
      [
        action({ id: "older", created_at: "2026-07-01T00:00:00Z" }),
        action({ id: "newer", created_at: "2026-07-05T00:00:00Z" }),
      ],
      new Map(),
    );
    expect(ids(out)).toEqual(["newer", "older"]);
  });

  it("does not mutate its input", () => {
    const input = [action({ id: "b" }), action({ id: "a", pinned_at: "2026-07-02T00:00:00Z" })];
    const snapshot = ids(input);
    orderActions(input, new Map());
    expect(ids(input)).toEqual(snapshot);
  });
});
