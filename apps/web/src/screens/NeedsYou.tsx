import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCheck,
  CloudOff,
  Loader2,
  Pin,
  Search,
  X,
} from "lucide-react";
import type { Action, Area, Capture } from "@reeve/shared";
import { NEEDS_YOU_STATUSES } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { captureOps, subscribe, type CaptureOp, type PendingOp } from "@/lib/outbox";
import {
  ACTIONS_QK,
  DISPATCHED_QK,
  approveAction,
  declineAction,
  goAction,
  orderActions,
} from "@/lib/actions";
import { useOnline } from "@/lib/useOnline";
import CaptureDetail from "@/components/CaptureDetail";
import CaptureSearch from "@/components/CaptureSearch";
import ActionDetail from "@/components/ActionDetail";

/**
 * AQ-2: the "Needs you" stream — the middle of the app, replacing the Inbox tab.
 *
 * Not a workspace. A stream of the two things that need a human judgment: a
 * proposed action to approve/tweak/decline, and an agent result to
 * approve/redo. AI-ordered (AQ-3); nothing is dragged. Empty means caught up.
 */
export default function NeedsYou() {
  const qc = useQueryClient();
  const online = useOnline();
  const [openAction, setOpenAction] = useState<Action | null>(null);
  const [openCapture, setOpenCapture] = useState<Capture | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<(PendingOp & { op: CaptureOp })[]>([]);
  useEffect(() => subscribe((items) => setPending(captureOps(items))), []);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    staleTime: Infinity,
    queryFn: async (): Promise<Area[]> => {
      const { data, error } = await supabase.from("areas").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const { data: actions = [] } = useQuery({
    queryKey: ACTIONS_QK,
    queryFn: async (): Promise<Action[]> => {
      const { data, error } = await supabase
        .from("actions")
        .select("*")
        .is("archived_at", null)
        .in("status", NEEDS_YOU_STATUSES as unknown as string[]);
      if (error) throw error;
      return data;
    },
  });

  // In flight: actions handed to an agent, waiting on the work — not on you.
  // A quiet status list, not a decision (§3).
  const { data: dispatched = [] } = useQuery({
    queryKey: DISPATCHED_QK,
    queryFn: async (): Promise<Action[]> => {
      const { data, error } = await supabase
        .from("actions")
        .select("*")
        .is("archived_at", null)
        .eq("status", "dispatched")
        .order("dispatched_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Captures still triaging or failed — they surface at the top until they
  // become actions (or fail), the way the old Inbox showed them.
  const { data: inflight = [] } = useQuery({
    queryKey: ["inflight-captures"],
    refetchInterval: 5000,
    queryFn: async (): Promise<Capture[]> => {
      const { data, error } = await supabase
        .from("captures")
        .select("*")
        .is("archived_at", null)
        .in("status", ["queued", "processing", "failed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Due dates for ordering: the soonest open commitment per capture.
  const { data: dueByCapture = new Map<string, string>() } = useQuery({
    queryKey: ["needs-you-due"],
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("commitments")
        .select("capture_id, due_at, status")
        .eq("status", "open")
        .not("due_at", "is", null);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const c of data as { capture_id: string; due_at: string }[]) {
        const existing = map.get(c.capture_id);
        if (!existing || c.due_at < existing) map.set(c.capture_id, c.due_at);
      }
      return map;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("needs-you-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "actions" }, () => {
        void qc.invalidateQueries({ queryKey: ACTIONS_QK });
        void qc.invalidateQueries({ queryKey: DISPATCHED_QK });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "captures" }, () => {
        void qc.invalidateQueries({ queryKey: ["inflight-captures"] });
      })
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [qc]);

  const ordered = useMemo(() => orderActions(actions, dueByCapture), [actions, dueByCapture]);
  const caughtUp = ordered.length === 0 && inflight.length === 0 && pending.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline justify-between px-6 pt-8 pb-3">
        <h1 className="font-serif text-[1.45rem] leading-none font-normal sm:text-[1.75rem]">
          Needs you
        </h1>
        <button
          type="button"
          onClick={() => setSearching(true)}
          aria-label="Search all captures"
          className="text-muted-dim hover:text-foreground -mr-1 self-center p-1.5"
        >
          <Search className="size-5" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {/* Local, unsent captures. */}
        {pending.length > 0 && (
          <ul className="mb-2 space-y-1">
            {pending.map((p) => (
              <li
                key={p.id}
                className="border-border/50 bg-card/50 flex items-center gap-3 rounded-xl border border-dashed px-3.5 py-3"
              >
                {!online ? (
                  <CloudOff className="text-muted-foreground size-4 shrink-0" aria-hidden />
                ) : (
                  <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />
                )}
                <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {p.op.raw_text}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* Captures still triaging or failed. */}
        {inflight.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenCapture(c)}
            className="hover:bg-card/60 -mx-2 mb-1 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
          >
            {c.status === "failed" ? (
              <AlertCircle className="text-destructive size-4 shrink-0" aria-hidden />
            ) : (
              <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-sm">{c.title ?? c.raw_text}</span>
              <span className="text-muted-dim text-xs">
                {c.status === "failed" ? "Couldn't file this — tap to retry" : "Filing…"}
              </span>
            </span>
          </button>
        ))}

        <ul className="mt-1">
          {ordered.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              area={areaById.get(a.area_id ?? "")}
              due={dueByCapture.get(a.capture_id)}
              onOpen={() => setOpenAction(a)}
              onGo={() => void goAction(qc, a, areaById.get(a.area_id ?? ""))}
              onDecline={() => void declineAction(qc, a)}
              onApprove={() => void approveAction(qc, a)}
            />
          ))}
        </ul>

        {caughtUp && dispatched.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
            <CheckCheck className="text-muted-foreground/40 size-8" strokeWidth={1.5} aria-hidden />
            <p className="text-muted-foreground text-sm">You&rsquo;re all caught up.</p>
          </div>
        )}

        {dispatched.length > 0 && (
          <section className="mt-8">
            <h2 className="text-muted-dim py-2 text-xs font-semibold tracking-widest uppercase">
              In flight
            </h2>
            <ul>
              {dispatched.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setOpenAction(a)}
                    className="hover:bg-card/60 -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors"
                  >
                    <Loader2 className="text-muted-dim size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm">{a.title}</span>
                      <span className="text-muted-dim text-xs">With an agent</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {openAction && (
        <ActionDetail action={openAction} areas={areas} onClose={() => setOpenAction(null)} />
      )}
      {openCapture && (
        <CaptureDetail
          capture={openCapture}
          areas={areas}
          onClose={() => setOpenCapture(null)}
          onCorrected={() => void qc.invalidateQueries({ queryKey: ["inflight-captures"] })}
        />
      )}
      {searching && <CaptureSearch areas={areas} onClose={() => setSearching(false)} />}
    </div>
  );
}

function ActionRow({
  action,
  area,
  due,
  onOpen,
  onGo,
  onDecline,
  onApprove,
}: {
  action: Action;
  area: Area | undefined;
  due: string | undefined;
  onOpen: () => void;
  onGo: () => void;
  onDecline: () => void;
  onApprove: () => void;
}) {
  const proposed = action.status === "proposed";
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-card/60 -ml-2 flex min-w-0 flex-1 gap-3.5 rounded-xl px-2 py-3.5 text-left transition-colors"
      >
        <span
          aria-hidden
          className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
          style={{ background: area?.colour ?? "var(--color-border)" }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {action.pinned_at && <Pin className="text-foreground size-3 shrink-0" aria-hidden />}
            <span className="line-clamp-2 min-w-0 flex-1 font-serif text-[1.05rem]">
              {action.title}
            </span>
          </span>
          <span className="text-muted-foreground mt-1 block text-sm">
            {proposed ? "Reeve suggests doing this" : "A result is ready to review"}
          </span>
          {(area || due) && (
            <span className="mt-1.5 flex items-center gap-2">
              {area && (
                <span
                  className="text-[0.7rem] font-medium tracking-wide uppercase"
                  style={{ color: area.colour }}
                >
                  {area.label}
                </span>
              )}
              {due && <span className="text-muted-dim text-[0.7rem] tabular-nums">{dueLabel(due)}</span>}
            </span>
          )}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 pl-1">
        {proposed ? (
          <>
            <RowAction label={`Send "${action.title}" to an agent`} onClick={onGo}>
              <ArrowRight className="size-4" aria-hidden />
            </RowAction>
            <RowAction label={`File "${action.title}" as just a note`} onClick={onDecline}>
              <X className="size-4" aria-hidden />
            </RowAction>
          </>
        ) : (
          <RowAction label={`Approve the result for "${action.title}"`} onClick={onApprove}>
            <Check className="size-4" aria-hidden />
          </RowAction>
        )}
      </span>
    </li>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-muted-dim hover:text-foreground hover:bg-card/60 rounded-lg p-2 transition-colors"
    >
      {children}
    </button>
  );
}

function dueLabel(iso: string): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(d) - midnight(new Date())) / 86_400_000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}
