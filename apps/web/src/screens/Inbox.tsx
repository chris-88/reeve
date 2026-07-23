import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CloudOff, Loader2, PenLine, WifiOff } from "lucide-react";
import type { Area, Capture } from "@reeve/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { captureOps, subscribe, type CaptureOp, type PendingOp } from "@/lib/outbox";
import { useOnline } from "@/lib/useOnline";
import { cn } from "@/lib/utils";
import CaptureDetail from "@/components/CaptureDetail";
import ReeveChangeRequests from "@/components/ReeveChangeRequests";

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** "Today" / "Yesterday" / "Mon 14 Jul" — a capture log reads by day. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

export default function Inbox({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<Capture | null>(null);
  const [pending, setPending] = useState<(PendingOp & { op: CaptureOp })[]>([]);
  const online = useOnline();

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

  const {
    data: captures = [],
    isLoading,
    fetchStatus,
    isSuccess,
  } = useQuery({
    queryKey: ["captures"],
    queryFn: async (): Promise<Capture[]> => {
      const { data, error } = await supabase
        .from("captures")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  // Rows move queued -> processing -> done in place while watching.
  useEffect(() => {
    const channel = supabase
      .channel("captures-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "captures" }, () =>
        qc.invalidateQueries({ queryKey: ["captures"] }),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [qc]);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const visible = useMemo(
    () =>
      filter ? captures.filter((c) => (c.corrected_area_id ?? c.area_id) === filter) : captures,
    [captures, filter],
  );

  const grouped = useMemo(() => {
    const out: { day: string; items: Capture[] }[] = [];
    for (const c of visible) {
      const day = dayLabel(c.created_at);
      const last = out.at(-1);
      if (last?.day === day) last.items.push(c);
      else out.push({ day, items: [c] });
    }
    return out;
  }, [visible]);

  /**
   * Three distinct states, not one.
   *
   * TanStack Query pauses rather than loads when offline, so isLoading is
   * false and execution used to fall straight through to the empty state —
   * telling someone who had been capturing all week that they had nothing.
   */
  /**
   * Trust the browser's connectivity signal, not the query's fetchStatus.
   * After the persisted cache is restored offline, the query can settle to
   * "idle" rather than "paused" — which made this read as online and let the
   * inbox fall through to "Nothing captured yet", the exact failure F2 exists
   * to prevent.
   */
  const offline = !online || fetchStatus === "paused";
  const showingStale = offline && captures.length > 0;
  const nothingYet = isSuccess && captures.length === 0 && !offline;
  const offlineAndEmpty = offline && captures.length === 0;

  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of captures) {
      const id = c.corrected_area_id ?? c.area_id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return areas.filter((a) => counts.has(a.id)).map((a) => ({ ...a, count: counts.get(a.id)! }));
  }, [areas, captures]);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-6 pt-8 pb-3">
        <h1 className="font-serif text-[1.45rem] leading-none font-normal sm:text-[1.75rem]">Inbox</h1>
      </header>

      {used.length > 0 && (
        <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto px-6 pb-3">
          <Chip active={filter === null} onClick={() => setFilter(null)} label="All" count={captures.length} />
          {used.map((a) => (
            <Chip
              key={a.id}
              active={filter === a.id}
              onClick={() => setFilter(filter === a.id ? null : a.id)}
              label={a.label}
              colour={a.colour}
              count={a.count}
            />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {/*
          F11.1: the reeve chip is the entry to changing Reeve. Only here — a
          weekly activity that must not take space from the daily one.
        */}
        {filter === "reeve" && <ReeveChangeRequests userId={userId} reeveCaptures={visible} />}

        {pending.length > 0 && (
          <ul className="mb-2 space-y-1">
            {pending.map((p) => (
              <li
                key={p.id}
                className="border-border/50 bg-card/50 flex items-center gap-3 rounded-xl border border-dashed px-3.5 py-3"
              >
                {!online ? (
                  <CloudOff className="text-muted-foreground size-4 shrink-0" aria-hidden />
                ) : p.deadLettered ? (
                  <CloudOff className="text-destructive size-4 shrink-0" aria-hidden />
                ) : (
                  <Loader2
                    className="text-muted-foreground size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                )}
                <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {p.op.raw_text}
                </p>
              </li>
            ))}
          </ul>
        )}

        {showingStale && (
          <p className="text-muted-dim flex items-center gap-2 pb-2 text-xs">
            <WifiOff className="size-3.5" aria-hidden />
            Offline — showing what was here last.
          </p>
        )}

        {isLoading && !offline && (
          <ul className="space-y-1">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3 py-4">
                <Skeleton className="h-10 w-[3px] shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {grouped.map(({ day, items }) => (
          <section key={day}>
            <h2 className="text-muted-dim bg-bg/80 sticky top-0 z-1 -mx-8 px-8 py-2 text-xs font-semibold tracking-widest uppercase backdrop-blur-md">
              {day}
            </h2>
            <ul>
              {items.map((c) => {
                const area = areaById.get(c.corrected_area_id ?? c.area_id ?? "");
                const settled = c.status === "done";
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(c)}
                      className="hover:bg-card/60 -mx-2 flex w-[calc(100%+1rem)] gap-3.5 rounded-xl px-2 py-3.5 text-left transition-colors"
                    >
                      <span
                        aria-hidden
                        className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
                        style={{ background: area?.colour ?? "var(--color-border)" }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="line-clamp-2 min-w-0 flex-1 font-serif text-[1.05rem] font-normal">
                            {c.title ?? c.raw_text}
                          </span>
                          <span className="text-muted-dim shrink-0 text-xs tabular-nums">
                            {relativeTime(c.created_at)}
                          </span>
                        </span>
                        <span className="text-muted-foreground mt-1 block text-sm leading-snug">
                          {c.status === "failed" ? (
                            <span className="text-destructive inline-flex items-center gap-1.5">
                              <AlertCircle className="size-3.5" aria-hidden />
                              Couldn&rsquo;t file this. Tap to see why.
                            </span>
                          ) : !settled ? (
                            <span className="inline-flex items-center gap-1.5 italic">
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              Filing…
                            </span>
                          ) : (
                            <span className="line-clamp-2">{c.summary}</span>
                          )}
                        </span>
                        {settled && area && (
                          <span
                            className="mt-1.5 inline-block text-[0.7rem] font-medium tracking-wide uppercase"
                            style={{ color: area.colour }}
                          >
                            {area.label}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {offlineAndEmpty && pending.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
            <WifiOff className="text-muted-foreground/40 size-8" strokeWidth={1.5} aria-hidden />
            <p className="text-muted-foreground text-sm">
              Offline, and nothing cached on this device yet. Your captures are safe — they
              will appear once you reconnect.
            </p>
          </div>
        )}

        {nothingYet && visible.length === 0 && pending.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
            <PenLine className="text-muted-foreground/40 size-8" strokeWidth={1.5} aria-hidden />
            <p className="text-muted-foreground text-sm">
              {filter
                ? "Nothing filed here yet."
                : "Nothing captured yet. Anything you write gets filed automatically."}
            </p>
          </div>
        )}
      </div>

      {open && (
        <CaptureDetail
          capture={open}
          areas={areas}
          onClose={() => setOpen(null)}
          onCorrected={() => void qc.invalidateQueries({ queryKey: ["captures"] })}
        />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  colour,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  colour?: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "border-foreground/30 bg-secondary text-foreground"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {colour && (
        <span aria-hidden className="size-2 rounded-full" style={{ background: colour }} />
      )}
      {label}
      <span className="text-muted-dim text-xs tabular-nums">{count}</span>
    </button>
  );
}
