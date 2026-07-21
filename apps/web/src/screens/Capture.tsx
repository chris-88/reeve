import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { enqueue, subscribe, type PendingCapture } from "@/lib/outbox";

const DRAFT_KEY = "reeve.draft.v1";

/**
 * The capture screen.
 *
 * On mobile the dictation path is the iOS keyboard's own mic key, so the job
 * here is to get the keyboard open in one tap and then stay out of the way.
 * On desktop, Cmd/Ctrl+Enter saves.
 */
export default function Capture() {
  const [text, setText] = useState(() => localStorage.getItem(DRAFT_KEY) ?? "");
  const [pending, setPending] = useState<PendingCapture[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // An installed PWA can be evicted from memory mid-sentence. Persist keystrokes.
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, text);
  }, [text]);

  useEffect(() => subscribe(setPending), []);

  async function save() {
    const value = text.trim();
    if (!value) return;
    setText("");
    localStorage.removeItem(DRAFT_KEY);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
    await enqueue(value);
    ref.current?.focus();
  }

  return (
    <div className="flex h-full flex-col px-5 pt-6">
      {/*
        iOS will not open the keyboard without a user gesture, so autofocus is
        unreliable. This whole area is the tap target that focuses the field.
      */}
      <div
        className="min-h-0 flex-1 cursor-text"
        onClick={() => ref.current?.focus()}
        role="presentation"
      >
        <Textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          placeholder="What's on your mind?"
          aria-label="Capture a thought"
          className="h-full max-h-none min-h-0 resize-none border-0 bg-transparent p-0 !text-2xl leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>

      <div
        className="shrink-0 space-y-3 py-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <p aria-live="polite" className="min-h-6 text-sm text-muted-foreground">
          {justSaved && "Captured."}
          {!justSaved && pending.length > 0 && (
            <>
              {pending.length} not synced yet.{" "}
              {pending.some((p) => p.attempts > 0) && "Will retry automatically."}
            </>
          )}
        </p>

        <Button
          type="button"
          size="lg"
          onClick={() => void save()}
          disabled={!text.trim()}
          className="h-16 w-full rounded-2xl text-lg font-semibold"
        >
          Capture
        </Button>
      </div>
    </div>
  );
}
