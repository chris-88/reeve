import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Toaster } from "@/components/ui/sonner";
import UpdatePrompt from "@/components/UpdatePrompt";
import { supabase } from "@/lib/supabase";
import { startOutboxWatcher } from "@/lib/outbox";
import { purgeQueryCache } from "@/lib/query";
import { requestPersistentStorage } from "@/lib/draft";
import { syncSubscription, watchSubscriptionChanges } from "@/lib/push";
import { parseHash, type Route } from "@/lib/route";
import { watchTheme } from "@/lib/theme";
import SignIn from "@/screens/SignIn";
import Thread from "@/screens/Thread";

/** Outside the component: the hash is the one global this app writes on purpose. */
function setHash(hash: string) {
  window.location.hash = hash;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // E-3c: the address is the hash. A notification tap, a cold launch from one,
  // and a link inside the thread all go through it.
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => watchTheme(), []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    // PN-1.4: the worker hands a tapped notification's address to the page
    // that is already open, so the message is shown without a reload.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "NAVIGATE" || typeof event.data.url !== "string") return;
      const target = new URL(event.data.url, window.location.origin);
      if (target.origin !== window.location.origin) return;
      if (window.location.hash === target.hash) onHash();
      else setHash(target.hash);
    };
    window.addEventListener("hashchange", onHash);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("hashchange", onHash);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  /** The addressed message has been shown (or found gone): drop the id from
   *  the address without a history entry, so a reload does not re-open it. */
  const clearFocus = useCallback(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setRoute({});
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // F10.3: a refresh token that cannot be renewed ends in SIGNED_OUT;
      // purge the cached rows so none survive into the next session. The
      // outbox and the draft are left alone: they belong to the device.
      if (event === "SIGNED_OUT") void purgeQueryCache();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void requestPersistentStorage();
    void syncSubscription(session.user.id);
    const stopWatchingPush = watchSubscriptionChanges(session.user.id);
    const stopOutbox = startOutboxWatcher();
    return () => {
      stopWatchingPush();
      stopOutbox();
    };
  }, [session]);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <div className="bg-muted-dim size-2 animate-pulse rounded-full" />
      </div>
    );
  }
  if (!session) return <SignIn />;

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1">
        <Thread userId={session.user.id} focusMessageId={route.messageId} onFocused={clearFocus} />
      </main>
      <UpdatePrompt />
      <Toaster position="top-center" />
    </div>
  );
}
