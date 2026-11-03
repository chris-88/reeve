import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Area } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { assembleBrief } from "@/lib/brief";
import { enqueueActionPatch, type ActionPatch } from "@/lib/outbox";
import type { Message } from "@/lib/thread";

/**
 * The decisions a card in the thread makes on an action (E-4). One place, so
 * the card and the deep-linked card cannot drift.
 *
 * Durable via the outbox: a judgment made with no signal must survive. The
 * thread overlays the pending patch on the message (useThread), so the card
 * collapses the moment it is tapped and stays collapsed across a reload before
 * the queue has flushed. No success toasts: the collapse is the acknowledgement.
 */

/** PN-2: the Needs you count behind the app-icon badge and the header chip. */
export const NEEDS_YOU_COUNT_QK = ["needs-you-count"] as const;

export type ActionMessage = Extract<Message, { type: "action" }>;

function now() {
  return new Date().toISOString();
}

async function apply(qc: QueryClient, m: ActionMessage, patch: ActionPatch, userId: string): Promise<void> {
  await enqueueActionPatch(m.actionId, userId, patch);
  void qc.invalidateQueries({ queryKey: NEEDS_YOU_COUNT_QK });
}

/** End of the bridge's queue. Monotonic, so a new dispatch needs no read. */
export function endOfQueue(): number {
  return Date.now();
}

/** "Not now": the capture stays filed; nothing is dispatched. */
export async function declineAction(qc: QueryClient, m: ActionMessage, userId: string): Promise<void> {
  await apply(qc, m, { status: "declined", decided_at: now() }, userId);
}

/**
 * "Hand to Reeve": store the brief and move it to dispatched; the bridge
 * claims it (BR-1). The card becomes "On it." in place. A brief Chris tweaked
 * is respected; otherwise one is assembled from the capture's own words.
 */
export async function handToReeve(qc: QueryClient, m: ActionMessage, userId: string, area?: Area): Promise<void> {
  let brief = m.brief?.trim() ?? "";
  if (!brief) {
    const [captureRes, commitmentsRes] = await Promise.all([
      supabase.from("captures").select("raw_text").eq("id", m.captureId).maybeSingle(),
      supabase.from("commitments").select("text, due_text").eq("capture_id", m.captureId),
    ]);
    brief = assembleBrief({
      actionTitle: m.title,
      rawText: (captureRes.data?.raw_text as string | undefined) ?? "",
      areaLabel: area?.label,
      areaHint: area?.classifier_hint,
      commitments: (commitmentsRes.data as { text: string; due_text: string | null }[] | null) ?? [],
    });
  }
  await apply(qc, m, { status: "dispatched", brief, dispatched_at: now(), queue_position: endOfQueue() }, userId);
}

/** Approve the result. The card collapses to "Approved · time". */
export async function approveAction(qc: QueryClient, m: ActionMessage, userId: string): Promise<void> {
  await apply(qc, m, { status: "done", decided_at: now() }, userId);
}

/**
 * Redo with a note (BR-5). Back to the bridge's queue; the previous result is
 * kept so the next run reads "Previous attempt" and "Chris said" together.
 */
export async function redoAction(qc: QueryClient, m: ActionMessage, userId: string, feedback: string): Promise<void> {
  await apply(
    qc,
    m,
    {
      status: "dispatched",
      feedback: feedback.trim() || null,
      assignee: null,
      started_at: null,
      dispatched_at: now(),
      queue_position: endOfQueue(),
    },
    userId,
  );
}

/** A failed run: try again, from the top, with no note. */
export async function retryAction(qc: QueryClient, m: ActionMessage, userId: string): Promise<void> {
  await apply(
    qc,
    m,
    { status: "dispatched", result: null, assignee: null, started_at: null, dispatched_at: now(), queue_position: endOfQueue() },
    userId,
  );
}

/** A failed run: drop it. Reads as "Dropped · time". */
export async function dropAction(qc: QueryClient, m: ActionMessage, userId: string): Promise<void> {
  await apply(qc, m, { status: "declined", decided_at: now() }, userId);
}

/** Tweak: the title and domain of a proposal, in place. Online by nature. */
export async function tweakAction(qc: QueryClient, m: ActionMessage, patch: { title?: string; area_id?: string | null }): Promise<void> {
  const { error } = await supabase.from("actions").update(patch).eq("id", m.actionId);
  if (error) {
    toast.error("Couldn't save that");
    return;
  }
  void qc.invalidateQueries({ queryKey: ["thread"] });
}

/** The manual handoff, kept behind an explicit tap for the day the bridge is down. */
export async function copyBrief(m: ActionMessage): Promise<void> {
  const brief = m.brief?.trim();
  if (!brief) {
    toast("No brief yet", { description: "Reeve assembles one when you hand it over." });
    return;
  }
  try {
    await navigator.clipboard.writeText(brief);
    toast("Brief copied");
  } catch {
    toast.error("Couldn't copy");
  }
}
