import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { NEEDS_YOU_STATUSES } from "@reeve/shared";
import { supabase } from "@/lib/supabase";
import { captureOps, pendingActionPatch, subscribe, type PendingOp } from "@/lib/outbox";
import { useRealtimeChannel } from "@/lib/useRealtimeChannel";
import { NEEDS_YOU_COUNT_QK } from "@/lib/actions";
import {
  cursorAfter,
  mergeRows,
  olderThan,
  overlayActionPatch,
  toMessage,
  type Cursor,
  type Message,
  type ThreadRow,
} from "@/lib/thread";

/**
 * E-5: the thread, read from the `thread_events` view with keyset pagination,
 * kept live by realtime, and overlaid with what the outbox has not sent yet.
 *
 * E-3c (the first edition's F9.4, finished here): a realtime payload is applied
 * to the cache rather than invalidating the whole list. The payload is a table
 * row and the cache holds view rows, so the application is a targeted fetch of
 * that one message's view row(s) by `ref_id`, merged in place. One small
 * request per change instead of a full refetch of forty rows per table per
 * change.
 */

export const PAGE = 40;
export const THREAD_QK = ["thread"] as const;

export type ThreadFilter = { text: string; domain: string | null };
export const NO_FILTER: ThreadFilter = { text: "", domain: null };

function key(userId: string, filter: ThreadFilter) {
  return [...THREAD_QK, userId, filter.text.trim().toLowerCase(), filter.domain ?? ""] as const;
}

async function fetchPage(filter: ThreadFilter, cursor: Cursor | null): Promise<ThreadRow[]> {
  let q = supabase
    .from("thread_events")
    .select("*")
    .is("archived_at", null)
    .order("happened_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE);
  if (cursor) q = q.or(olderThan(cursor));
  const text = filter.text.trim();
  if (text) {
    const like = `%${text.replace(/[%_,()]/g, " ")}%`;
    q = q.or(`title.ilike.${like},body.ilike.${like}`);
  }
  if (filter.domain) q = q.eq("domain", filter.domain);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ThreadRow[];
}

async function fetchRef(refId: string): Promise<ThreadRow[]> {
  const { data } = await supabase.from("thread_events").select("*").eq("ref_id", refId);
  return (data ?? []) as ThreadRow[];
}

export function useThread(userId: string, filter: ThreadFilter = NO_FILTER) {
  const qc = useQueryClient();
  const qk = key(userId, filter);
  const filtering = filter.text.trim() !== "" || filter.domain !== null;

  const query = useInfiniteQuery({
    queryKey: qk,
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam }) => fetchPage(filter, pageParam),
    getNextPageParam: (last) => (last.length === PAGE ? cursorAfter(last) : undefined),
    staleTime: 15_000,
  });

  // Whatever the outbox still holds: unsent captures become pending messages;
  // unsent decisions overlay their cards.
  const [pending, setPending] = useState<PendingOp[]>([]);
  useEffect(() => subscribe(setPending), []);

  /** Apply one changed table row to the cache (E-3c). */
  const applyChange = useCallback(
    async (refId: string, archivedId?: string) => {
      if (filtering) {
        void qc.invalidateQueries({ queryKey: qk });
        return;
      }
      const rows = await fetchRef(refId);
      qc.setQueryData<InfiniteData<ThreadRow[], Cursor | null>>(qk, (old) => {
        if (!old) return old;
        const ids = new Set(rows.map((r) => r.id));
        const pages = old.pages.map((p) => p.filter((r) => !ids.has(r.id) && !r.ref_id.startsWith(archivedId ?? "\u0000")));
        pages[0] = mergeRows(pages[0] ?? [], rows);
        return { ...old, pages };
      });
    },
    [qc, qk, filtering],
  );

  useRealtimeChannel({
    channel: "thread",
    userId,
    subscriptions: [
      { table: "captures", onChange: (p) => void applyChange(rowId(p.new) ?? rowId(p.old) ?? "") },
      {
        table: "actions",
        onChange: (p) => {
          void applyChange(rowId(p.new) ?? rowId(p.old) ?? "");
          void qc.invalidateQueries({ queryKey: NEEDS_YOU_COUNT_QK });
        },
      },
      {
        table: "commitments",
        onChange: (p) => {
          const cid = (p.new as { capture_id?: string }).capture_id ?? (p.old as { capture_id?: string }).capture_id;
          if (cid) void applyChange(cid);
          void qc.invalidateQueries({ queryKey: ["commitment-status"] });
        },
      },
      { table: "briefs", onChange: (p) => void applyChange(rowId(p.new) ?? "") },
      { table: "notices", onChange: (p) => void applyChange(rowId(p.new) ?? "") },
    ],
    onReconnect: () => {
      void qc.invalidateQueries({ queryKey: qk, refetchType: "active" });
      void qc.invalidateQueries({ queryKey: NEEDS_YOU_COUNT_QK });
    },
  });

  const messages = useMemo<Message[]>(() => {
    const rows = mergeRows([], query.data?.pages.flat() ?? []);
    const out: Message[] = [];
    const seenCaptures = new Set<string>();
    for (const r of rows) {
      const m = toMessage(r);
      if (!m) continue;
      if (m.type === "capture") seenCaptures.add(m.captureId);
      out.push(m.type === "action" ? overlayActionPatch(m, pendingActionPatch(pending, m.actionId)) : m);
    }
    if (!filtering) {
      for (const p of captureOps(pending)) {
        if (seenCaptures.has(p.id)) continue;
        out.push({
          id: `capture:${p.id}`,
          at: p.op.created_at,
          from: "you",
          type: "capture",
          captureId: p.id,
          text: p.op.raw_text,
          domain: null,
          status: "queued",
          pending: true,
        });
      }
    }
    return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [query.data, pending, filtering]);

  return {
    messages,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    isLoadingMore: query.isFetchingNextPage,
    refresh: () => qc.invalidateQueries({ queryKey: qk }),
  };
}

function rowId(row: unknown): string | undefined {
  return (row as { id?: string } | null)?.id;
}

/** The server's count of what needs you: the badge and the chip (PN-2). */
export function useNeedsYouCount(enabled: boolean) {
  return useQuery({
    queryKey: NEEDS_YOU_COUNT_QK,
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .in("status", NEEDS_YOU_STATUSES as unknown as string[]);
      return count ?? 0;
    },
  });
}

/** One message's row, for a deep link that is older than anything loaded. */
export async function fetchMessageAt(messageId: string): Promise<string | null> {
  const { data } = await supabase.from("thread_events").select("happened_at").eq("id", messageId).maybeSingle();
  return (data as { happened_at: string } | null)?.happened_at ?? null;
}
