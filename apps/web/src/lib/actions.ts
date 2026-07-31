import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Action, Area } from "@reeve/shared";
import { REEVE_AREA_ID } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { assembleBrief } from "@/lib/brief";
import { enqueueActionPatch, type ActionPatch } from "@/lib/outbox";

/** The change-request review list, shared with NeedsYou. */
const CHANGE_REQUESTS_QK = ["change_requests"] as const;

/**
 * The decisions the "Needs you" stream makes on an action (AQ-2/AQ-4/AQ-5).
 * One place, because the card and the detail sheet trigger the same
 * transitions and must not drift.
 *
 * Durable via the outbox, with an optimistic remove-from-stream: a judgment,
 * like a capture or a commitment edit, must survive being made with no signal.
 * Two transitions stay online by nature and say so — a reeve Go (a model call)
 * and the Work board's own operations below (AQ-7), which run while you watch.
 */

export const ACTIONS_QK = ["actions"] as const;
/** The Work board's three lanes (AQ-7): dispatched / working / done. */
export const WORK_QK = ["work-actions"] as const;

/** End of the Queued lane. Monotonic, so a new dispatch needs no read. */
export function endOfQueue(): number {
  return Date.now();
}

/**
 * The queue_position for a card dropped between two others (AQ-7). Midpoint
 * when both exist, just past the edge otherwise. Pure but for the empty-lane
 * fallback; the three real cases are unit-tested.
 */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before != null && after != null) return (before + after) / 2;
  if (after != null) return after - 1;
  if (before != null) return before + 1;
  return endOfQueue();
}

/**
 * AQ-3: the proposed order. Pinned first (most recent pin leads), then by the
 * linked commitment's due date (overdue → soonest → none), then recency. Pure
 * and unit-tested; kept as a single call site so v2's model-scored importance
 * can replace it without touching the stream.
 */
export function orderActions(
  actions: readonly Action[],
  dueByCapture: Map<string, string>,
): Action[] {
  return [...actions].sort((a, b) => {
    if (a.pinned_at && b.pinned_at) return b.pinned_at.localeCompare(a.pinned_at);
    if (a.pinned_at) return -1;
    if (b.pinned_at) return 1;

    const da = dueByCapture.get(a.capture_id);
    const db = dueByCapture.get(b.capture_id);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (db && !da) return 1;

    return b.created_at.localeCompare(a.created_at);
  });
}

function now() {
  return new Date().toISOString();
}

/** Drop an action from the stream cache immediately; the query confirms later. */
function removeFromStream(qc: QueryClient, id: string) {
  qc.setQueryData<Action[]>(ACTIONS_QK, (old) => old?.filter((a) => a.id !== id));
}

/** Patch an action in place in the stream cache (a pin re-orders, it stays). */
function patchInStream(qc: QueryClient, id: string, patch: Partial<Action>) {
  qc.setQueryData<Action[]>(ACTIONS_QK, (old) =>
    old?.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  );
}

/**
 * The durable transition every stream decision shares: remove from the stream
 * at once, then queue the write. The outbox retries until it lands, so there is
 * no failure toast here — the departure is the acknowledgement, as with a
 * capture. NeedsYou overlays the pending patch, so a decision survives a reload
 * before the queue has flushed.
 */
async function apply(
  qc: QueryClient,
  action: Action,
  patch: ActionPatch,
  { optimistic = true }: { optimistic?: boolean } = {},
): Promise<void> {
  if (optimistic) removeFromStream(qc, action.id);
  await enqueueActionPatch(action.id, action.user_id, patch);
}

// --- proposed → … --------------------------------------------------------

/** "Just a note": the capture stays filed as reference; nothing is dispatched. */
export async function declineAction(qc: QueryClient, action: Action): Promise<void> {
  await apply(qc, action, { status: "declined", decided_at: now() });
  toast("Filed as a note", {
    action: { label: "Undo", onClick: () => void restoreToProposed(qc, action) },
  });
}

export async function restoreToProposed(qc: QueryClient, action: Action): Promise<void> {
  // Put it back in the stream optimistically, then queue the restore.
  qc.setQueryData<Action[]>(ACTIONS_QK, (old) => {
    const without = (old ?? []).filter((a) => a.id !== action.id);
    return [...without, { ...action, status: "proposed", decided_at: null }];
  });
  await enqueueActionPatch(action.id, action.user_id, { status: "proposed", decided_at: null });
}

/**
 * "Go": hand the action to an agent. Stores the brief and moves it to
 * dispatched. Manual dispatch for now — spec.md §9 automates it.
 */
export async function dispatchAction(
  qc: QueryClient,
  action: Action,
  brief: string,
): Promise<void> {
  // queue_position lands it at the end of the Queued lane on the Work board.
  await apply(qc, action, {
    status: "dispatched",
    brief,
    dispatched_at: now(),
    queue_position: endOfQueue(),
  });
  void qc.invalidateQueries({ queryKey: WORK_QK });
  toast("Sent to an agent", { description: "Brief copied to your clipboard." });
}

/**
 * The whole "Go" flow, so the card and the detail sheet share it (AQ-4):
 * respect a Tweaked brief, otherwise assemble one from the capture; copy it to
 * the clipboard; then dispatch to the Work board.
 *
 * A reeve-area action is the exception: it routes through the *existing*
 * change-request pipeline (decided with Chris), so building Reeve keeps its one
 * loop — draft → review → file → @claude → PR → shipped → push — instead of a
 * generic Work-board handoff to an assistant that cannot open a PR.
 */
export async function goAction(qc: QueryClient, action: Action, area?: Area): Promise<void> {
  if (action.area_id === REEVE_AREA_ID) return goReeveAction(qc, action);

  let brief = action.brief?.trim() ?? "";
  if (!brief) {
    const [captureRes, commitmentsRes] = await Promise.all([
      supabase.from("captures").select("raw_text").eq("id", action.capture_id).maybeSingle(),
      supabase.from("commitments").select("text, due_text").eq("capture_id", action.capture_id),
    ]);
    brief = assembleBrief({
      actionTitle: action.title,
      rawText: (captureRes.data?.raw_text as string) ?? "",
      areaLabel: area?.label,
      areaHint: area?.classifier_hint,
      commitments: (commitmentsRes.data as { text: string; due_text: string | null }[]) ?? [],
    });
  }
  try {
    await navigator.clipboard.writeText(brief);
  } catch {
    /* clipboard may be unavailable; the brief is still saved on the action */
  }
  await dispatchAction(qc, action, brief);
}

/**
 * Go on a reeve-area action: hand it to the change-request pipeline rather than
 * the Work board.
 *
 * The action's job — surface an app idea and let you approve acting on it — is
 * fulfilled the moment it becomes a change request, so it is marked done (it
 * ages out of the Work board's Done lane); the change request is the living
 * artifact, reviewed back in "Needs you". Online by nature — the draft is a
 * model call — so the writes are direct and a failed draft reverts cleanly.
 *
 * NOTE (flagged for Chris): whether a reeve Go should also appear on the Work
 * board, or only as its change request, is a product call taken here as
 * "change request only". Easy to change if living with it says otherwise.
 */
async function goReeveAction(qc: QueryClient, action: Action): Promise<void> {
  removeFromStream(qc, action.id);
  const done = await supabase
    .from("actions")
    .update({ status: "done", decided_at: now() })
    .eq("id", action.id);
  if (done.error) {
    void qc.invalidateQueries({ queryKey: ACTIONS_QK });
    toast.error("Couldn't do that", { description: "Nothing changed." });
    return;
  }

  const { error } = await supabase.functions.invoke("draft-change-request", {
    body: { capture_ids: [action.capture_id] },
  });

  if (error) {
    await supabase
      .from("actions")
      .update({ status: "proposed", decided_at: null })
      .eq("id", action.id);
    void qc.invalidateQueries({ queryKey: ACTIONS_QK });
    toast.error("Couldn't draft that change", { description: "Put back for you to try again." });
    return;
  }

  void qc.invalidateQueries({ queryKey: CHANGE_REQUESTS_QK });
  void qc.invalidateQueries({ queryKey: WORK_QK });
  toast("Drafted a change", { description: "Review it in Needs you." });
}

// --- the "Do next" nudge (AQ-3) ------------------------------------------

/** Pin to the top of the stream, or unpin. The only manual lever on order. */
export async function togglePin(qc: QueryClient, action: Action): Promise<void> {
  const pinned_at = action.pinned_at ? null : now();
  // Not an optimistic remove — a pinned action stays in the stream, it just
  // moves. Patch it in place so it re-orders at once, then queue the write.
  patchInStream(qc, action.id, { pinned_at });
  await enqueueActionPatch(action.id, action.user_id, { pinned_at });
}

// --- review → … ----------------------------------------------------------

/** Approve the agent's result. Lands in the Work board's Done lane. */
export async function approveAction(qc: QueryClient, action: Action): Promise<void> {
  await apply(qc, action, { status: "done", decided_at: now() });
  void qc.invalidateQueries({ queryKey: WORK_QK });
  toast("Approved");
}

/** Send it back for another pass. Returns to the Queued lane; result cleared. */
export async function redoAction(qc: QueryClient, action: Action): Promise<void> {
  await apply(qc, action, {
    status: "dispatched",
    result: null,
    assignee: null,
    started_at: null,
    queue_position: endOfQueue(),
  });
  void qc.invalidateQueries({ queryKey: WORK_QK });
  toast("Sent back for another pass");
}

// --- the Work board (AQ-7) -----------------------------------------------
//
// Reorder the Queued lane, pick a card up (assign an assistant), and complete
// it. All manual for v1; spec.md §9's real agents populate the assistant and
// drive these transitions themselves later.

/** Drag within Queued: write the new order. Optimistic against the board cache. */
export async function reorderQueued(
  qc: QueryClient,
  action: Action,
  queue_position: number,
): Promise<void> {
  qc.setQueryData<Action[]>(WORK_QK, (old) =>
    old?.map((a) => (a.id === action.id ? { ...a, queue_position } : a)),
  );
  const { error } = await supabase
    .from("actions")
    .update({ queue_position })
    .eq("id", action.id);
  if (error) {
    void qc.invalidateQueries({ queryKey: WORK_QK });
    toast.error("Couldn't reorder that");
  }
}

/** Pick a card up: move it to Working and record who is on it. */
export async function startWorking(
  qc: QueryClient,
  action: Action,
  assignee: string,
): Promise<void> {
  const patch = { status: "working" as const, assignee: assignee.trim() || null, started_at: now() };
  qc.setQueryData<Action[]>(WORK_QK, (old) =>
    old?.map((a) => (a.id === action.id ? { ...a, ...patch } : a)),
  );
  const { error } = await supabase.from("actions").update(patch).eq("id", action.id);
  if (error) {
    void qc.invalidateQueries({ queryKey: WORK_QK });
    toast.error("Couldn't start that");
    return;
  }
  toast("Working", assignee.trim() ? { description: `With ${assignee.trim()}` } : undefined);
}

/** Change who a working card is assigned to. */
export async function assignAction(
  qc: QueryClient,
  action: Action,
  assignee: string,
): Promise<void> {
  const value = assignee.trim() || null;
  qc.setQueryData<Action[]>(WORK_QK, (old) =>
    old?.map((a) => (a.id === action.id ? { ...a, assignee: value } : a)),
  );
  const { error } = await supabase.from("actions").update({ assignee: value }).eq("id", action.id);
  if (error) {
    void qc.invalidateQueries({ queryKey: WORK_QK });
    toast.error("Couldn't reassign that");
  }
}

// The manual result loop (AQ-5): until real agents return work, Chris drives
// the return — a working card either comes back for approval or is marked done.

/** An agent handed something back: re-enter "Needs you" as an Approve/Redo. */
export async function markResultReady(
  qc: QueryClient,
  action: Action,
  result: string,
): Promise<void> {
  const { error } = await supabase
    .from("actions")
    .update({ status: "review", result: result.trim() || null })
    .eq("id", action.id);
  if (error) {
    toast.error("Couldn't save that");
    return;
  }
  void qc.invalidateQueries({ queryKey: ACTIONS_QK });
  void qc.invalidateQueries({ queryKey: WORK_QK });
  toast("Saved for review");
}

/** Done without a review step. Stays on the board, in Done. */
export async function markDone(qc: QueryClient, action: Action): Promise<void> {
  const { error } = await supabase
    .from("actions")
    .update({ status: "done", decided_at: now() })
    .eq("id", action.id);
  if (error) {
    toast.error("Couldn't do that");
    return;
  }
  void qc.invalidateQueries({ queryKey: WORK_QK });
  toast("Marked done");
}
