import { useEffect, useRef } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * F9: one resilient realtime subscription, shared by every screen that has one.
 *
 * The bug it exists to kill: a channel subscribed once on mount and never
 * looked at again. iOS suspends a backgrounded PWA's WebSocket, the channel
 * dies silently, and the stream simply stops updating until a full reload. Each
 * screen had its own copy of that bug; this is the single place it is fixed.
 *
 * What it does that a bare `.channel().subscribe()` does not:
 *  - re-subscribes on `visibilitychange` when the tab becomes visible, and
 *    fires `onReconnect` to close the gap that opened while it was away (F9.1);
 *  - treats CHANNEL_ERROR / TIMED_OUT / CLOSED as a reconnect with bounded
 *    backoff, instead of ignoring the status argument (F9.2);
 *  - scopes each subscription with `user_id=eq.<uid>` — RLS already gates
 *    delivery, but the filter cuts the traffic and states the intent (F9.3);
 *  - tears the socket down after a spell backgrounded rather than holding a
 *    dead connection slot open (F9.5).
 *
 * Handlers are read through a ref, so a re-subscribe always uses the current
 * ones without re-running the effect. Applying the payload to the cache instead
 * of invalidating (F9.4) is left to the caller's `onChange`; the default of the
 * consumers today is to invalidate, which is correct if not the cheapest — the
 * refetch cost that would earn F9.4 has not shown up on a single-user app.
 */

type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>;

type Subscription = {
  table: string;
  onChange: (payload: Payload) => void;
};

const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000];
/** Backgrounded this long, the socket is suspended anyway — let it go. */
const BACKGROUND_TEARDOWN_MS = 60_000;

export function useRealtimeChannel(opts: {
  channel: string;
  userId: string;
  subscriptions: Subscription[];
  /** Fired on every *re*-connect (not the first), to close the gap while down. */
  onReconnect?: () => void;
}): void {
  // Latest handlers via a ref, updated after commit — never mutated during
  // render — so a re-subscribe always calls the current ones without listing
  // them as effect deps (which would re-subscribe on every render).
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });

  const { channel: channelName, userId } = opts;

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let attempts = 0;
    let hasConnected = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let teardownTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const clearReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const teardown = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || document.visibilityState === "hidden") return;
      clearReconnect();
      const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        teardown();
        connect();
      }, delay);
    };

    const connect = () => {
      const ch = supabase.channel(channelName);
      for (const sub of ref.current.subscriptions) {
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table: sub.table, filter: `user_id=eq.${userId}` },
          (payload) =>
            ref.current.subscriptions.find((s) => s.table === sub.table)?.onChange(payload),
        );
      }
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          attempts = 0;
          if (hasConnected) ref.current.onReconnect?.();
          hasConnected = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReconnect();
        }
      });
      channel = ch;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (teardownTimer) clearTimeout(teardownTimer);
        teardownTimer = null;
        clearReconnect();
        // A backgrounded socket is usually dead; re-subscribe fresh and close
        // the gap rather than trusting whatever state it is in.
        teardown();
        attempts = 0;
        connect();
        ref.current.onReconnect?.();
      } else {
        teardownTimer = setTimeout(() => {
          teardown();
          clearReconnect();
        }, BACKGROUND_TEARDOWN_MS);
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearReconnect();
      if (teardownTimer) clearTimeout(teardownTimer);
      teardown();
    };
  }, [channelName, userId]);
}
