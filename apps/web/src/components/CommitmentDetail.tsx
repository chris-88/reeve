import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { Capture, Commitment } from "@reeve/shared";
import { dueAtFromDate } from "@reeve/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ResponsiveSheet from "@/components/ResponsiveSheet";
import { Separator } from "@/components/ui/separator";
import { enqueueCommitmentPatch, type CommitmentPatch } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";

/** A timestamptz back to the YYYY-MM-DD an <input type="date"> wants. */
function dateInputValue(dueAt: string | null): string {
  return dueAt ? dueAt.slice(0, 10) : "";
}

/**
 * One commitment, full screen.
 *
 * P1-F2.5: the source capture is here rather than a tap away. A commitment
 * read without the words it came from is frequently ambiguous — "chase the
 * quote" is three different jobs depending on the note it was lifted from.
 */
export default function CommitmentDetail({
  commitment,
  userId,
  onClose,
}: {
  commitment: Commitment;
  userId: string;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(commitment.text);
  const [due, setDue] = useState(dateInputValue(commitment.due_at));

  const { data: capture } = useQuery({
    queryKey: ["captures", commitment.capture_id],
    queryFn: async (): Promise<Capture> => {
      const { data, error } = await supabase
        .from("captures")
        .select("*")
        .eq("id", commitment.capture_id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  async function queue(patch: CommitmentPatch) {
    await enqueueCommitmentPatch(commitment.id, userId, patch);
    onClose();
  }

  const changed = text.trim() !== commitment.text || due !== dateInputValue(commitment.due_at);

  /**
   * P1-F2.6: an edit sets origin = 'user'.
   *
   * due_text is deliberately not rewritten. It is what Chris actually said,
   * and the gap between that and the date he ended up choosing is evidence
   * about how well dates are being resolved — the same argument that keeps
   * corrected_area_id alongside area_id rather than replacing it.
   */
  async function save() {
    if (!changed || !text.trim()) return;
    await queue({
      text: text.trim(),
      due_at: dueAtFromDate(due || null),
      origin: "user",
    });
  }

  return (
    <ResponsiveSheet title={commitment.text} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <div>
          <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
            Due
          </h3>

          {!editing ? (
            <div className="mt-2.5 flex items-center gap-3">
              <span className="text-[1.05rem]">
                {commitment.due_at
                  ? new Date(commitment.due_at).toLocaleDateString("en-IE", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : "No date"}
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-muted-dim hover:text-foreground text-sm underline underline-offset-4"
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="mt-2.5 space-y-3">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="What you said you would do"
                className="min-h-20 resize-none"
              />
              <Input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!changed || !text.trim()}
                  onClick={() => void save()}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setText(commitment.text);
                    setDue(dateInputValue(commitment.due_at));
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {commitment.due_text && (
            <p className="text-muted-dim mt-2 text-sm">
              You said &ldquo;{commitment.due_text}&rdquo;.
            </p>
          )}
        </div>

        <Separator />

        <div>
          <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
            What you said
          </h3>
          <p className="text-muted-foreground mt-2 font-serif leading-relaxed whitespace-pre-wrap">
            {capture?.raw_text ?? "…"}
          </p>
        </div>

        {/*
          Dropping is not deleting. The row moves to status 'dropped' and stays
          — a record of what was decided against is evidence, and the schema
          has no delete policy to make the point structural.
        */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => void queue({ status: "dropped" })}
          className="text-muted-foreground hover:text-destructive w-full justify-start px-0"
        >
          <Trash2 className="size-4" aria-hidden />
          I&rsquo;m not doing this
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
