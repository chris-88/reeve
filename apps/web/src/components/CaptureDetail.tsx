import { useState } from "react";
import type { Area, Capture, Entities } from "@reeve/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const ENTITY_LABELS: Record<keyof Entities, string> = {
  people: "People",
  dates: "Dates",
  commitments: "Commitments",
  amounts: "Amounts",
  orgs: "Organisations",
};

export default function CaptureDetail({
  capture,
  areas,
  onClose,
  onCorrected,
}: {
  capture: Capture;
  areas: Area[];
  onClose: () => void;
  onCorrected: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = capture.corrected_area_id ?? capture.area_id;

  /**
   * Re-filing writes corrected_area_id rather than overwriting area_id. The gap
   * between what the model chose and what the user chose is the only honest signal
   * we have about whether the taxonomy is right — don't destroy it.
   */
  async function correct(areaId: string) {
    if (areaId === current) return;
    setSaving(true);
    await supabase
      .from("captures")
      .update({ corrected_area_id: areaId, corrected_at: new Date().toISOString() })
      .eq("id", capture.id);
    setSaving(false);
    onCorrected();
    onClose();
  }

  const entities = capture.entities;
  const populated = entities
    ? (Object.entries(entities) as [keyof Entities, string[]][]).filter(([, v]) => v.length)
    : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[85vh] sm:max-w-lg sm:rounded-xl"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle className="truncate pr-8 text-lg">
            {capture.title ?? "Capture"}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-6">
          {capture.summary && <p className="text-lg leading-relaxed">{capture.summary}</p>}

          {capture.status === "failed" && (
            <p role="alert" className="border-destructive/40 text-destructive rounded-xl border p-4">
              Triage failed{capture.error ? `: ${capture.error}` : ""}.
            </p>
          )}

          {populated.map(([key, values]) => (
            <div key={key}>
              <h3 className="text-muted-foreground text-sm tracking-wide uppercase">
                {ENTITY_LABELS[key]}
              </h3>
              <ul className="mt-1 space-y-1">
                {values.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="text-muted-foreground text-sm tracking-wide uppercase">Area</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {areas
                .filter((a) => a.active)
                .map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    variant={a.id === current ? "secondary" : "outline"}
                    size="sm"
                    disabled={saving}
                    onClick={() => void correct(a.id)}
                    aria-pressed={a.id === current}
                    className={cn(
                      "rounded-full px-4",
                      a.id === current ? "border-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ background: a.colour }}
                    />
                    {a.label}
                  </Button>
                ))}
            </div>
            {capture.corrected_area_id && (
              <p className="text-muted-foreground mt-2 text-sm">
                You re-filed this from{" "}
                {areas.find((a) => a.id === capture.area_id)?.label ?? capture.area_id}.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-muted-foreground text-sm tracking-wide uppercase">
              What you said
            </h3>
            <p className="text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
              {capture.raw_text}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
