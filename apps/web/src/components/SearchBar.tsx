import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Search, X } from "lucide-react";
import type { Area } from "@reeve/shared";
import type { ThreadFilter } from "@/lib/useThread";
import { cn } from "@/lib/utils";

/**
 * E-3: search filters the thread in place, text plus domain chips, and clears
 * with one tap. Slides down from the header.
 */
export default function SearchBar({
  filter,
  areas,
  onChange,
  onClose,
}: {
  filter: ThreadFilter;
  areas: Area[];
  onChange: (f: ThreadFilter) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="shrink-0 overflow-hidden"
    >
      <div className="space-y-2 px-4 pb-3">
        <label className="bg-surface hairline flex h-11 items-center gap-2 rounded-full border px-3.5">
          <Search className="text-muted-dim size-4" strokeWidth={1.5} aria-hidden />
          <input
            ref={ref}
            value={filter.text}
            onChange={(e) => onChange({ ...filter, text: e.target.value })}
            placeholder="Search the thread"
            aria-label="Search the thread"
            enterKeyHint="search"
            className="placeholder:text-muted-dim min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
          {(filter.text || filter.domain) && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                onChange({ text: "", domain: null });
                if (!filter.text) onClose();
              }}
              className="text-muted-dim hover:text-text -mr-1 grid size-8 place-items-center rounded-full"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </label>
        <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {areas.map((a) => {
            const on = filter.domain === a.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...filter, domain: on ? null : a.id })}
                className={cn(
                  "hairline flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
                  on ? "bg-text text-bg border-text" : "text-muted hover:text-text",
                )}
              >
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: on ? "currentColor" : a.colour }} />
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
