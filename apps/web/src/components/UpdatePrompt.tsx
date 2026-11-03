import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { peek } from "@/lib/outbox";
import { readDraft } from "@/lib/draft";
import { report, trail } from "@/lib/observability";

/**
 * Offers a waiting update. Never applies one on its own.
 *
 * Reloading swaps the JS bundle underneath whoever is using the app. If that
 * happens mid-sentence, or while the outbox still holds an unsynced capture,
 * the update costs a thought — which is the exact failure this app exists to
 * prevent. So the prompt is non-modal, dismissible, and refuses to apply while
 * there is anything to lose.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // F7.5: a worker that never activates is the difference between an app
      // that works in a car park and one that shows a browser error page.
      trail("service worker registered", { active: !!registration?.active });
      // Check hourly. Without this an app left installed for weeks never
      // notices a deploy.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
    onRegisterError(error) {
      report(error);
    },
  });

  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    if (!needRefresh) return;
    let cancelled = false;
    void (async () => {
      const pending = await peek();
      if (cancelled) return;
      if (pending.length > 0) setBlocked("after your captures finish syncing");
      else if (readDraft().trim()) setBlocked("once you've saved what you're writing");
      else setBlocked(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [needRefresh]);

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-20 px-4 pt-[calc(env(safe-area-inset-top)+3.25rem)]"
    >
      <div className="hairline bg-surface mx-auto flex max-w-md items-center gap-3 rounded-[14px] border p-3">
        <Download className="text-muted size-4 shrink-0" strokeWidth={1.5} aria-hidden />
        <p className="flex-1 text-sm">
          {blocked ? `An update is ready — it'll apply ${blocked}.` : "An update is ready."}
        </p>
        {!blocked && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              trail("service worker update applied");
              void updateServiceWorker(true);
            }}
          >
            {busy ? "Updating…" : "Update"}
          </Button>
        )}
        <button
          type="button"
          aria-label="Dismiss update notice"
          onClick={() => setNeedRefresh(false)}
          className="text-muted hover:text-text grid size-9 place-items-center"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
