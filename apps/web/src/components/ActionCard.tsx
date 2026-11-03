import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, ChevronDown, Copy, RotateCcw } from "lucide-react";
import type { Area } from "@reeve/shared";
import { Bubble, Dots } from "@/components/Bubble";
import { Card, CardButton, CheckDraw } from "@/components/Card";
import {
  approveAction,
  copyBrief,
  declineAction,
  dropAction,
  handToReeve,
  redoAction,
  retryAction,
  type ActionMessage,
} from "@/lib/actions";
import { collapsedLine, splitResult } from "@/lib/thread";
import { timeOf } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * E-4: one action is one message that changes state in place.
 *
 *   proposed   card    "I could …. Want me to?"        Hand to Reeve · Not now
 *   working    bubble  "On it."                        —
 *   result     card    what I did / where / for you    Approve · Redo…
 *   failed     card    "I couldn't finish this: …"     Try again · Drop it
 *   decomposed card    what it created                 Got it
 *   done/declined      one quiet line, tap to expand
 *
 * The transitions animate by layout: the card grows from the bubble when the
 * result lands, and folds to its line on Approve with the content fading first.
 */
export default function ActionCard({
  m,
  userId,
  area,
  onHanded,
  onJump,
}: {
  m: ActionMessage;
  userId: string;
  area: Area | undefined;
  /** The first Hand to Reeve may be followed by the notification ask (PN-4). */
  onHanded: () => void;
  onJump: (messageId: string) => void;
}) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [redoing, setRedoing] = useState(false);
  const [note, setNote] = useState("");
  const [approving, setApproving] = useState(false);
  const needsYou = m.state === "proposed" || m.state === "result" || m.state === "failed" || m.state === "decomposed";

  const line = collapsedLine(m, timeOf);
  const domainChip = area ? (
    <span className="text-muted-dim ml-2 text-[12px] font-normal">{area.label}</span>
  ) : null;

  if (m.state === "working") {
    return (
      <motion.div layoutId={reduce ? undefined : `action-${m.actionId}`} className="flex justify-start">
        <Bubble from="reeve" quiet>
          <span className="flex items-center gap-2.5">
            On it. <Dots />
          </span>
          <span className="text-muted-dim mt-0.5 block text-[13px] font-sans">{m.title}</span>
        </Bubble>
      </motion.div>
    );
  }

  if (line && !expanded) {
    return (
      <motion.button
        layoutId={reduce ? undefined : `action-${m.actionId}`}
        type="button"
        onClick={() => setExpanded(true)}
        className="text-muted-dim flex items-center gap-1.5 py-1 text-[13px]"
        aria-label={`${line}: ${m.title}. Tap to expand.`}
      >
        {m.state === "done" && <CheckDraw className="text-brand size-3.5" />}
        <span className="font-medium">{line}</span>
        <span className="truncate">· {m.title}</span>
        <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden />
      </motion.button>
    );
  }

  async function approve() {
    setApproving(true);
    await new Promise((r) => setTimeout(r, reduce ? 0 : 260));
    await approveAction(qc, m, userId);
    setApproving(false);
  }

  const result = m.result ? splitResult(m.result) : null;

  return (
    <motion.div layoutId={reduce ? undefined : `action-${m.actionId}`} className="flex justify-start">
      <Card
        title={
          <span className="flex items-baseline">
            <span className="min-w-0 flex-1">{m.title}</span>
            {domainChip}
          </span>
        }
        needsYou={needsYou}
        onPress={line ? () => setExpanded(false) : undefined}
        actions={
          <AnimatePresence initial={false}>
            {m.state === "proposed" && (
              <>
                <CardButton primary onClick={() => void handToReeve(qc, m, userId, area).then(onHanded)}>
                  <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
                  Hand to Reeve
                </CardButton>
                <CardButton onClick={() => void declineAction(qc, m, userId)}>Not now</CardButton>
              </>
            )}
            {m.state === "result" && !redoing && (
              <>
                <CardButton primary onClick={() => void approve()} disabled={approving}>
                  {approving ? <CheckDraw /> : null}
                  Approve
                </CardButton>
                <CardButton onClick={() => setRedoing(true)}>
                  <RotateCcw className="size-4" strokeWidth={1.5} aria-hidden />
                  Redo…
                </CardButton>
                <span className="flex-1" />
                <CardButton ariaLabel="Copy the brief" onClick={() => void copyBrief(m)}>
                  <Copy className="size-4" strokeWidth={1.5} aria-hidden />
                </CardButton>
              </>
            )}
            {m.state === "failed" && (
              <>
                <CardButton primary onClick={() => void retryAction(qc, m, userId)}>
                  Try again
                </CardButton>
                <CardButton onClick={() => void dropAction(qc, m, userId)}>Drop it</CardButton>
              </>
            )}
            {m.state === "decomposed" && (
              <CardButton primary onClick={() => void approve()} disabled={approving}>
                {approving ? <CheckDraw /> : null}
                Got it
              </CardButton>
            )}
          </AnimatePresence>
        }
      >
        <motion.div animate={{ opacity: approving ? 0.3 : 1 }} transition={{ duration: 0.2 }}>
          {m.state === "proposed" && <p className="voice">Want me to?</p>}

          {(m.state === "result" || m.state === "done") && result && (
            <div className="space-y-2">
              {result.did && <p className="voice">{result.did}</p>}
              {result.rest && <p className="voice whitespace-pre-wrap">{result.rest}</p>}
              {result.where.length > 0 && (
                <ul className="text-muted space-y-0.5 text-[13px]">
                  {result.where.map((w) => (
                    <li key={w} className="truncate font-mono text-[12px]">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              {result.forYou && <p className="text-muted text-[14px]">{result.forYou}</p>}
            </div>
          )}

          {m.state === "failed" && (
            <p className="voice">
              I couldn't finish this
              {m.result ? `: ${m.result.replace(/^Reeve could not complete this:?\s*/i, "")}` : "."}
            </p>
          )}

          {m.state === "decomposed" && <Decomposition m={m} onJump={onJump} />}

          {m.state === "declined" && <p className="text-muted text-[14px]">{m.brief ? m.brief.split("\n")[0] : "Left as a note."}</p>}

          <AnimatePresence initial={false}>
            {redoing && (
              <motion.form
                key="redo"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
                onSubmit={(e) => {
                  e.preventDefault();
                  void redoAction(qc, m, userId, note).then(() => setRedoing(false));
                }}
              >
                <label className="mt-3 flex items-end gap-1 rounded-[14px] border border-hair-strong pr-1 pl-3">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What should change?"
                    aria-label="What should change on the next pass"
                    className="min-h-[40px] flex-1 bg-transparent text-[15px] outline-none"
                  />
                  <button
                    type="submit"
                    aria-label="Send the note and redo"
                    className={cn("bg-brand text-brand-ink mb-1 grid size-8 place-items-center rounded-full", !note.trim() && "opacity-40")}
                  >
                    <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                </label>
                <button type="button" onClick={() => setRedoing(false)} className="text-muted-dim mt-1 text-[13px]">
                  Cancel
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </Card>
    </motion.div>
  );
}

/** E-4: "That was six things. I've proposed four actions and set two reminders:" */
function Decomposition({ m, onJump }: { m: ActionMessage; onJump: (messageId: string) => void }) {
  const { data } = useQuery({
    queryKey: ["decomposition", m.captureId],
    queryFn: async () => {
      const [a, c] = await Promise.all([
        supabase.from("actions").select("id, title, status").eq("capture_id", m.captureId).neq("kind", "decompose").order("created_at"),
        supabase.from("commitments").select("id, text, due_at").eq("capture_id", m.captureId).order("created_at"),
      ]);
      return {
        actions: (a.data ?? []) as { id: string; title: string; status: string }[],
        commitments: (c.data ?? []) as { id: string; text: string; due_at: string | null }[],
      };
    },
  });
  const n = (data?.actions.length ?? 0) + (data?.commitments.length ?? 0);
  return (
    <div className="space-y-2">
      <p className="voice">
        {n > 0
          ? `That was ${n} thing${n === 1 ? "" : "s"}. I've proposed ${data?.actions.length ?? 0} action${data?.actions.length === 1 ? "" : "s"} and set ${data?.commitments.length ?? 0} reminder${data?.commitments.length === 1 ? "" : "s"}:`
          : (m.result ?? "")}
      </p>
      {data && (
        <ul className="space-y-1 text-[14px]">
          {data.actions.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onJump(`action:${a.id}`)} className="text-left underline-offset-4 hover:underline">
                {a.title}
              </button>
            </li>
          ))}
          {data.commitments.map((c) => (
            <li key={c.id} className="text-muted">
              {c.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
