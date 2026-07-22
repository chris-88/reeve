import { useState } from "react";
import { AlertCircle, Check, RotateCw } from "lucide-react";
import type { Area, Capture, Entities } from "@reeve/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const ENTITY_LABELS: Record<keyof Entities, string> = {
  commitments: "Commitments",
  people: "People",
  dates: "Dates",
  amounts: "Amounts",
  orgs: "Organisations",
};

// Commitments first — they are the only entity type that implies an action.
const ENTITY_ORDER: (keyof Entities)[] = [
  "commitments",
  "people",
  "dates",
  "amounts",
  "orgs",
];

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
  const [retrying, setRetrying] = useState(false);
  /**
   * UI-8: eight always-expanded chips were the loudest block in the sheet
   * while serving its rarest action. The write behaviour is unchanged — this
   * is about how the control is revealed, not what it records.
   */
  const [changing, setChanging] = useState(false);
  const current = capture.corrected_area_id ?? capture.area_id;

  /**
   * Re-filing writes corrected_area_id rather than overwriting area_id. The gap
   * between what the model chose and what the user chose is the only honest
   * signal we have about whether the taxonomy is right — don't destroy it.
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

  /**
   * Exhausting the server's three attempts should not be terminal — the cause
   * is usually a transient model outage. Resetting attempts puts the row back
   * in front of the sweeper.
   */
  async function retry() {
    setRetrying(true);
    await supabase
      .from("captures")
      .update({ status: "queued", attempts: 0, error: null })
      .eq("id", capture.id);
    await supabase.functions.invoke("triage", { body: { capture_id: capture.id } });
    setRetrying(false);
    onCorrected();
    onClose();
  }

  /**
   * UI-10: a phone expects swipe-down to dismiss; a full-screen Dialog only
   * offers a small × in the corner. Drawer below sm, Dialog above, which is
   * shadcn's documented responsive pattern.
   */
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const entities = capture.entities;
  const populated = entities
    ? ENTITY_ORDER.filter((k) => entities[k]?.length).map((k) => [k, entities[k]] as const)
    : [];

  const body = (
    <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
          {capture.summary && (
            <p className="font-serif text-[1.15rem] leading-relaxed">{capture.summary}</p>
          )}

          {capture.status === "failed" && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 space-y-3 rounded-xl border p-4 text-sm"
            >
              <div className="text-destructive flex gap-3">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  This couldn&rsquo;t be filed{capture.error ? `: ${capture.error}` : "."} Your
                  text is safe.
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retrying}
                onClick={() => void retry()}
                className="w-full"
              >
                <RotateCw className={cn("size-4", retrying && "animate-spin")} aria-hidden />
                {retrying ? "Trying again…" : "Try filing it again"}
              </Button>
            </div>
          )}

          {populated.length > 0 && (
            <div className="space-y-4">
              {populated.map(([key, values]) => (
                <div key={key}>
                  <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
                    {ENTITY_LABELS[key]}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {values.map((v) => (
                      <Badge key={v} variant="secondary" className="font-normal">
                        {v}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div>
            <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
              Filed under
            </h3>

            {!changing && (
              <div className="mt-2.5 flex items-center gap-3">
                <span className="border-foreground/30 bg-secondary flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: areas.find((a) => a.id === current)?.colour }}
                  />
                  {areas.find((a) => a.id === current)?.label ?? "Unsorted"}
                </span>
                <button
                  type="button"
                  onClick={() => setChanging(true)}
                  className="text-muted-dim hover:text-foreground text-sm underline underline-offset-4"
                >
                  Change
                </button>
              </div>
            )}

            <div className={cn("mt-2.5 flex-wrap gap-2", changing ? "flex" : "hidden")}>
              {areas
                .filter((a) => a.active)
                .map((a) => {
                  const selected = a.id === current;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={saving}
                      onClick={() => void correct(a.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:opacity-50",
                        selected
                          ? "border-foreground/30 bg-secondary text-foreground"
                          : "border-border/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {selected ? (
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      ) : (
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ background: a.colour }}
                        />
                      )}
                      {a.label}
                    </button>
                  );
                })}
            </div>
            {capture.corrected_area_id && (
              <p className="text-muted-foreground mt-2.5 text-sm">
                You moved this from{" "}
                {areas.find((a) => a.id === capture.area_id)?.label ?? capture.area_id}.
              </p>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
              What you said
            </h3>
            <p className="text-muted-foreground mt-2 font-serif leading-relaxed whitespace-pre-wrap">
              {capture.raw_text}
            </p>
          </div>
    </div>
  );

  const title = capture.title ?? "Capture";

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          showCloseButton
          // The title and body are the description; Radix only needs to be
          // told this is deliberate rather than an omission.
          aria-describedby={undefined}
          className="flex max-h-[88vh] w-full max-w-lg flex-col gap-0 rounded-2xl p-0"
        >
          <DialogHeader className="border-border/60 shrink-0 border-b px-6 py-4 text-left">
            <DialogTitle className="pr-8 font-serif text-[1.35rem] leading-snug font-normal">
              {title}
            </DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent aria-describedby={undefined} className="max-h-[92dvh]">
        <DrawerHeader className="border-border/60 shrink-0 border-b px-6 py-3 text-left">
          <DrawerTitle className="font-serif text-[1.35rem] leading-snug font-normal">
            {title}
          </DrawerTitle>
        </DrawerHeader>
        {body}
      </DrawerContent>
    </Drawer>
  );
}
