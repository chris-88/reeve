import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ImageIcon, Search, X } from "lucide-react";
import type { Area, Capture } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import CaptureDetail from "@/components/CaptureDetail";

/**
 * AQ-8: the Library — see everything you've captured.
 *
 * Browse-first: open it and you are looking at the whole pile, newest first;
 * typing narrows. This is the home the retired Inbox's history job needed, and
 * — because a capture with no commitment never reaches "Needs you" — the only
 * place a plain note is visible after it is written.
 *
 * It is for looking and recall and offers no decide/act control — the rule that
 * keeps it a library, not a second queue. Archiving lives here (a note's only
 * removal); archived captures are tucked away while browsing and shown on the
 * toggle, or whenever a search matches one.
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
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<Capture | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const term = q.trim();

  useEffect(() => inputRef.current?.focus(), []);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["capture-search", term, showArchived],
    queryFn: async (): Promise<Capture[]> => {
      let query = supabase
        .from("captures")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      // Browsing hides archived unless asked; a search always includes them, so
      // an archived capture is out of the way but never lost.
      if (term) query = query.or(`title.ilike.%${term}%,raw_text.ilike.%${term}%`);
      else if (!showArchived) query = query.is("archived_at", null);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const visible = useMemo(
    () =>
      areaFilter
        ? results.filter((c) => (c.corrected_area_id ?? c.area_id) === areaFilter)
        : results,
    [results, areaFilter],
  );

  const used = useMemo(() => {
    const present = new Set<string>();
    for (const c of results) {
      const id = c.corrected_area_id ?? c.area_id;
      if (id) present.add(id);
    }
    return areas.filter((a) => present.has(a.id));
  }, [areas, results]);

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
            placeholder="Search your library"
            aria-label="Search captures"
            className="placeholder:text-muted-dim min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground p-2"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      {(used.length > 0 || !term) && (
        <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto px-4 pb-3">
          <Chip active={areaFilter === null} onClick={() => setAreaFilter(null)} label="All" />
          {used.map((a) => (
            <Chip
              key={a.id}
              active={areaFilter === a.id}
              onClick={() => setAreaFilter(areaFilter === a.id ? null : a.id)}
              label={a.label}
              colour={a.colour}
            />
          ))}
          {!term && (
            <Chip
              active={showArchived}
              onClick={() => setShowArchived((s) => !s)}
              label={showArchived ? "Hide archived" : "Show archived"}
            />
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {visible.length === 0 && !isFetching && (
          <p className="text-muted-foreground px-2 py-16 text-center text-sm">
            {term ? "No captures match that." : "Nothing captured yet."}
          </p>
        )}

        <ul>
          {visible.map((c) => {
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
                      {/*
                        The one thing a text list cannot show. Without it a
                        screenshot is invisible until the capture is opened,
                        which makes it unfindable rather than merely unseen.
                      */}
                      {c.image_path && (
                        <span className="text-muted-dim shrink-0 self-center">
                          <ImageIcon className="size-3.5" aria-hidden />
                          <span className="sr-only">Has an attached image</span>
                        </span>
                      )}
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
                  aria-label={
                    archived ? `Restore "${c.title ?? c.raw_text}"` : `Archive "${c.title ?? c.raw_text}"`
                  }
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

function Chip({
  active,
  onClick,
  label,
  colour,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  colour?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "border-foreground/30 bg-secondary text-foreground"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {colour && <span aria-hidden className="size-2 rounded-full" style={{ background: colour }} />}
      {label}
    </button>
  );
}
