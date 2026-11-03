import { describe, expect, it } from "vitest";
import {
  actionState,
  collapsedLine,
  countNeedsYou,
  cursorAfter,
  isCard,
  mergeRows,
  needsYou,
  olderThan,
  overlayActionPatch,
  splitResult,
  toMessage,
  type ThreadRow,
} from "../apps/web/src/lib/thread.ts";

/** E-5: rows of the view become messages; the pure pieces the screen leans on. */

function row(over: Partial<ThreadRow> & { id: string; kind: ThreadRow["kind"] }): ThreadRow {
  return {
    user_id: "u",
    happened_at: "2026-11-03T08:00:00.000Z",
    ref_id: over.id.split(":")[1] ?? "r",
    capture_id: null,
    title: null,
    body: null,
    domain: null,
    status: null,
    result: null,
    result_files: null,
    feedback: null,
    filed_path: null,
    archived_at: null,
    meta: {},
    ...over,
  };
}

describe("actionState", () => {
  it("reads the lifecycle the card renders", () => {
    expect(actionState("proposed", "task", null)).toBe("proposed");
    expect(actionState("proposed", "decompose", null)).toBe("working");
    expect(actionState("dispatched", "task", null)).toBe("working");
    expect(actionState("working", "task", null)).toBe("working");
    expect(actionState("review", "task", "What I did: x")).toBe("result");
    expect(actionState("review", "task", "Reeve could not complete this: boom")).toBe("failed");
    expect(actionState("review", "decompose", "That was six things")).toBe("decomposed");
    expect(actionState("done", "task", "x")).toBe("done");
    expect(actionState("declined", "task", null)).toBe("declined");
  });
});

describe("toMessage", () => {
  it("maps every kind and ignores an unknown one", () => {
    const kinds: ThreadRow["kind"][] = ["capture", "filed", "capture_failed", "action", "redo_note", "brief", "due", "paused", "stalled"];
    for (const kind of kinds) {
      const m = toMessage(row({ id: `${kind}:00000000-0000-0000-0000-000000000001`, kind, status: kind === "action" ? "proposed" : "done", title: "t", body: "b" }));
      expect(m, kind).not.toBeNull();
    }
    expect(toMessage(row({ id: "x:1", kind: "nope" as ThreadRow["kind"] }))).toBeNull();
  });

  it("carries the filed bubble's commitments and the due card's items", () => {
    const filed = toMessage(
      row({
        id: "filed:c1",
        kind: "filed",
        status: "done",
        meta: { commitments: [{ id: "k1", text: "Ring Tom", due_at: "2026-11-07", due_text: "Friday", status: "open" }], actions: 1 },
      }),
    );
    expect(filed?.type === "filed" && filed.commitments[0]?.text).toBe("Ring Tom");
    const due = toMessage(row({ id: "notice:n1", kind: "due", body: "Two things today", meta: { items: [{ id: "k1", text: "Ring Tom", due_at: "2026-11-03" }] } }));
    expect(due?.type === "due" && due.items.length).toBe(1);
  });
});

describe("mergeRows and the keyset", () => {
  const a = row({ id: "capture:a", kind: "capture", happened_at: "2026-11-03T08:00:00.000Z" });
  const b = row({ id: "action:b", kind: "action", status: "proposed", happened_at: "2026-11-03T08:05:00.000Z" });
  const c = row({ id: "capture:c", kind: "capture", happened_at: "2026-11-03T08:05:00.000Z" });

  it("dedupes by id with the newer copy winning, drops archived, orders oldest first with id ties", () => {
    const merged = mergeRows([a, b], [{ ...b, status: "dispatched" }, c, { ...a, archived_at: "x" }]);
    expect(merged.map((r) => r.id)).toEqual(["action:b", "capture:c"]);
    expect(merged[0]?.status).toBe("dispatched");
  });

  it("cursors on the oldest row of a page and spells the PostgREST filter", () => {
    expect(cursorAfter([b, a, c])).toEqual({ at: a.happened_at, id: a.id });
    expect(cursorAfter([])).toBeNull();
    expect(olderThan({ at: "T", id: "x" })).toBe("happened_at.lt.T,and(happened_at.eq.T,id.lt.x)");
  });
});

describe("what needs you", () => {
  const act = (status: string, result: string | null = null, kind = "task") =>
    toMessage(row({ id: `action:${status}`, kind: "action", status, result, meta: { kind } }))!;

  it("counts proposed, results, failures and decompositions; not work in progress or decided", () => {
    expect(needsYou(act("proposed"))).toBe(true);
    expect(needsYou(act("review", "What I did: x"))).toBe(true);
    expect(needsYou(act("review", "Reeve could not complete this: x"))).toBe(true);
    expect(needsYou(act("review", "six things", "decompose"))).toBe(true);
    expect(needsYou(act("dispatched"))).toBe(false);
    expect(needsYou(act("done", "x"))).toBe(false);
    expect(needsYou(toMessage(row({ id: "capture:x", kind: "capture" }))!)).toBe(false);
    expect(countNeedsYou([act("proposed"), act("done", "x"), act("review", "r")])).toBe(2);
  });

  it("overlays an unsent decision so the card collapses before the outbox flushes", () => {
    const m = act("review", "What I did: x");
    const over = overlayActionPatch(m, { status: "done", decided_at: "2026-11-03T08:20:00.000Z" });
    expect(over.type === "action" && over.state).toBe("done");
    expect(needsYou(over)).toBe(false);
    expect(over.type === "action" && collapsedLine(over, () => "08:20")).toBe("Approved · 08:20");
  });

  it("cards decide, bubbles talk", () => {
    expect(isCard(act("proposed"))).toBe(true);
    expect(isCard(act("dispatched"))).toBe(false);
    expect(isCard(toMessage(row({ id: "brief:b", kind: "brief" }))!)).toBe(false);
    expect(isCard(toMessage(row({ id: "notice:d", kind: "due" }))!)).toBe(true);
  });
});

describe("splitResult", () => {
  it("reads the bridge's three parts", () => {
    const r = splitResult("What I did: Drafted the reply.\nWhere: ~/vault/+/fleeting/phibsboro/reply.md\n- nothing written\nFor you: Approve sends it.");
    expect(r.did).toBe("Drafted the reply.");
    expect(r.where).toEqual(["~/vault/+/fleeting/phibsboro/reply.md"]);
    expect(r.forYou).toBe("Approve sends it.");
    expect(r.rest).toBe("");
  });
  it("keeps free text when the shape is missing", () => {
    expect(splitResult("Just a line.").rest).toBe("Just a line.");
  });
});
