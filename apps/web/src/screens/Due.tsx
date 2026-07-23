import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CloudOff, ListChecks, Settings2, WifiOff } from "lucide-react";
import type { Area, Commitment } from "@reeve/shared";
import { Skeleton } from "@/components/ui/skeleton";
import CommitmentDetail from "@/components/CommitmentDetail";
import Settings from "@/components/Settings";
import { supabase } from "@/lib/supabase";
import { enqueueCommitmentPatch, pendingPatch, subscribe, type PendingOp } from "@/lib/outbox";
import { useOnline } from "@/lib/useOnline";
import { cn } from "@/lib/utils";

/**
 * P1-F2.1: grouped by urgency, not by area.
 *
 * Area stays the colour signal per docs/spec.md §7, but it is not the axis
 * here — the question this screen answers is "what do I owe, and when", and
 * that question is about time.
 */
const BUCKETS = ["Overdue", "Today", "This week", "Later", "No date"] as const;
type Bucket = (typeof BUCKETS)[number];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function bucketFor(dueAt: string | null, now: Date): Bucket {
  if (!dueAt) return "No date";
  const day = startOfDay(new Date(dueAt));
  const today = startOfDay(now);
  if (day < today) return "Overdue";
  if (day === today) return "Today";
  // Date arithmetic rather than today + 7 * 86_400_000: an hour of drift
  // across a clock change would put a Monday in the wrong group.
  const weekEnd = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  return day < weekEnd ? "This week" : "Later";
}

function dueLabel(dueAt: string | null, dueText: string | null): string | null {
  if (!dueAt) return dueText;
  return new Date(dueAt).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

export default function Due({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Commitment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState<PendingOp[]>([]);
  const online = useOnline();

  useEffect(() => subscribe(setPending), []);

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
    data: rows = [],
    isLoading,
    isSuccess,
  } = useQuery({
    queryKey: ["commitments"],
    queryFn: async (): Promise<Commitment[]> => {
      const { data, error } = await supabase
        .from("commitments")
        .select("*")
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  // Rows appear as captures are triaged, and change when another device acts.
  useEffect(() => {
    const channel = supabase
      .channel("commitments-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "commitments" }, () =>
        qc.invalidateQueries({ queryKey: ["commitments"] }),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [qc]);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  /**
   * P1-F2.4: the optimistic layer.
   *
   * Queued changes are laid over the server rows rather than written into the
   * query cache, so the thing on screen is the thing in the outbox. That is
   * what makes an unsynced completion survive a cold launch instead of
   * reappearing as undone — the state lives in IndexedDB, not in memory.
   *
   * There is no rollback. A durable queue keeps retrying, and reverting a tap
   * the user made hours ago in a field with no signal would be the data loss
   * the outbox exists to prevent.
   */
  const settled = useMemo(
    () => rows.map((c) => ({ ...c, ...pendingPatch(pending, c.id) }) as Commitment),
    [rows, pending],
  );

  const openItems = useMemo(() => settled.filter((c) => c.status === "open"), [settled]);

  const grouped = useMemo(() => {
    const now = new Date();
    const byBucket = new Map<Bucket, Commitment[]>();
    for (const c of openItems) {
      const bucket = bucketFor(c.due_at, now);
      const list = byBucket.get(bucket);
      if (list) list.push(c);
      else byBucket.set(bucket, [c]);
    }
    return BUCKETS.filter((b) => byBucket.has(b)).map((b) => ({ bucket: b, items: byBucket.get(b)! }));
  }, [openItems]);

  const stuck = pending.some((p) => p.op.kind === "commitment" && p.deadLettered);

  /**
   * Three states, not one — the same distinction the Inbox draws, and for the
   * same reason: telling someone with a week of commitments that they have
   * none is worse than telling them the network is down.
   */
  const offline = !online;
  const nothingDue = isSuccess && openItems.length === 0 && !offline;
  const offlineAndEmpty = offline && settled.length === 0;

  function complete(c: Commitment) {
    void enqueueCommitmentPatch(c.id, userId, {
      status: "done",
      completed_at: new Date().toISOString(),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline justify-between px-6 pt-8 pb-3">
        <h1 className="font-serif text-[1.45rem] leading-none font-normal sm:text-[1.75rem]">Due</h1>
        {/*
          One icon, on the screen about being told things. Settings has no home
          in a three-screen app and this is the least intrusive one that exists
          — it is also where sign-out belongs when hardening F10 lands.
        */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="text-muted-dim hover:text-foreground -mr-2 p-2 transition-colors"
        >
          <Settings2 className="size-5" strokeWidth={1.8} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {offline && settled.length > 0 && (
          <p className="text-muted-dim flex items-center gap-2 pb-2 text-xs">
            <WifiOff className="size-3.5" aria-hidden />
            Offline — changes are saved here and will sync.
          </p>
        )}

        {stuck && (
          <p className="text-muted-foreground flex items-center gap-2 pb-2 text-xs">
            <CloudOff className="text-destructive size-3.5" aria-hidden />
            Some changes haven&rsquo;t synced yet. They&rsquo;re saved on this device.
          </p>
        )}

        {isLoading && !offline && (
          <ul className="space-y-1">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-3 py-4">
                <Skeleton className="size-5 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {grouped.map(({ bucket, items }) => (
          <section key={bucket}>
            <h2
              className={cn(
                "bg-bg/80 sticky top-0 z-1 -mx-8 px-8 py-2 text-xs font-semibold tracking-widest uppercase backdrop-blur-md",
                bucket === "Overdue" ? "text-destructive" : "text-muted-dim",
              )}
            >
              {bucket}
            </h2>
            <ul>
              {items.map((c) => {
                const area = areaById.get(c.area_id ?? "");
                const label = dueLabel(c.due_at, c.due_text);
                return (
                  <li key={c.id} className="flex items-start gap-1">
                    {/*
                      P1-F2.2: complete is one tap, at the leading edge where a
                      thumb already is. Generously padded rather than visually
                      large — this gets used with gloves on.
                    */}
                    <button
                      type="button"
                      onClick={() => complete(c)}
                      aria-label={`Mark done: ${c.text}`}
                      className="group -ml-2 shrink-0 p-3.5"
                    >
                      <span className="border-muted-foreground/50 group-hover:border-foreground group-hover:bg-foreground/5 flex size-5 items-center justify-center rounded-full border transition-colors">
                        <Check
                          className="text-foreground size-3 opacity-0 transition-opacity group-hover:opacity-60"
                          strokeWidth={3}
                          aria-hidden
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOpen(c)}
                      className="hover:bg-card/60 -mr-2 min-w-0 flex-1 rounded-xl px-2 py-3.5 text-left transition-colors"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 font-serif text-[1.05rem] leading-snug font-normal">
                          {c.text}
                        </span>
                        {label && (
                          <span
                            className={cn(
                              "shrink-0 text-xs tabular-nums",
                              bucket === "Overdue" ? "text-destructive" : "text-muted-dim",
                            )}
                          >
                            {label}
                          </span>
                        )}
                      </span>
                      {area && (
                        <span
                          className="mt-1 inline-block text-[0.7rem] font-medium tracking-wide uppercase"
                          style={{ color: area.colour }}
                        >
                          {area.label}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {offlineAndEmpty && (
          <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
            <WifiOff className="text-muted-foreground/40 size-8" strokeWidth={1.5} aria-hidden />
            <p className="text-muted-foreground text-sm">
              Offline, and nothing cached on this device yet.
            </p>
          </div>
        )}

        {/*
          P1-F2.7: owing nobody anything is a good outcome and reads as one.
          It is not an error, and it is not an invitation to add a task —
          commitments are earned from captures, not typed in here.
        */}
        {nothingDue && (
          <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
            <ListChecks className="text-muted-foreground/40 size-8" strokeWidth={1.5} aria-hidden />
            <p className="text-muted-foreground text-sm">
              Nothing outstanding. Anything you say you&rsquo;ll do turns up here.
            </p>
          </div>
        )}
      </div>

      {open && (
        <CommitmentDetail
          commitment={settled.find((c) => c.id === open.id) ?? open}
          userId={userId}
          onClose={() => setOpen(null)}
        />
      )}

      {settingsOpen && <Settings userId={userId} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
