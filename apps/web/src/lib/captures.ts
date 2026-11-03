import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

/**
 * What a long-press on your own message can do (E-4): move it to another
 * domain, retitle it, archive it, or ask triage to try again. Online by
 * nature; these are corrections, not captures.
 */

/**
 * Re-filing writes corrected_area_id rather than overwriting area_id. The gap
 * between what the model chose and what Chris chose is the only honest signal
 * about whether the taxonomy is right. The capture's commitments follow.
 */
export async function correctDomain(qc: QueryClient, captureId: string, areaId: string): Promise<void> {
  const { error } = await supabase
    .from("captures")
    .update({ corrected_area_id: areaId, corrected_at: new Date().toISOString() })
    .eq("id", captureId);
  if (error) {
    toast.error("Couldn't move that");
    return;
  }
  await supabase.from("commitments").update({ area_id: areaId }).eq("capture_id", captureId);
  void qc.invalidateQueries({ queryKey: ["thread"] });
}

export async function retitleCapture(qc: QueryClient, captureId: string, title: string): Promise<void> {
  const { error } = await supabase.from("captures").update({ title: title.trim() || null }).eq("id", captureId);
  if (error) {
    toast.error("Couldn't save that");
    return;
  }
  void qc.invalidateQueries({ queryKey: ["thread"] });
}

/** Archive, never delete. The row stays; the thread stops showing it. */
export async function archiveCapture(qc: QueryClient, captureId: string): Promise<void> {
  const at = new Date().toISOString();
  const { error } = await supabase.from("captures").update({ archived_at: at }).eq("id", captureId);
  if (error) {
    toast.error("Couldn't archive that");
    return;
  }
  await supabase.from("actions").update({ archived_at: at }).eq("capture_id", captureId).is("archived_at", null);
  void qc.invalidateQueries({ queryKey: ["thread"] });
}

/**
 * Exhausting the server's attempts should not be terminal: the cause is
 * usually a transient model outage. Resetting puts the row back in front of
 * the sweeper and asks triage to run now.
 */
export async function retryTriage(qc: QueryClient, captureId: string): Promise<void> {
  const { error } = await supabase
    .from("captures")
    .update({ status: "queued", attempts: 0, error: null })
    .eq("id", captureId);
  if (error) {
    toast.error("Couldn't retry that");
    return;
  }
  void supabase.functions.invoke("triage", { body: { capture_id: captureId } });
  void qc.invalidateQueries({ queryKey: ["thread"] });
}
