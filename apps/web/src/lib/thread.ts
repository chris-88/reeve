import type { ActionStatus, CaptureStatus } from "@reeve/shared";
import type { ActionPatch } from "@/lib/outbox";

/**
 * E-5: the thread is a view. One row of `thread_events` per message; this
 * module turns rows into the message model the screen renders and holds the
 * pure pieces (ordering, merging, the keyset cursor, who needs you) that the
 * unit tests cover.
 */

/** A row of the `thread_events` view, as PostgREST returns it. */
export type ThreadRow = {
  id: string;
  user_id: string;
  happened_at: string;
  kind: "capture" | "filed" | "capture_failed" | "action" | "redo_note" | "brief" | "due" | "paused" | "stalled";
  ref_id: string;
  capture_id: string | null;
  title: string | null;
  body: string | null;
  domain: string | null;
  status: string | null;
  result: string | null;
  result_files: string[] | null;
  feedback: string | null;
  filed_path: string | null;
  archived_at: string | null;
  meta: Record<string, unknown> | null;
};

export type FiledCommitment = {
  id: string;
  text: string;
  due_at: string | null;
  due_text: string | null;
  status: "open" | "done" | "dropped";
};

export type DueItem = { id: string | null; text: string; due_at: string };

/** How an action reads in the thread. One message, several states (E-4). */
export type ActionState = "proposed" | "working" | "result" | "failed" | "decomposed" | "done" | "declined";

export type Message =
  | { id: string; at: string; from: "you"; type: "capture"; captureId: string; text: string; domain: string | null; status: CaptureStatus; pending?: boolean }
  | { id: string; at: string; from: "reeve"; type: "filed"; captureId: string; title: string | null; summary: string | null; domain: string | null; commitments: FiledCommitment[]; actions: number; filedPath: string | null }
  | { id: string; at: string; from: "reeve"; type: "capture_failed"; captureId: string; title: string | null; error: string | null }
  | {
      id: string;
      at: string;
      from: "reeve";
      type: "action";
      actionId: string;
      captureId: string;
      title: string;
      brief: string | null;
      domain: string | null;
      status: ActionStatus;
      kind: "task" | "decompose";
      state: ActionState;
      result: string | null;
      resultFiles: string[];
      decidedAt: string | null;
    }
  | { id: string; at: string; from: "you"; type: "redo_note"; actionId: string; text: string }
  | { id: string; at: string; from: "reeve"; type: "brief"; body: string }
  | { id: string; at: string; from: "reeve"; type: "due"; noticeId: string; body: string; items: DueItem[] }
  | { id: string; at: string; from: "reeve"; type: "notice"; kind: "paused" | "stalled"; body: string; actionId: string | null };

export const FAILURE_PREFIX = "Reeve could not complete this";

export function actionState(status: ActionStatus, kind: "task" | "decompose", result: string | null): ActionState {
  switch (status) {
    case "proposed":
      // A decompose is picked up without being asked; it is never a question.
      return kind === "decompose" ? "working" : "proposed";
    case "dispatched":
    case "working":
      return "working";
    case "review":
      if (result?.startsWith(FAILURE_PREFIX)) return "failed";
      return kind === "decompose" ? "decomposed" : "result";
    case "done":
      return "done";
    case "declined":
      return "declined";
  }
}

export function toMessage(row: ThreadRow): Message | null {
  const meta = row.meta ?? {};
  switch (row.kind) {
    case "capture":
      return {
        id: row.id,
        at: row.happened_at,
        from: "you",
        type: "capture",
        captureId: row.ref_id,
        text: row.body ?? "",
        domain: row.domain,
        status: (row.status as CaptureStatus) ?? "done",
      };
    case "filed":
      return {
        id: row.id,
        at: row.happened_at,
        from: "reeve",
        type: "filed",
        captureId: row.ref_id,
        title: row.title,
        summary: row.body,
        domain: row.domain,
        commitments: Array.isArray(meta.commitments) ? (meta.commitments as FiledCommitment[]) : [],
        actions: typeof meta.actions === "number" ? meta.actions : Number(meta.actions ?? 0),
        filedPath: row.filed_path,
      };
    case "capture_failed":
      return { id: row.id, at: row.happened_at, from: "reeve", type: "capture_failed", captureId: row.ref_id, title: row.title, error: row.body };
    case "action": {
      const status = row.status as ActionStatus;
      const kind = meta.kind === "decompose" ? "decompose" : "task";
      return {
        id: row.id,
        at: row.happened_at,
        from: "reeve",
        type: "action",
        actionId: row.ref_id,
        captureId: row.capture_id ?? "",
        title: row.title ?? "",
        brief: row.body,
        domain: row.domain,
        status,
        kind,
        state: actionState(status, kind, row.result),
        result: row.result,
        resultFiles: row.result_files ?? [],
        decidedAt: typeof meta.decided_at === "string" ? meta.decided_at : null,
      };
    }
    case "redo_note":
      return { id: row.id, at: row.happened_at, from: "you", type: "redo_note", actionId: row.ref_id, text: row.body ?? "" };
    case "brief":
      return { id: row.id, at: row.happened_at, from: "reeve", type: "brief", body: row.body ?? "" };
    case "due":
      return {
        id: row.id,
        at: row.happened_at,
        from: "reeve",
        type: "due",
        noticeId: row.ref_id,
        body: row.body ?? "",
        items: Array.isArray(meta.items) ? (meta.items as DueItem[]) : [],
      };
    case "paused":
    case "stalled":
      return {
        id: row.id,
        at: row.happened_at,
        from: "reeve",
        type: "notice",
        kind: row.kind,
        body: row.body ?? "",
        actionId: typeof meta.action_id === "string" ? meta.action_id : null,
      };
    default:
      return null;
  }
}

/** Oldest first, ties broken by id so the order is total and the keyset is stable. */
export function compareMessages(a: { at: string; id: string }, b: { at: string; id: string }): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Merge rows into a list, newest copy of a row winning, archived rows dropped. */
export function mergeRows(existing: readonly ThreadRow[], incoming: readonly ThreadRow[]): ThreadRow[] {
  const byId = new Map<string, ThreadRow>();
  for (const r of existing) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  return [...byId.values()]
    .filter((r) => !r.archived_at)
    .sort((a, b) => compareMessages({ at: a.happened_at, id: a.id }, { at: b.happened_at, id: b.id }));
}

export type Cursor = { at: string; id: string };

/** The keyset cursor for the page after this one: the oldest row loaded. */
export function cursorAfter(page: readonly ThreadRow[]): Cursor | null {
  if (page.length === 0) return null;
  const oldest = page.reduce((o, r) =>
    compareMessages({ at: r.happened_at, id: r.id }, { at: o.happened_at, id: o.id }) < 0 ? r : o,
  );
  return { at: oldest.happened_at, id: oldest.id };
}

/** The PostgREST filter for "strictly older than the cursor" on (happened_at, id). */
export function olderThan(c: Cursor): string {
  return `happened_at.lt.${c.at},and(happened_at.eq.${c.at},id.lt.${c.id})`;
}

/** Does this message carry a decision for Chris? Drives the chip and the badge. */
export function needsYou(m: Message): boolean {
  return m.type === "action" && (m.state === "proposed" || m.state === "result" || m.state === "failed" || m.state === "decomposed");
}

export function countNeedsYou(messages: readonly Message[]): number {
  return messages.filter(needsYou).length;
}

/** Overlay a queued-but-unsent action decision on its message, so a tap made
 *  with no signal reads as done even before the outbox flushes. */
export function overlayActionPatch(m: Message, patch: ActionPatch | undefined): Message {
  if (!patch || m.type !== "action") return m;
  const status = patch.status ?? m.status;
  const result = patch.result === undefined ? m.result : patch.result;
  return {
    ...m,
    status,
    result,
    state: actionState(status, m.kind, result),
    decidedAt: patch.decided_at === undefined ? m.decidedAt : patch.decided_at,
  };
}

/** "Approved · 08:20": the one quiet line a decided card collapses to. */
export function collapsedLine(m: Extract<Message, { type: "action" }>, time: (iso: string) => string): string | null {
  const when = m.decidedAt ? ` · ${time(m.decidedAt)}` : "";
  if (m.state === "done") return `Approved${when}`;
  if (m.state === "declined") return `${m.result?.startsWith(FAILURE_PREFIX) ? "Dropped" : "Not now"}${when}`;
  return null;
}

/** Two visual weights and only two (E-4): cards decide, bubbles talk. */
export function isCard(m: Message): boolean {
  if (m.type === "due" || m.type === "capture_failed") return true;
  if (m.type !== "action") return false;
  return m.state !== "working";
}

/**
 * Rewrite the run's three-part result as prose for the card. The bridge writes
 *   What I did: …\nWhere: …\nFor you: …
 * and the card shows the parts with quiet labels rather than the raw lines.
 */
export function splitResult(result: string): { did: string; where: string[]; forYou: string; rest: string } {
  const did = /What I did:\s*([\s\S]*?)(?=\nWhere:|\nFor you:|$)/i.exec(result)?.[1]?.trim() ?? "";
  const whereBlock = /Where:\s*([\s\S]*?)(?=\nFor you:|$)/i.exec(result)?.[1]?.trim() ?? "";
  const forYou = /For you:\s*([\s\S]*)$/i.exec(result)?.[1]?.trim() ?? "";
  const where = whereBlock
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter((l) => l && !/^nothing written/i.test(l));
  const rest = did || forYou ? "" : result.trim();
  return { did, where, forYou, rest };
}
