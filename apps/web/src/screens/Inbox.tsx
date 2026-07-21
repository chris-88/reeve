import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Area, Capture } from "@reeve/shared";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { subscribe, type PendingCapture } from "@/lib/outbox";
import { cn } from "@/lib/utils";
import CaptureDetail from "@/components/CaptureDetail";

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function Inbox() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<Capture | null>(null);
  const [pending, setPending] = useState<PendingCapture[]>([]);

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

  const { data: captures = [], isLoading } = useQuery({
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

  const used = useMemo(() => {
    const ids = new Set(captures.map((c) => c.corrected_area_id ?? c.area_id));
    return areas.filter((a) => ids.has(a.id));
  }, [areas, captures]);

  return (
    <div className="flex h-full flex-col">
      {used.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-5 py-3">
          <Chip active={filter === null} onClick={() => setFilter(null)} label="All" />
          {used.map((a) => (
            <Chip
              key={a.id}
              active={filter === a.id}
              onClick={() => setFilter(filter === a.id ? null : a.id)}
              label={a.label}
              colour={a.colour}
            />
          ))}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {pending.map((p) => (
          <li key={p.id} className="border-b py-4 opacity-60">
            <div className="flex items-baseline gap-3">
              <span className="bg-border h-2.5 w-2.5 shrink-0 rounded-full" />
              <p className="min-w-0 flex-1 truncate">{p.raw_text}</p>
              <span className="text-muted-foreground shrink-0 text-sm">
                {p.attempts > 0 ? "retrying" : "syncing"}
              </span>
            </div>
          </li>
        ))}

        {visible.map((c) => {
          const area = areaById.get(c.corrected_area_id ?? c.area_id ?? "");
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c)}
                className="w-full border-b py-4 text-left"
              >
                <div className="flex items-baseline gap-3">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: area?.colour ?? "var(--color-border)" }}
                  />
                  <p className="min-w-0 flex-1 truncate font-medium">{c.title ?? c.raw_text}</p>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {relativeTime(c.created_at)}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 pl-[1.4rem]">
                  {c.status === "failed" ? (
                    <span className="text-destructive">Triage failed. Tap to retry.</span>
                  ) : c.status !== "done" ? (
                    <span className="italic">Filing…</span>
                  ) : (
                    <span className="line-clamp-2">{c.summary}</span>
                  )}
                </div>
              </button>
            </li>
          );
        })}

        {!isLoading && visible.length === 0 && pending.length === 0 && (
          <li className="text-muted-foreground py-16 text-center">Nothing captured yet.</li>
        )}
      </ul>

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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  colour?: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full px-4",
        active ? "border-foreground" : "text-muted-foreground",
      )}
    >
      {colour && (
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colour }} />
      )}
      {label}
    </Button>
  );
}
