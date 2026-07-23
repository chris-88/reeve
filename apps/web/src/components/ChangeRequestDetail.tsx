import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitPullRequest, Wrench } from "lucide-react";
import type { Capture, ChangeRequest } from "@reeve/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ResponsiveSheet from "@/components/ResponsiveSheet";
import { Separator } from "@/components/ui/separator";
import { enqueueChangeRequestPatch } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";

/**
 * P1-F11.2: one change request, full screen, in the pattern of CaptureDetail.
 *
 * The drafted body, the source captures quoted, the agent's questions, then
 * Approve / Edit / Reject. Approval is one deliberate tap (F11.3) — the
 * reviewing *is* the confirmation, so there is no second modal. A dialog here
 * would train the reflex this gate exists to prevent.
 */
export default function ChangeRequestDetail({
  changeRequest,
  userId,
  onClose,
}: {
  changeRequest: ChangeRequest;
  userId: string;
  onClose: () => void;
}) {
  const cr = changeRequest;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(cr.title);
  const [body, setBody] = useState(cr.body ?? "");
  const [handoff, setHandoff] = useState(cr.auto_handoff);

  const { data: captures = [] } = useQuery({
    queryKey: ["change-request-captures", cr.id],
    queryFn: async (): Promise<Capture[]> => {
      const { data, error } = await supabase
        .from("change_request_captures")
        .select("captures(*)")
        .eq("change_request_id", cr.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.captures as unknown as Capture).filter(Boolean);
    },
  });

  async function approve() {
    // F7.5: the decision syncs through the outbox; the filing sweeper acts on
    // it server-side. decided_at while status stays 'proposed' is "approved".
    await enqueueChangeRequestPatch(cr.id, userId, {
      decided_at: new Date().toISOString(),
      auto_handoff: handoff,
    });
    onClose();
  }

  async function reject() {
    await enqueueChangeRequestPatch(cr.id, userId, {
      status: "rejected",
      decided_at: new Date().toISOString(),
    });
    onClose();
  }

  async function saveEdit() {
    // F11.2 Edit. Persisted through the same path; the divergence from the
    // agent's draft is worth keeping, like every other user correction.
    await enqueueChangeRequestPatch(cr.id, userId, { title: title.trim(), body: body.trim() });
    setEditing(false);
  }

  return (
    <ResponsiveSheet title={editing ? "Edit" : cr.title} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        {editing ? (
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Body"
              className="min-h-64 resize-none font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void saveEdit()}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTitle(cr.title);
                  setBody(cr.body ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground font-serif leading-relaxed whitespace-pre-wrap">
            {cr.body ?? "No description drafted yet."}
          </p>
        )}

        {cr.questions.length > 0 && (
          <div>
            <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
              Questions the draft left open
            </h3>
            {/*
              F8.5 made visible: the agent surfaces what it could not resolve
              rather than guessing. Reading these before approving is the point.
            */}
            <ul className="mt-2 space-y-1.5">
              {cr.questions.map((q, i) => (
                <li key={i} className="text-foreground/80 flex items-baseline gap-2.5 text-sm">
                  <span aria-hidden className="text-muted-dim">
                    ?
                  </span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Separator />

        <div>
          <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
            From {captures.length === 1 ? "this capture" : `these ${captures.length} captures`}
          </h3>
          <ul className="mt-2 space-y-3">
            {captures.map((c) => (
              <li key={c.id} className="border-border/50 border-l-2 pl-3">
                <p className="text-muted-foreground font-serif text-sm leading-relaxed whitespace-pre-wrap">
                  {c.raw_text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!editing && (
        <div className="border-border/60 pb-safe shrink-0 space-y-3 border-t px-6 pt-4 pb-4">
          {/*
            F9.5: the handoff is opt-in, chosen here at approval time. A toggle,
            not a second screen — approval stays one deliberate tap either way.
          */}
          <button
            type="button"
            onClick={() => setHandoff((h) => !h)}
            aria-pressed={handoff}
            className="text-muted-foreground flex w-full items-center gap-2.5 text-left text-sm"
          >
            <Wrench className={handoff ? "text-foreground size-4" : "size-4"} aria-hidden />
            <span className="flex-1">Ask Claude to build it once filed</span>
            <span
              aria-hidden
              className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${handoff ? "bg-foreground" : "bg-border"}`}
            >
              <span
                className={`bg-background block size-4 rounded-full transition-transform ${handoff ? "translate-x-4" : ""}`}
              />
            </span>
          </button>

          <div className="flex gap-2">
            <Button type="button" variant="default" className="flex-1" onClick={() => void approve()}>
              <GitPullRequest className="size-4" aria-hidden />
              Approve &amp; file
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void reject()}
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}
