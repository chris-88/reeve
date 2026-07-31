import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Search, SquareKanban } from "lucide-react";
import type { Action, Area } from "@reeve/shared";
import { WORK_STATUSES } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { WORK_QK, positionBetween, reorderQueued } from "@/lib/actions";
import { cn } from "@/lib/utils";
import ActionDetail from "@/components/ActionDetail";
import CaptureSearch from "@/components/CaptureSearch";

const DONE_LIMIT = 15;

/**
 * AQ-7: the Work board — the operational view of your assistants.
 *
 * Once you say Go, work lands here and moves Queued → Working → Done. You order
 * the Queued lane by drag, and that order is what gets picked up next. This is
 * the one place manual ordering is right: it directs your assistants, it does
 * not sort your own notes (see the drag handler and the spec's §10 / AQ-3).
 */
export default function Work() {
  const qc = useQueryClient();
  const [openAction, setOpenAction] = useState<Action | null>(null);
  const [searching, setSearching] = useState(false);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    staleTime: Infinity,
    queryFn: async (): Promise<Area[]> => {
      const { data, error } = await supabase.from("areas").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const { data: actions = [], isLoading } = useQuery({
    queryKey: WORK_QK,
    queryFn: async (): Promise<Action[]> => {
      const { data, error } = await supabase
        .from("actions")
        .select("*")
        .is("archived_at", null)
        .in("status", WORK_STATUSES as unknown as string[]);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("work-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "actions" }, () =>
        qc.invalidateQueries({ queryKey: WORK_QK }),
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [qc]);

  const queued = useMemo(
    () =>
      actions
        .filter((a) => a.status === "dispatched")
        .sort((x, y) => (x.queue_position ?? Infinity) - (y.queue_position ?? Infinity)),
    [actions],
  );
  const working = useMemo(
    () =>
      actions
        .filter((a) => a.status === "working")
        .sort((x, y) => (y.started_at ?? "").localeCompare(x.started_at ?? "")),
    [actions],
  );
  const done = useMemo(
    () =>
      actions
        .filter((a) => a.status === "done")
        .sort((x, y) => (y.decided_at ?? y.updated_at).localeCompare(x.decided_at ?? x.updated_at))
        .slice(0, DONE_LIMIT),
    [actions],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = queued.findIndex((a) => a.id === active.id);
    const newIndex = queued.findIndex((a) => a.id === over.id);
    const moved = queued[oldIndex];
    if (oldIndex < 0 || newIndex < 0 || !moved) return;
    const reordered = arrayMove(queued, oldIndex, newIndex);
    const position = positionBetween(
      reordered[newIndex - 1]?.queue_position ?? undefined,
      reordered[newIndex + 1]?.queue_position ?? undefined,
    );
    void reorderQueued(qc, moved, position);
  }

  const empty = !isLoading && actions.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline justify-between px-6 pt-8 pb-3">
        <h1 className="font-serif text-[1.45rem] leading-none font-normal sm:text-[1.75rem]">Work</h1>
        <button
          type="button"
          onClick={() => setSearching(true)}
          aria-label="Search all captures"
          className="text-muted-dim hover:text-foreground -mr-1 self-center p-1.5"
        >
          <Search className="size-5" aria-hidden />
        </button>
      </header>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <SquareKanban className="text-muted-foreground/40 size-8" strokeWidth={1.5} aria-hidden />
          <p className="text-muted-foreground text-sm">
            Nothing in flight. Say “Go” on something in Needs you and it lands here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 sm:flex sm:gap-4 sm:overflow-x-auto sm:overflow-y-hidden">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <Lane title="Queued" count={queued.length} hint="drag to set what's next">
              <SortableContext items={queued.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {queued.map((a) => (
                    <QueuedCard
                      key={a.id}
                      action={a}
                      area={areaById.get(a.area_id ?? "")}
                      onOpen={() => setOpenAction(a)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </Lane>
          </DndContext>

          <Lane title="Working" count={working.length}>
            <ul className="space-y-2">
              {working.map((a) => (
                <Card
                  key={a.id}
                  action={a}
                  area={areaById.get(a.area_id ?? "")}
                  onOpen={() => setOpenAction(a)}
                />
              ))}
            </ul>
          </Lane>

          <Lane title="Done" count={done.length}>
            <ul className="space-y-2">
              {done.map((a) => (
                <Card
                  key={a.id}
                  action={a}
                  area={areaById.get(a.area_id ?? "")}
                  onOpen={() => setOpenAction(a)}
                  muted
                />
              ))}
            </ul>
          </Lane>
        </div>
      )}

      {openAction && (
        <ActionDetail action={openAction} areas={areas} onClose={() => setOpenAction(null)} />
      )}
      {searching && <CaptureSearch areas={areas} onClose={() => setSearching(false)} />}
    </div>
  );
}

function Lane({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 sm:mb-0 sm:w-72 sm:shrink-0">
      <h2 className="text-muted-dim flex items-baseline gap-2 py-2 text-xs font-semibold tracking-widest uppercase">
        {title}
        <span className="text-muted-dim/70 tabular-nums">{count}</span>
        {hint && <span className="text-muted-dim/60 ml-auto text-[0.65rem] normal-case">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function bodyOf(action: Action, area: Area | undefined, muted?: boolean) {
  return (
    <span className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-1 w-[3px] shrink-0 self-stretch rounded-full"
        style={{ background: area?.colour ?? "var(--color-border)" }}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("line-clamp-2 block font-serif text-[1.02rem] leading-snug", muted && "text-muted-foreground")}>
          {action.title}
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          {area && (
            <span className="text-[0.7rem] font-medium tracking-wide uppercase" style={{ color: area.colour }}>
              {area.label}
            </span>
          )}
          {action.assignee && (
            <span className="text-muted-dim text-[0.7rem]">· {action.assignee}</span>
          )}
        </span>
      </span>
    </span>
  );
}

/** A non-draggable card (Working, Done). */
function Card({
  action,
  area,
  onOpen,
  muted,
}: {
  action: Action;
  area: Area | undefined;
  onOpen: () => void;
  muted?: boolean;
}) {
  return (
    <li className="border-border/50 bg-card/50 rounded-xl border">
      <button type="button" onClick={onOpen} className="w-full px-3 py-3 text-left">
        {bodyOf(action, area, muted)}
      </button>
    </li>
  );
}

/** A Queued card, draggable to set the pick-up order. */
function QueuedCard({
  action,
  area,
  onOpen,
}: {
  action: Action;
  area: Area | undefined;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: action.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-border/50 bg-card/50 flex items-stretch gap-1 rounded-xl border",
        isDragging && "opacity-50",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Reorder ${action.title}`}
        className="text-muted-dim hover:text-foreground flex cursor-grab touch-none items-center rounded-l-xl px-1.5"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3 pr-3 text-left">
        {bodyOf(action, area)}
      </button>
    </li>
  );
}
