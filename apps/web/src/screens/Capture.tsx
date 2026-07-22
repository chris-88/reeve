import { useEffect, useRef, useState } from "react";
import { ArrowUp, CloudOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { enqueue, flush, retryItem, subscribe, type PendingCapture } from "@/lib/outbox";
import { clearDraft, readDraft, writeDraft } from "@/lib/draft";
import { useOnline } from "@/lib/useOnline";
import { cn } from "@/lib/utils";

type Header = { greeting: string; date: string };

function nowHeader(): Header {
  const now = new Date();
  const h = now.getHours();
  return {
    greeting: h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening",
    date: now.toLocaleDateString("en-IE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
  };
}

/**
 * On mobile the dictation path is the iOS keyboard's own mic key, so the job
 * here is to get the keyboard open in one tap and then stay out of the way.
 * On desktop, Cmd/Ctrl+Enter saves.
 */
export default function Capture({ userId }: { userId: string }) {
  const [text, setText] = useState(readDraft);
  const [pending, setPending] = useState<PendingCapture[]>([]);
  const [saving, setSaving] = useState(false);
  const online = useOnline();
  const [header, setHeader] = useState(nowHeader);
  const ref = useRef<HTMLTextAreaElement>(null);

  // An installed PWA can be evicted from memory mid-sentence. Persist keystrokes.
  useEffect(() => {
    writeDraft(text);
  }, [text]);

  useEffect(() => subscribe(setPending), []);

  // Recompute on resume: an installed PWA is not reloaded across a day
  // boundary, so a render-time value goes stale and starts lying.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setHeader(nowHeader());
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  /**
   * The field clears only once the capture is durable locally.
   *
   * Clearing first loses the thought outright if the write rejects — quota
   * exhausted, private mode, storage evicted mid-write — which is the one
   * failure this app claims cannot happen. enqueue() is a single IndexedDB
   * write, so awaiting it costs well under a millisecond and never waits on
   * the network.
   */
  async function save() {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await enqueue(value, userId);
      setText("");
      clearDraft();
      toast("Captured", { description: "Filing it now." });
      ref.current?.focus();
    } catch (err) {
      console.error("[reeve] enqueue failed", err);
      toast.error("Couldn't save that", {
        description: "Your text is still here. Try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  const dead = pending.filter((p) => p.deadLettered);
  /**
   * Offline outranks syncing: a spinner that can never resolve is a lie, and
   * "Syncing…" was what the user saw indefinitely with no network. There is
   * nothing to retry against while offline, so that affordance is withheld too.
   */
  const sync = !online ? "offline" : dead.length > 0 ? "stuck" : "syncing";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between px-6 pt-8 pb-2">
        <h1 className="font-serif text-[1.75rem] leading-none font-normal">{header.greeting}</h1>
        <span className="text-muted-dim text-sm tabular-nums">{header.date}</span>
      </header>

      {/*
        iOS will not open the keyboard without a user gesture, so autofocus is
        unreliable. A <label> makes the whole field area the tap target without
        needing a click handler on a non-interactive element.
      */}
      <label htmlFor="capture-field" className="min-h-0 flex-1 cursor-text px-6 pt-2">
        <Textarea
          id="capture-field"
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          placeholder="What's on your mind?"
          aria-label="Capture a thought"
          // Dictation-first: sentence case, spellcheck on, and Return inserts a
          // newline rather than submitting.
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          enterKeyHint="enter"
          className={cn(
            "h-full max-h-none min-h-0 resize-none border-0 bg-transparent p-0 shadow-none",
            "font-serif !text-[1.7rem] leading-[1.5] font-light tracking-[-0.01em]",
            "placeholder:text-muted-dim placeholder:font-light placeholder:italic",
            "focus-visible:ring-0 dark:bg-transparent",
          )}
        />
      </label>

      <div className="pb-safe shrink-0 space-y-3 px-6 pt-3 pb-4">
        {pending.length > 0 && (
          <button
            type="button"
            disabled={sync === "offline"}
            onClick={() =>
              void (dead.length ? Promise.all(dead.map((d) => retryItem(d.id))) : flush())
            }
            className="border-border/60 bg-card text-muted-foreground flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm"
          >
            {sync === "syncing" ? (
              <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <CloudOff
                className={cn("size-4 shrink-0", sync === "stuck" && "text-destructive")}
                aria-hidden
              />
            )}
            <span className="flex-1 text-left">
              {sync === "offline"
                ? "Offline. Saved on this device."
                : sync === "stuck"
                  ? `${dead.length} couldn't sync. They're saved here.`
                  : `Syncing ${pending.length}…`}
            </span>
            {sync === "stuck" && <span className="text-foreground font-medium">Retry</span>}
          </button>
        )}

        <Button
          type="button"
          size="lg"
          variant={text.trim() ? "default" : "outline"}
          onClick={() => void save()}
          disabled={!text.trim() || saving}
          // Always rendered, never conditional — removing it would make the
          // writing area jump as the first character lands.
          className="h-[3.75rem] w-full rounded-2xl text-[0.95rem] font-medium tracking-wide transition-all"
        >
          <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden />
          {saving ? "Saving…" : "Capture"}
        </Button>
      </div>
    </div>
  );
}
