import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Bubble, Dots } from "@/components/Bubble";
import Composer from "@/components/Composer";
import Header from "@/components/Header";
import Message from "@/components/Message";
import PushAskCard from "@/components/PushAskCard";
import SearchBar from "@/components/SearchBar";
import SettingsSheet from "@/components/SettingsSheet";
import { useAreas } from "@/lib/areas";
import { applyBadge } from "@/lib/badge";
import { dayLabel, sameDay } from "@/lib/format";
import { shouldOfferPush } from "@/lib/pushAsk";
import { countNeedsYou, needsYou, type Message as M } from "@/lib/thread";
import { fetchMessageAt, NO_FILTER, useNeedsYouCount, useThread, type ThreadFilter } from "@/lib/useThread";
import { cn } from "@/lib/utils";

/**
 * E-3: the one screen. Header, the thread newest at the bottom, the composer.
 * Older messages load as you scroll up; a notification's address scrolls to
 * and highlights one message; the count chip jumps to the oldest still
 * waiting. Opened scrolled to the bottom, instantly: a jump never animates.
 */
export default function Thread({
  userId,
  focusMessageId,
  onFocused,
}: {
  userId: string;
  focusMessageId?: string;
  onFocused: () => void;
}) {
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<ThreadFilter>(NO_FILTER);
  const [searching, setSearching] = useState(false);
  const [settings, setSettings] = useState(false);
  const [asking, setAsking] = useState(false);
  const { data: areas = [] } = useAreas();
  const activeFilter = searching ? filter : NO_FILTER;
  const { messages, isLoading, hasMore, loadMore, isLoadingMore } = useThread(userId, activeFilter);
  const { data: serverCount } = useNeedsYouCount(true);
  const count = Math.max(serverCount ?? 0, countNeedsYou(messages));

  useEffect(() => {
    void applyBadge(count);
  }, [count]);

  const titles = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const x of messages) if (x.type === "filed") m.set(x.captureId, x.title);
    return m;
  }, [messages]);

  // --- scrolling ----------------------------------------------------------
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const firstPaint = useRef(true);
  const prevHeight = useRef(0);
  const prevFirstId = useRef<string | null>(null);

  // Opened scrolled to the bottom; later arrivals keep you there if you were there.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || messages.length === 0) return;
    const firstId = messages[0]?.id ?? null;
    if (firstPaint.current) {
      el.scrollTop = el.scrollHeight;
      firstPaint.current = false;
    } else if (prevFirstId.current && firstId !== prevFirstId.current) {
      // Older messages were prepended: hold the viewport where it was.
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
    prevFirstId.current = firstId;
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 240 && hasMore && !isLoadingMore) loadMore();
  }, [hasMore, isLoadingMore, loadMore]);

  const [highlight, setHighlight] = useState<string | null>(null);
  const jumpTo = useCallback(
    (id: string) => {
      const node = document.getElementById(`m-${id}`);
      if (!node) return false;
      node.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      setHighlight(id);
      setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1200);
      return true;
    },
    [reduce],
  );

  // A notification's address: scroll to the message, loading older pages if
  // it is not here yet. Gone (archived) is said plainly.
  const focusTried = useRef(0);
  useEffect(() => {
    if (!focusMessageId || isLoading) return;
    // Deferred a frame: this reacts to an external event (a tap on a
    // notification), and scrolling needs the row painted first.
    const frame = requestAnimationFrame(() => {
      if (jumpTo(focusMessageId)) {
        focusTried.current = 0;
        onFocused();
        return;
      }
      if (focusTried.current === 0) {
        void fetchMessageAt(focusMessageId).then((at) => {
          if (!at) {
            toast("Already handled", { description: "That one isn't here any more." });
            focusTried.current = 0;
            onFocused();
          }
        });
      }
      if (hasMore && focusTried.current < 12 && !isLoadingMore) {
        focusTried.current += 1;
        loadMore();
      } else if (!hasMore) {
        focusTried.current = 0;
        onFocused();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusMessageId, messages, isLoading, hasMore, isLoadingMore, loadMore, jumpTo, onFocused]);

  const jumpToOldestWaiting = () => {
    const oldest = messages.find(needsYou);
    if (oldest) jumpTo(oldest.id);
  };

  const dateItems = useMemo(() => withDays(messages), [messages]);

  return (
    <div className="flex h-full flex-col">
      <Header
        count={count}
        searching={searching}
        onToggleSearch={() => {
          setSearching((s) => !s);
          setFilter(NO_FILTER);
        }}
        onSettings={() => setSettings(true)}
        onJump={jumpToOldestWaiting}
      />
      <AnimatePresence initial={false}>
        {searching && <SearchBar key="search" filter={filter} areas={areas} onChange={setFilter} onClose={() => setSearching(false)} />}
      </AnimatePresence>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" role="log" aria-label="Thread">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-end py-3">
          {isLoadingMore && (
            <p className="text-muted-dim py-2 text-center text-[12px]">
              <Dots label="Loading older messages" />
            </p>
          )}
          {!hasMore && messages.length > 0 && !searching && (
            <p className="text-muted-dim py-4 text-center text-[12px]">This is the start of the thread.</p>
          )}
          {isLoading && messages.length === 0 && (
            <p className="text-muted-dim py-10 text-center text-[13px]">
              <Dots label="Loading" />
            </p>
          )}
          {!isLoading && messages.length === 0 && (
            <div className="px-6 py-16 text-center">
              <p className="voice text-muted">{searching ? "Nothing matches." : "Tell me anything. I'll file it, and I'll tell you what I'd do about it."}</p>
            </div>
          )}

          {dateItems.map((item, i) => {
            if (item.kind === "day") {
              return (
                <p key={`day-${item.label}-${i}`} className="text-muted-dim py-3 text-center text-[12px] font-medium">
                  {item.label}
                </p>
              );
            }
            const m = item.message;
            const prev = dateItems[i - 1];
            const gap = prev?.kind === "message" ? (prev.message.from === m.from ? "mt-3" : "mt-5") : "mt-1";
            return (
              <Fragment key={m.id}>
                <motion.div
                  id={`m-${m.id}`}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  className={cn(gap, highlight === m.id && "highlight")}
                >
                  <Message
                    m={m}
                    userId={userId}
                    areas={areas}
                    titles={titles}
                    onHanded={() => {
                      if (shouldOfferPush()) setAsking(true);
                    }}
                    onJump={(id) => {
                      if (!jumpTo(id)) toast("Not loaded yet", { description: "Scroll up a little and try again." });
                    }}
                  />
                </motion.div>
                {item.filing && (
                  <div className="mt-3">
                    <Bubble from="reeve" quiet>
                      <Dots label="Filing" />
                    </Bubble>
                  </div>
                )}
              </Fragment>
            );
          })}

          <AnimatePresence>
            {asking && (
              <motion.div key="ask" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5">
                <PushAskCard userId={userId} onDone={() => setAsking(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Composer
        userId={userId}
        onSent={() => {
          atBottom.current = true;
          requestAnimationFrame(() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        }}
      />

      {settings && <SettingsSheet userId={userId} onClose={() => setSettings(false)} />}
    </div>
  );
}

type DayItem = { kind: "day"; label: string } | { kind: "message"; message: M; filing: boolean };

/** Day separators, and a "filing…" bubble after a capture triage has not answered yet. */
function withDays(messages: readonly M[]): DayItem[] {
  const out: DayItem[] = [];
  const filed = new Set<string>();
  for (const m of messages) if (m.type === "filed" || m.type === "capture_failed") filed.add(m.captureId);
  let last: string | null = null;
  for (const m of messages) {
    if (!last || !sameDay(last, m.at)) out.push({ kind: "day", label: dayLabel(m.at) });
    last = m.at;
    const filing = m.type === "capture" && !m.pending && !filed.has(m.captureId) && (m.status === "queued" || m.status === "processing");
    out.push({ kind: "message", message: m, filing });
  }
  return out;
}
