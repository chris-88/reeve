import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check } from "lucide-react";
import type { Area } from "@reeve/shared";
import { Bubble } from "@/components/Bubble";
import Sheet from "@/components/Sheet";
import { archiveCapture, correctDomain, retitleCapture } from "@/lib/captures";
import type { Message } from "@/lib/thread";
import { cn } from "@/lib/utils";

type CaptureMessage = Extract<Message, { type: "capture" }>;

/**
 * E-4: your message. A long-press opens the one menu it has: move it to
 * another domain, retitle it, or archive it.
 */
export default function CaptureBubble({ m, areas, title }: { m: CaptureMessage; areas: Area[]; title: string | null }) {
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (m.pending) return;
    timer.current = setTimeout(() => setMenu(true), 450);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <>
      <Bubble
        from="you"
        quiet={m.pending}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!m.pending) setMenu(true);
        }}
        className="select-none"
        aria-label={m.pending ? "Sending" : undefined}
      >
        {m.text}
        {m.pending && <span className="text-muted-dim mt-1 block text-[12px]">sending…</span>}
      </Bubble>
      {menu && <CaptureMenu m={m} areas={areas} title={title} onClose={() => setMenu(false)} />}
    </>
  );
}

function CaptureMenu({ m, areas, title, onClose }: { m: CaptureMessage; areas: Area[]; title: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(title ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <Sheet title="This message" onClose={onClose}>
      <div className="space-y-5 px-5 pb-6">
        <p className="text-muted line-clamp-3 text-[14px]">{m.text}</p>

        <div>
          <p className="text-muted-dim mb-2 text-[12px] font-medium tracking-wide uppercase">Domain</p>
          <div className="flex flex-wrap gap-1.5">
            {areas.map((a) => {
              const selected = a.id === m.domain;
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => {
                    if (selected) return;
                    setBusy(true);
                    void correctDomain(qc, m.captureId, a.id).then(onClose);
                  }}
                  className={cn(
                    "hairline flex h-9 items-center gap-1.5 rounded-full border px-3 text-[14px] transition-colors",
                    selected ? "bg-surface-2 border-hair-strong" : "hover:bg-surface-2",
                  )}
                >
                  {selected ? (
                    <Check className="size-3.5" strokeWidth={2} aria-hidden />
                  ) : (
                    <span aria-hidden className="size-2 rounded-full" style={{ background: a.colour }} />
                  )}
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void retitleCapture(qc, m.captureId, name).then(onClose);
          }}
        >
          <label className="block">
            <span className="text-muted-dim mb-2 block text-[12px] font-medium tracking-wide uppercase">Title</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled"
              className="hairline h-11 w-full rounded-[12px] border bg-transparent px-3 text-[15px] outline-none focus:border-hair-strong"
            />
          </label>
        </form>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void archiveCapture(qc, m.captureId).then(onClose);
          }}
          className="text-muted hover:text-danger flex h-11 items-center gap-2 text-[14px]"
        >
          <Archive className="size-4" strokeWidth={1.5} aria-hidden />
          Archive this
        </button>
      </div>
    </Sheet>
  );
}
