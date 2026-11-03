import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, CloudOff } from "lucide-react";
import { toast } from "sonner";
import { enqueue } from "@/lib/outbox";
import { clearDraft, readDraft, writeDraft } from "@/lib/draft";
import { useOnline } from "@/lib/useOnline";
import { cn } from "@/lib/utils";

/**
 * E-3: pinned to the bottom. "Tell Reeve…". Send on ⏎ or the arrow; Shift+⏎
 * for a new line. Writes through the outbox and clears only once the capture
 * is durable locally (rule 3). Your message then slides up into the thread
 * while the field clears; there is no success toast.
 */
export default function Composer({ userId, onSent }: { userId: string; onSent: (text: string) => void }) {
  const [text, setText] = useState(readDraft);
  const [saving, setSaving] = useState(false);
  const [departing, setDeparting] = useState<string | null>(null);
  const [departKey, setDepartKey] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const online = useOnline();
  const reduce = useReducedMotion();

  // An installed PWA can be evicted from memory mid-sentence. Persist keystrokes.
  useEffect(() => {
    writeDraft(text);
  }, [text]);

  // Grow with the text, one to six lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 22 + 20)}px`;
  }, [text]);

  async function send() {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await enqueue(value, userId);
      setText("");
      clearDraft();
      setDeparting(value);
      setDepartKey((k) => k + 1);
      onSent(value);
      ref.current?.focus();
    } catch (err) {
      console.error("[reeve] enqueue failed", err);
      toast.error("Couldn't save that", { description: "Your text is still here. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const canSend = text.trim().length > 0 && !saving;

  return (
    <div className="pb-safe shrink-0 px-3 pt-2 pb-3">
      {!online && (
        <p className="text-muted-dim mb-1.5 flex items-center gap-1.5 px-2 text-[12px]">
          <CloudOff className="size-3.5" strokeWidth={1.5} aria-hidden />
          Offline. Anything you send is saved here and goes when you're back.
        </p>
      )}
      <div className="relative">
        <AnimatePresence>
          {departing !== null && (
            <motion.span
              key={departKey}
              aria-hidden
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 0, y: reduce ? 0 : -28 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onAnimationComplete={() => setDeparting(null)}
              className="text-text pointer-events-none absolute inset-x-0 bottom-0 px-4 py-[11px] text-[15px] leading-[22px] whitespace-pre-wrap"
            >
              {departing}
            </motion.span>
          )}
        </AnimatePresence>
        <label
          htmlFor="composer"
          className={cn(
            "bg-surface hairline flex items-end gap-1 rounded-[20px] border pr-1.5 pl-4 transition-colors",
            "focus-within:border-hair-strong",
          )}
        >
          <textarea
            id="composer"
            ref={ref}
            data-slot="composer"
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Tell Reeve…"
            aria-label="Tell Reeve"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            enterKeyHint="send"
            className={cn(
              "text-text placeholder:text-muted-dim min-h-[44px] flex-1 resize-none bg-transparent py-[11px] text-[15px] leading-[22px] outline-none",
              departing !== null && "opacity-0",
            )}
          />
          <motion.button
            type="button"
            aria-label="Send"
            disabled={!canSend}
            onClick={() => void send()}
            whileTap={canSend ? { scale: 0.92 } : undefined}
            animate={{ opacity: canSend ? 1 : 0.35, scale: canSend ? 1 : 0.92 }}
            transition={{ duration: 0.16 }}
            className="bg-brand text-brand-ink mb-1 grid size-9 shrink-0 place-items-center rounded-full disabled:cursor-default"
          >
            <ArrowUp className="size-5" strokeWidth={2} aria-hidden />
          </motion.button>
        </label>
      </div>
    </div>
  );
}
