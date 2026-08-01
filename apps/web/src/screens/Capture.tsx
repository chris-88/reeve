import { useEffect, useRef, useState } from "react";
import { ArrowUp, CloudOff, ImagePlus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { CAPTURE_IMAGE_ACCEPT } from "@reeve/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { captureOps, enqueue, flush, retryItem, subscribe, type PendingOp } from "@/lib/outbox";
import { attachmentFrom, imageFromTransfer, type Attachment } from "@/lib/captureImage";
import {
  clearDraft,
  clearDraftImage,
  readDraft,
  readDraftImage,
  writeDraft,
  writeDraftImage,
} from "@/lib/draft";
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

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * On mobile the dictation path is the iOS keyboard's own mic key, so the job
 * here is to get the keyboard open in one tap and then stay out of the way.
 * On desktop, Cmd/Ctrl+Enter saves.
 *
 * A screenshot can be attached alongside the text. It arrives by whichever
 * route the device offers — the picker (which on iOS is the camera roll or the
 * camera itself), a paste, or a drop — because the desktop path for "here is
 * the thing I'm reacting to" is Cmd+Shift+4 followed by Cmd+V, and routing that
 * through a file dialog would be the slowest possible way to do it.
 */
export default function Capture({ userId }: { userId: string }) {
  const [text, setText] = useState(readDraft);
  /** Captures only. A commitment syncing has nothing to do with this screen. */
  const [pending, setPending] = useState<PendingOp[]>([]);
  const [saving, setSaving] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  /** An object URL for the preview, created and revoked with the attachment. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const online = useOnline();
  const [header, setHeader] = useState(nowHeader);
  /** The text on its way out. A ghost, so the real field is writable at once. */
  const [departing, setDeparting] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // An installed PWA can be evicted from memory mid-sentence. Persist keystrokes.
  useEffect(() => {
    writeDraft(text);
  }, [text]);

  // And the screenshot, which is the same thought. The read is async, so it
  // yields to anything attached in the meantime rather than overwriting it.
  useEffect(() => {
    let cancelled = false;
    void readDraftImage<Attachment>().then((saved) => {
      if (!cancelled && saved) setAttachment((current) => current ?? saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoking on change as well as on unmount: without it every paste leaks the
  // last preview's bytes for as long as the tab lives.
  useEffect(() => {
    if (!attachment) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(attachment.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  useEffect(() => subscribe((items) => setPending(captureOps(items))), []);

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
   * Take a file, or say why not.
   *
   * The rejection is a toast rather than an inline error because the file is
   * simply not accepted — there is no field left in a bad state to annotate,
   * and the previous attachment, if any, is deliberately left alone.
   */
  function attach(file: File | null) {
    if (!file) return;
    const result = attachmentFrom(file);
    if (!result.ok) {
      toast.error("Couldn't attach that", { description: result.message });
      return;
    }
    setAttachment(result.attachment);
    void writeDraftImage(result.attachment);
  }

  function detach() {
    setAttachment(null);
    void clearDraftImage();
  }

  /**
   * The field clears only once the capture is durable locally.
   *
   * Clearing first loses the thought outright if the write rejects — quota
   * exhausted, private mode, storage evicted mid-write — which is the one
   * failure this app claims cannot happen. enqueue() is a single IndexedDB
   * write, so awaiting it costs well under a millisecond and never waits on
   * the network. That holds with an image attached: the bytes go into the
   * queue with the text and are uploaded during the flush, not before it.
   */
  async function save() {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await enqueue(value, userId, attachment ?? undefined);
      // Only now: the field is cleared after the local write is durable, and
      // the draft goes with it so an eviction mid-animation cannot resurrect a
      // thought that has already been captured.
      setText("");
      clearDraft();
      setAttachment(null);
      void clearDraftImage();
      setDeparting(value);
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
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        // Without preventDefault the browser navigates to the dropped file,
        // taking the unsaved draft with it.
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer has actually left the screen, not when it
        // crosses between children — dragleave fires on every boundary.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        attach(imageFromTransfer(e.dataTransfer));
      }}
    >
      <header className="flex items-baseline justify-between px-6 pt-8 pb-2">
        <h1 className="font-serif text-[1.45rem] leading-none font-normal sm:text-[1.75rem]">
          {header.greeting}
        </h1>
        <span className="text-muted-dim text-sm tabular-nums">{header.date}</span>
      </header>

      {/*
        iOS will not open the keyboard without a user gesture, so autofocus is
        unreliable. A <label> makes the whole field area the tap target without
        needing a click handler on a non-interactive element.
      */}
      <label
        htmlFor="capture-field"
        className={cn(
          "relative min-h-0 flex-1 cursor-text px-6 pt-2",
          dragging && "ring-foreground/20 rounded-2xl ring-2 ring-inset",
        )}
      >
        {departing !== null && (
          <span
            aria-hidden
            onAnimationEnd={() => setDeparting(null)}
            // Must match the textarea size at every breakpoint, or the save
            // animation jumps size mid-flight.
            className="animate-depart pointer-events-none absolute inset-x-6 top-2 font-serif text-[1.35rem] leading-[1.5] font-light tracking-[-0.01em] whitespace-pre-wrap sm:text-[1.7rem]"
          >
            {departing}
          </span>
        )}
        <Textarea
          id="capture-field"
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          onPaste={(e) => {
            // A pasted screenshot is a file on the clipboard; pasted text is
            // not, so this leaves ordinary pasting entirely alone.
            const file = imageFromTransfer(e.clipboardData);
            if (!file) return;
            e.preventDefault();
            attach(file);
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
            "font-serif !text-[1.35rem] leading-[1.5] font-light tracking-[-0.01em] sm:!text-[1.7rem]",
            "placeholder:text-muted-dim placeholder:font-light placeholder:italic",
            "focus-visible:ring-0 dark:bg-transparent",
          )}
        />
      </label>

      <div className="pb-safe shrink-0 space-y-3 px-6 pt-3 pb-4">
        {attachment && (
          <div className="border-border/60 bg-card flex items-center gap-3 rounded-xl border p-2">
            {previewUrl && (
              // Decorative: the filename beside it is the accessible name, and
              // a screenshot has no alt text anyone could write for it here.
              <img
                src={previewUrl}
                alt=""
                className="size-12 shrink-0 rounded-lg object-cover"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{attachment.name}</span>
              <span className="text-muted-dim block text-xs">
                {sizeLabel(attachment.bytes)}
              </span>
            </span>
            <button
              type="button"
              onClick={detach}
              aria-label="Remove the attached image"
              className="text-muted-dim hover:text-foreground shrink-0 rounded-lg p-2 transition-colors"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}

        {/*
          The button below is disabled with no text, which is unexplained once
          an image is sitting there looking ready to send. raw_text is NOT NULL
          and non-empty by constraint, and triage reads words — the picture is
          context for the thought, not the thought.
        */}
        {attachment && !text.trim() && (
          <p className="text-muted-dim text-xs">
            Add a line about it — the picture is filed with your words, not instead of them.
          </p>
        )}

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

        <div className="flex gap-2">
          <Button
            type="button"
            // `icon` rather than `lg`: the lg size carries horizontal padding
            // that fights a square, and the label is the aria-label.
            size="icon"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
            aria-label={attachment ? "Replace the attached image" : "Attach an image"}
            className="size-[3.75rem] shrink-0 rounded-2xl"
          >
            <ImagePlus className="size-5" aria-hidden />
          </Button>

          <Button
            type="button"
            size="lg"
            variant={text.trim() ? "default" : "outline"}
            onClick={() => void save()}
            disabled={!text.trim() || saving}
            // Always rendered, never conditional — removing it would make the
            // writing area jump as the first character lands.
            className="h-[3.75rem] flex-1 rounded-2xl text-[0.95rem] font-medium tracking-wide transition-all"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden />
            {saving ? "Saving…" : "Capture"}
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={CAPTURE_IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            attach(e.target.files?.[0] ?? null);
            // Cleared so that choosing the same file twice in a row still
            // fires a change event.
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
