import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest, Loader2, PenTool, Wand2 } from "lucide-react";
import type { Capture, ChangeRequest } from "@reeve/shared";
import ChangeRequestDetail from "@/components/ChangeRequestDetail";
import {
  pendingChangeRequestPatch,
  subscribe,
  type PendingOp,
} from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type WithCaptures = ChangeRequest & { change_request_captures: { capture_id: string }[] };

/**
 * P1-F11.1: where changing Reeve lives — the existing `reeve` filter chip.
 *
 * Not a third nav item. `docs/archive/ui-spec.md`'s governing principle — the
 * thought is fleeting; everything on screen either serves capturing it or gets
 * deleted — applies with full force, and this is a weekly activity competing
 * for space with a daily one. A permanent home is earned by reaching for it
 * daily (F11.4); until then it is here.
 */
export default function ReeveChangeRequests({
  userId,
  reeveCaptures,
}: {
  userId: string;
  reeveCaptures: Capture[];
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingOp[]>([]);
  const [open, setOpen] = useState<ChangeRequest | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribe(setPending), []);

  const { data: rows = [] } = useQuery({
    queryKey: ["change_requests"],
    queryFn: async (): Promise<WithCaptures[]> => {
      const { data, error } = await supabase
        .from("change_requests")
        .select("*, change_request_captures(capture_id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as WithCaptures[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("change-requests-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "change_requests" }, () =>
        qc.invalidateQueries({ queryKey: ["change_requests"] }),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [qc]);

  // Any capture already in a change request — rejected included — is spoken
  // for, matching the drafting function's own pile. That is what stops a
  // declined idea being re-proposed indefinitely.
  const promoted = useMemo(() => {
    const set = new Set<string>();
    for (const cr of rows) for (const l of cr.change_request_captures) set.add(l.capture_id);
    return set;
  }, [rows]);

  const unpromoted = useMemo(
    () => reeveCaptures.filter((c) => c.status === "done" && !promoted.has(c.id)),
    [reeveCaptures, promoted],
  );

  /** Drafted or awaiting a decision, with an approval/rejection not yet synced
   * removed — so tapping Approve makes it leave the list at once. */
  const reviewable = useMemo(() => {
    return rows
      .map((cr) => ({ ...cr, ...pendingChangeRequestPatch(pending, cr.id) }) as ChangeRequest)
      .filter(
        // A pending rejection sets status to 'rejected', so it drops out here;
        // a pending approval sets decided_at, so it drops out there.
        (cr) => (cr.status === "draft" || cr.status === "proposed") && !cr.decided_at,
      );
  }, [rows, pending]);

  async function draftAChange() {
    if (unpromoted.length === 0 || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const { error } = await supabase.functions.invoke("draft-change-request", {
        body: { capture_ids: unpromoted.map((c) => c.id) },
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["change_requests"] });
    } catch (err) {
      setError("Couldn't draft that. Try again.");
      console.error("[reeve] draft-change-request failed", err);
    } finally {
      setDrafting(false);
    }
  }

  if (unpromoted.length === 0 && reviewable.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {reviewable.map((cr) => (
        <button
          key={cr.id}
          type="button"
          onClick={() => setOpen(cr)}
          className="border-border/60 bg-card/60 hover:bg-card flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors"
        >
          <GitPullRequest className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-serif text-[1.02rem] leading-snug">{cr.title}</span>
            <span className="text-muted-dim text-xs">
              {cr.status === "draft" ? "Drafted — tap to review" : "Ready to file — tap to review"}
              {cr.questions.length > 0 &&
                ` · ${cr.questions.length} question${cr.questions.length === 1 ? "" : "s"}`}
            </span>
          </span>
        </button>
      ))}

      {unpromoted.length > 0 && (
        <button
          type="button"
          disabled={drafting}
          onClick={() => void draftAChange()}
          className={cn(
            "border-border/60 text-muted-foreground hover:text-foreground flex w-full items-center gap-2.5 rounded-xl border border-dashed px-3.5 py-3 text-sm transition-colors",
            drafting && "opacity-70",
          )}
        >
          {drafting ? (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Wand2 className="size-4 shrink-0" aria-hidden />
          )}
          <span className="flex-1 text-left">
            {drafting
              ? "Drafting a change…"
              : `Draft a change from ${unpromoted.length} note${unpromoted.length === 1 ? "" : "s"}`}
          </span>
          <PenTool className="text-muted-dim size-3.5" aria-hidden />
        </button>
      )}

      {error && <p className="text-destructive px-1 text-xs">{error}</p>}

      {open && (
        <ChangeRequestDetail
          changeRequest={reviewable.find((c) => c.id === open.id) ?? open}
          userId={userId}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
