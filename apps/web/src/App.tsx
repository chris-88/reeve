import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { startOutboxWatcher } from "@/lib/outbox";
import SignIn from "@/screens/SignIn";
import Capture from "@/screens/Capture";
import Inbox from "@/screens/Inbox";

type Screen = "capture" | "inbox";

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
    return startOutboxWatcher();
  }, [session]);

  if (!ready) return <div className="grid h-full place-items-center text-muted">…</div>;
  if (!session) return <SignIn />;

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1">
        {screen === "capture" ? <Capture /> : <Inbox />}
      </main>

      <nav
        className="flex shrink-0 border-t border-border bg-surface"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {(["capture", "inbox"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScreen(s)}
            aria-current={screen === s ? "page" : undefined}
            className={`flex-1 py-4 text-base font-medium capitalize transition-colors ${
              screen === s ? "text-text" : "text-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </nav>
    </div>
  );
}
