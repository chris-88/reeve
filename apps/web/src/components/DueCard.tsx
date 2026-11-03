import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Card, CheckDraw } from "@/components/Card";
import { completeCommitment, reopenCommitment } from "@/lib/commitments";
import { pendingPatch, subscribe, type PendingOp } from "@/lib/outbox";
import type { Message } from "@/lib/thread";
import { supabase } from "@/lib/supabase";
import { dueLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type DueMessage = Extract<Message, { type: "due" }>;

/**
 * E-4: the morning's due list, one tick per item. The notice carries the item
 * ids; the ticks read the items' current status live (and through the outbox,
 * so a tick made with no signal sticks).
 */
export default function DueCard({ m, userId }: { m: DueMessage; userId: string }) {
  const ids = useMemo(() => m.items.map((i) => i.id).filter((i): i is string => !!i), [m.items]);
  const { data: status = {} } = useQuery({
    queryKey: ["commitment-status", ...ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("commitments").select("id, status").in("id", ids);
      return Object.fromEntries(((data ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status]));
    },
  });
  const [pending, setPending] = useState<PendingOp[]>([]);
  useEffect(() => subscribe(setPending), []);

  const items = m.items.map((i) => {
    const s = (i.id && (pendingPatch(pending, i.id)?.status ?? status[i.id])) || "open";
    return { ...i, status: s };
  });
  const open = items.filter((i) => i.status === "open").length;

  return (
    <div className="flex justify-start">
      <Card title={open === 0 ? "All clear for today" : m.items.length === 1 ? "One thing today" : `${open} of ${m.items.length} still to do`} needsYou={open > 0}>
        <ul className="-mx-1 space-y-0.5">
          {items.map((i, idx) => {
            const done = i.status !== "open";
            return (
              <li key={i.id ?? idx}>
                <motion.button
                  type="button"
                  disabled={!i.id}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => i.id && void (done ? reopenCommitment(i.id, userId) : completeCommitment(i.id, userId))}
                  aria-label={`${done ? "Reopen" : "Mark done"}: ${i.text}`}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-1 text-left"
                >
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                      done ? "bg-brand border-brand text-brand-ink" : "border-hair-strong",
                    )}
                  >
                    {done && <CheckDraw className="size-3" />}
                  </span>
                  <span className={cn("min-w-0 flex-1 text-[15px]", done && "text-muted-dim line-through")}>{i.text}</span>
                  <span className="text-muted-dim shrink-0 text-[12px]">{dueLabel(i.due_at)}</span>
                </motion.button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
