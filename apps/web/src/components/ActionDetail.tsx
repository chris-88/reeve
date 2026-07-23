import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Pin, RotateCcw } from "lucide-react";
import type { Action, Area, Capture } from "@reeve/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ResponsiveSheet from "@/components/ResponsiveSheet";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase";
import {
  ACTIONS_QK,
  approveAction,
  declineAction,
  goAction,
  markDone,
  markResultReady,
  redoAction,
  togglePin,
} from "@/lib/actions";

/**
 * The decision surface for one action (AQ-2). The same ResponsiveSheet the rest
 * of the app uses. A proposed action offers Go / Tweak / Just-a-note; a returned
 * result offers Approve / Redo — the same language, two uses.
 */
export default function ActionDetail({
  action,
  areas,
  onClose,
}: {
  action: Action;
  areas: Area[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const area = areas.find((a) => a.id === action.area_id);

  const { data: capture } = useQuery({
    queryKey: ["capture", action.capture_id],
    queryFn: async (): Promise<Capture | null> => {
      const { data, error } = await supabase
        .from("captures")
        .select("*")
        .eq("id", action.capture_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Tweak (AQ-2): edit what Reeve proposes and the capture's own note.
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(action.title);
  const [brief, setBrief] = useState(action.brief ?? "");
  const [capTitle, setCapTitle] = useState("");
  const [capSummary, setCapSummary] = useState("");
  const [saving, setSaving] = useState(false);
  // AQ-5 (manual scaffold): the result an agent handed back, pasted by hand
  // until dispatch and return are automated (spec.md §9).
  const [result, setResult] = useState("");

  function startTweak() {
    setTitle(action.title);
    setBrief(action.brief ?? "");
    setCapTitle(capture?.title ?? "");
    setCapSummary(capture?.summary ?? "");
    setEditing(true);
  }

  async function saveTweak() {
    setSaving(true);
    const { error } = await supabase
      .from("actions")
      .update({ title: title.trim() || action.title, brief: brief.trim() || null })
      .eq("id", action.id);
    if (!error && capture) {
      await supabase
        .from("captures")
        .update({ title: capTitle.trim() || null, summary: capSummary.trim() || null })
        .eq("id", capture.id);
    }
    setSaving(false);
    if (error) return;
    void qc.invalidateQueries({ queryKey: ACTIONS_QK });
    void qc.invalidateQueries({ queryKey: ["capture", action.capture_id] });
    setEditing(false);
  }

  async function go() {
    onClose();
    await goAction(qc, action, area);
  }

  const proposed = action.status === "proposed";
  const review = action.status === "review";
  const dispatched = action.status === "dispatched";

  return (
    <ResponsiveSheet title={editing ? "Tweak" : action.title} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
        {editing ? (
          <div className="space-y-4">
            <Field label="What Reeve should do">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Brief for the agent (optional)">
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Left blank, Reeve assembles one from the capture."
                className="min-h-24"
              />
            </Field>
            <Separator />
            <Field label="Note title">
              <Input value={capTitle} onChange={(e) => setCapTitle(e.target.value)} />
            </Field>
            <Field label="Note summary">
              <Textarea
                value={capSummary}
                onChange={(e) => setCapSummary(e.target.value)}
                className="min-h-20"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={saving} onClick={() => void saveTweak()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {review && action.result && (
              <div className="border-border/60 bg-card/40 rounded-xl border p-4">
                <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
                  What came back
                </h3>
                <p className="mt-2 font-serif leading-relaxed whitespace-pre-wrap">
                  {action.result}
                </p>
              </div>
            )}

            {capture?.summary && !review && (
              <p className="font-serif text-[1.15rem] leading-relaxed">{capture.summary}</p>
            )}

            {/* The decisions. Proposed → Go / Tweak / Just a note; review → Approve / Redo. */}
            <div className="flex flex-wrap gap-2">
              {proposed && (
                <>
                  <Button type="button" size="sm" onClick={() => void go()}>
                    <ArrowRight className="size-4" aria-hidden /> Go
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={startTweak}>
                    Tweak
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onClose();
                      void declineAction(qc, action);
                    }}
                  >
                    Just a note
                  </Button>
                </>
              )}
              {review && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onClose();
                      void approveAction(qc, action);
                    }}
                  >
                    <Check className="size-4" aria-hidden /> Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onClose();
                      void redoAction(qc, action);
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden /> Redo
                  </Button>
                </>
              )}
              {(proposed || review) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={action.pinned_at != null}
                  onClick={() => void togglePin(qc, action)}
                >
                  <Pin className="size-4" aria-hidden />
                  {action.pinned_at ? "Unpin" : "Do next"}
                </Button>
              )}
            </div>

            {dispatched && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  With an agent. When it comes back, paste the result to review it — or just mark
                  it done. (Agents return work automatically once real dispatch ships; until then
                  this is by hand.)
                </p>
                <Textarea
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  placeholder="Paste what the agent produced…"
                  className="min-h-24"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!result.trim()}
                    onClick={() => {
                      onClose();
                      void markResultReady(qc, action, result);
                    }}
                  >
                    Save for review
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onClose();
                      void markDone(qc, action);
                    }}
                  >
                    <Check className="size-4" aria-hidden /> Mark done
                  </Button>
                </div>
                {action.brief && (
                  <details>
                    <summary className="text-muted-dim cursor-pointer text-sm">
                      The brief you sent
                    </summary>
                    <p className="text-muted-foreground mt-2 font-serif text-sm leading-relaxed whitespace-pre-wrap">
                      {action.brief}
                    </p>
                  </details>
                )}
              </div>
            )}

            {area && (
              <div>
                <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
                  Area
                </h3>
                <span className="border-foreground/30 bg-secondary mt-2 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: area.colour }} />
                  {area.label}
                </span>
              </div>
            )}

            {capture?.raw_text && (
              <>
                <Separator />
                <div>
                  <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
                    What you said
                  </h3>
                  <p className="text-muted-foreground mt-2 font-serif leading-relaxed whitespace-pre-wrap">
                    {capture.raw_text}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ResponsiveSheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
        {label}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
