import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Action, Area } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { assembleBrief } from "@/lib/brief";

/**
 * The decisions the "Needs you" stream makes on an action (AQ-2/AQ-4/AQ-5).
 * One place, because the card and the detail sheet trigger the same
 * transitions and must not drift.
 *
 * Online-first with an optimistic remove-from-stream and an error toast on
 * failure: a judgment, unlike a capture, is not made with no signal. (Making
 * these decisions durable offline via the outbox is a noted follow-up, the way
 * change-request review already is.)
 */

export const ACTIONS_QK = ["actions"] as const;

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

async function apply(
  qc: QueryClient,
  action: Action,
  patch: Partial<Action>,
  { optimistic = true }: { optimistic?: boolean } = {},
): Promise<boolean> {
  if (optimistic) removeFromStream(qc, action.id);
  const { error } = await supabase.from("actions").update(patch).eq("id", action.id);
  if (error) {
    void qc.invalidateQueries({ queryKey: ACTIONS_QK });
    toast.error("Couldn't do that", { description: "Nothing changed." });
    return false;
  }
  return true;
}

// --- proposed → … --------------------------------------------------------

/** "Just a note": the capture stays filed as reference; nothing is dispatched. */
export async function declineAction(qc: QueryClient, action: Action): Promise<void> {
  if (await apply(qc, action, { status: "declined", decided_at: now() })) {
    toast("Filed as a note", {
      action: { label: "Undo", onClick: () => void restoreToProposed(qc, action) },
    });
  }
}

export async function restoreToProposed(qc: QueryClient, action: Action): Promise<void> {
  const { error } = await supabase
    .from("actions")
    .update({ status: "proposed", decided_at: null })
    .eq("id", action.id);
  if (error) toast.error("Couldn't restore that");
  else void qc.invalidateQueries({ queryKey: ACTIONS_QK });
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
  if (await apply(qc, action, { status: "dispatched", brief, dispatched_at: now() })) {
    toast("Sent to an agent", { description: "Brief copied to your clipboard." });
  }
}

/**
 * The whole "Go" flow, so the card and the detail sheet share it (AQ-4):
 * respect a Tweaked brief, otherwise assemble one from the capture; copy it to
 * the clipboard (manual dispatch); then dispatch. A reeve-area action is meant
 * to route through the change-request pipeline — flagged, wired in AQ-4's
 * follow-up rather than duplicated here.
 */
export async function goAction(qc: QueryClient, action: Action, area?: Area): Promise<void> {
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

// --- the "Do next" nudge (AQ-3) ------------------------------------------

/** Pin to the top of the stream, or unpin. The only manual lever on order. */
export async function togglePin(qc: QueryClient, action: Action): Promise<void> {
  const pinned_at = action.pinned_at ? null : now();
  // Not an optimistic remove — a pinned action stays in the stream, it just
  // moves. Let the query re-order it.
  const { error } = await supabase
    .from("actions")
    .update({ pinned_at })
    .eq("id", action.id);
  if (error) toast.error("Couldn't pin that");
  else void qc.invalidateQueries({ queryKey: ACTIONS_QK });
}

// --- review → … ----------------------------------------------------------

/** Approve the agent's result. */
export async function approveAction(qc: QueryClient, action: Action): Promise<void> {
  if (await apply(qc, action, { status: "done", decided_at: now() })) {
    toast("Approved");
  }
}

/** Send it back for another pass. Returns to dispatched; the result is cleared. */
export async function redoAction(qc: QueryClient, action: Action): Promise<void> {
  if (await apply(qc, action, { status: "dispatched", result: null })) {
    toast("Sent back for another pass");
  }
}

// --- dispatched → … (the manual result loop; AQ-5) -----------------------
//
// Until real agents return work automatically (spec.md §9), Chris drives the
// return by hand: a dispatched action either comes back for approval or is
// simply marked done.

export const DISPATCHED_QK = ["dispatched-actions"] as const;

/** An agent handed something back: enter the stream as an Approve/Redo decision. */
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
  void qc.invalidateQueries({ queryKey: DISPATCHED_QK });
  toast("Saved for review");
}

/** Done without a review step. */
export async function markDone(qc: QueryClient, action: Action): Promise<void> {
  const { error } = await supabase
    .from("actions")
    .update({ status: "done", decided_at: now() })
    .eq("id", action.id);
  if (error) {
    toast.error("Couldn't do that");
    return;
  }
  void qc.invalidateQueries({ queryKey: DISPATCHED_QK });
  toast("Marked done");
}
