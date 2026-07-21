import { useEffect, useRef, useState } from "react";
import { ArrowUp, CloudOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { enqueue, flush, subscribe, type PendingCapture } from "@/lib/outbox";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "reeve.draft.v1";

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
};

/**
 * On mobile the dictation path is the iOS keyboard's own mic key, so the job
 * here is to get the keyboard open in one tap and then stay out of the way.
 * On desktop, Cmd/Ctrl+Enter saves.
 */
export default function Capture() {
  const [text, setText] = useState(() => localStorage.getItem(DRAFT_KEY) ?? "");
  const [pending, setPending] = useState<PendingCapture[]>([]);
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
    await enqueue(value);
    toast("Captured", { description: "Filing it now." });
    ref.current?.focus();
  }

  const stuck = pending.filter((p) => p.attempts > 0).length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between px-6 pt-8 pb-2">
        <h1 className="font-serif text-[1.75rem] leading-none font-normal">{greeting()}</h1>
        <span className="text-muted-foreground text-sm tabular-nums">
          {new Date().toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </header>

      {/*
        iOS will not open the keyboard without a user gesture, so autofocus is
        unreliable. The whole field area is the tap target.
      */}
      <div
        className="min-h-0 flex-1 cursor-text px-6 pt-2"
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
          className={cn(
            "h-full max-h-none min-h-0 resize-none border-0 bg-transparent p-0 shadow-none",
            "font-serif !text-[1.7rem] leading-[1.5] font-light tracking-[-0.01em]",
            "placeholder:text-muted-foreground/40 placeholder:font-light placeholder:italic",
            "focus-visible:ring-0 dark:bg-transparent",
          )}
        />
      </div>

      <div
        className="shrink-0 space-y-3 px-6 pt-3 pb-4"
      >
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => void flush()}
            className="border-border/60 bg-card text-muted-foreground flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm"
          >
            {stuck > 0 ? (
              <CloudOff className="text-destructive size-4 shrink-0" aria-hidden />
            ) : (
              <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
            )}
            <span className="flex-1 text-left">
              {stuck > 0
                ? `${stuck} couldn't sync. They're saved here.`
                : `Syncing ${pending.length}…`}
            </span>
            {stuck > 0 && <span className="text-foreground font-medium">Retry</span>}
          </button>
        )}

        <Button
          type="button"
          size="lg"
          onClick={() => void save()}
          disabled={!text.trim()}
          className="h-[3.75rem] w-full rounded-2xl text-[0.95rem] font-medium tracking-wide transition-all disabled:opacity-20"
        >
          <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden />
          Capture
          {words > 0 && (
            <span className="text-primary-foreground/50 ml-1 text-sm font-normal tabular-nums">
              {words} {words === 1 ? "word" : "words"}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
