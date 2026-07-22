import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Inbox as InboxIcon, PenLine } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import UpdatePrompt from "@/components/UpdatePrompt";
import { supabase } from "@/lib/supabase";
import { startOutboxWatcher } from "@/lib/outbox";
import { requestPersistentStorage } from "@/lib/draft";
import { cn } from "@/lib/utils";
import SignIn from "@/screens/SignIn";
import Capture from "@/screens/Capture";
import Inbox from "@/screens/Inbox";

type Screen = "capture" | "inbox";

const NAV = [
  { id: "capture", label: "Write", Icon: PenLine },
  { id: "inbox", label: "Inbox", Icon: InboxIcon },
] as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("capture");

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
    return startOutboxWatcher();
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
        {screen === "capture" ? <Capture userId={session.user.id} /> : <Inbox />}
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
              <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
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
