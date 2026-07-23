import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import type { Area, Capture } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import CaptureDetail from "@/components/CaptureDetail";

/**
 * RB-5: where the old log went.
 *
 * Once the Inbox empties, "everything I ever captured" needs a home or
 * archiving reads as deletion. This is that home — deliberately minimal: a
 * search over title and raw text, reverse-chronological, and crucially it
 * includes archived captures (no `archived_at` filter), which is the whole
 * point. It sits off the primary nav, reached from the Inbox header.
 */
export default function CaptureSearch({
  areas,
  onClose,
}: {
  areas: Area[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Capture | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const term = q.trim();

  // Opened by a tap, so a gesture already happened — focusing the field is what
  // the user is here to do. (A ref, not autoFocus, which the a11y lint refuses.)
  useEffect(() => inputRef.current?.focus(), []);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["capture-search", term],
    queryFn: async (): Promise<Capture[]> => {
      let query = supabase
        .from("captures")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      // No archived_at filter: the archive is exactly what this view is for.
      if (term) query = query.or(`title.ilike.%${term}%,raw_text.ilike.%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="bg-bg pt-safe fixed inset-0 z-50 flex flex-col">
      <header className="flex items-center gap-2 px-4 pt-3 pb-3">
        <div className="border-border/60 focus-within:border-foreground/30 flex flex-1 items-center gap-2 rounded-full border px-4 py-2 transition-colors">
          <Search className="text-muted-dim size-4 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything you've captured"
            aria-label="Search captures"
            className="placeholder:text-muted-dim min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="text-muted-foreground hover:text-foreground p-2"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {results.length === 0 && !isFetching && (
          <p className="text-muted-foreground px-2 py-16 text-center text-sm">
            {term ? "No captures match that." : "Nothing captured yet."}
          </p>
        )}

        <ul>
          {results.map((c) => {
            const area = areaById.get(c.corrected_area_id ?? c.area_id ?? "");
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpen(c)}
                  className="hover:bg-card/60 -mx-2 flex w-[calc(100%+1rem)] gap-3.5 rounded-xl px-2 py-3.5 text-left transition-colors"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
                    style={{ background: area?.colour ?? "var(--color-border)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="line-clamp-2 min-w-0 flex-1 font-serif text-[1.05rem]">
                        {c.title ?? c.raw_text}
                      </span>
                      {c.archived_at && (
                        <span className="text-muted-dim shrink-0 text-[0.7rem] tracking-wide uppercase">
                          Archived
                        </span>
                      )}
                    </span>
                    {c.summary && (
                      <span className="text-muted-foreground mt-1 line-clamp-2 block text-sm leading-snug">
                        {c.summary}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {open && (
        <CaptureDetail capture={open} areas={areas} onClose={() => setOpen(null)} onCorrected={onClose} />
      )}
    </div>
  );
}
