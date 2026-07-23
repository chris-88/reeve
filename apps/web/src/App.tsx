import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { Inbox as InboxIcon, ListChecks, PenLine } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import UpdatePrompt from "@/components/UpdatePrompt";
import { supabase } from "@/lib/supabase";
import { startOutboxWatcher, subscribe } from "@/lib/outbox";
import { requestPersistentStorage } from "@/lib/draft";
import { syncSubscription, watchSubscriptionChanges } from "@/lib/push";
import { cn } from "@/lib/utils";
import SignIn from "@/screens/SignIn";
import Capture from "@/screens/Capture";
import Due from "@/screens/Due";
import Inbox from "@/screens/Inbox";

type Screen = "capture" | "due" | "inbox";

/**
 * Write, then owe, then log. Due sits in the middle because that is the order
 * a thought moves through the system, and because it is the screen that turns
 * Reeve from something written into to something looked at.
 */
const NAV = [
  { id: "capture", label: "Write", Icon: PenLine },
  { id: "due", label: "Due", Icon: ListChecks },
  { id: "inbox", label: "Inbox", Icon: InboxIcon },
] as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("capture");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => subscribe((items) => setPendingCount(items.length)), []);

  // Anything not yet filed, whether still local or already in the database.
  const { data: unsettled = 0 } = useQuery({
    queryKey: ["unsettled"],
    enabled: !!session,
    refetchInterval: 5000,
    queryFn: async () => {
      const { count } = await supabase
        .from("captures")
        .select("id", { count: "exact", head: true })
        .neq("status", "done");
      return count ?? 0;
    },
  });

  const inFlight = pendingCount + unsettled > 0;

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    // Ask to be exempt from eviction. The outbox and the draft both live in
    // storage Safari will clear after ~7 days of non-use otherwise.
    void requestPersistentStorage();

    /**
     * Reconcile the push subscription on every launch.
     *
     * A push service rotates an endpoint without asking, and the service
     * worker that hears about it has no session to write the new one with. The
     * watcher shortens the window; this is what actually closes it.
     */
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
        <div className="bg-muted-foreground/40 size-2 animate-pulse rounded-full" />
      </div>
    );
  }
  if (!session) return <SignIn />;

  return (
    <div className="flex h-full flex-col">
      <main className="pt-safe min-h-0 flex-1">
        {screen === "capture" && <Capture userId={session.user.id} />}
        {screen === "due" && <Due userId={session.user.id} />}
        {screen === "inbox" && <Inbox userId={session.user.id} />}
      </main>

      <nav
        aria-label="Main"
        className="border-border/60 bg-background/80 pb-safe flex shrink-0 border-t backdrop-blur-lg"
      >
        {NAV.map(({ id, label, Icon }) => {
          const active = screen === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setScreen(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-3 transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                {id === "inbox" && inFlight && (
                  // Decorative: the accessible name must stay "Inbox".
                  <span
                    aria-hidden
                    className="bg-foreground absolute -top-0.5 -right-1 size-1.5 rounded-full"
                  />
                )}
              </span>
              <span className="text-xs font-medium">{label}</span>
            </button>
          );
        })}
      </nav>

      <UpdatePrompt />
      <Toaster position="top-center" />
    </div>
  );
}
