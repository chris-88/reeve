import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Search, X } from "lucide-react";
import type { Area, Capture } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import CaptureDetail from "@/components/CaptureDetail";

/**
 * AQ-6: where the old log lives.
 *
 * Once the chronological Inbox is retired, "everything I ever captured" needs a
 * home or archiving reads as deletion. This is that home — a search over title
 * and raw text, reverse-chronological — and it is where a note is **archived**.
 *
 * Archived captures are hidden from the default list (browsing) but included
 * the moment you search a term (finding), so archiving hides without losing.
 * Off the primary nav, reached from the Needs-you header.
 */
export default function CaptureSearch({
  areas,
  onClose,
}: {
  areas: Area[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
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
      // Browsing hides archived; searching a term includes it, so an archived
      // capture is hidden but still findable.
      if (term) query = query.or(`title.ilike.%${term}%,raw_text.ilike.%${term}%`);
      else query = query.is("archived_at", null);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  async function setArchived(c: Capture, archived: boolean) {
    const archived_at = archived ? new Date().toISOString() : null;
    const { error } = await supabase.from("captures").update({ archived_at }).eq("id", c.id);
    if (error) {
      toast.error(archived ? "Couldn't archive that" : "Couldn't restore that");
      return;
    }
    void qc.invalidateQueries({ queryKey: ["capture-search"] });
    if (archived) {
      toast("Archived", {
        action: { label: "Undo", onClick: () => void setArchived(c, false) },
      });
    }
  }

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
            const archived = c.archived_at != null;
            return (
              <li key={c.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setOpen(c)}
                  className="hover:bg-card/60 -ml-2 flex min-w-0 flex-1 gap-3.5 rounded-xl px-2 py-3.5 text-left transition-colors"
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
                      {archived && (
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
                <button
                  type="button"
                  aria-label={archived ? `Restore "${c.title ?? c.raw_text}"` : `Archive "${c.title ?? c.raw_text}"`}
                  title={archived ? "Restore" : "Archive"}
                  onClick={() => void setArchived(c, !archived)}
                  className="text-muted-dim hover:text-foreground hover:bg-card/60 ml-1 shrink-0 rounded-lg p-2 transition-colors"
                >
                  {archived ? (
                    <ArchiveRestore className="size-4" aria-hidden />
                  ) : (
                    <Archive className="size-4" aria-hidden />
                  )}
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
