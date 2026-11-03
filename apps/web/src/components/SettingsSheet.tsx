import { useEffect, useState } from "react";
import { Bell, BellOff, LogOut } from "lucide-react";
import Sheet from "@/components/Sheet";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { pendingOutboxCount, signOut } from "@/lib/session";
import { setTheme, THEMES, useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/** E-3: notifications, theme, sign out, version. Three switches, no more. */
export default function SettingsSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const theme = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      // WP-F4.4: requestPermission() only from this tap.
      setState(state === "enabled" ? await disablePush() : await enablePush(userId));
    } catch (err) {
      console.error("[reeve] push toggle failed", err);
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    const n = await pendingOutboxCount();
    if (n > 0 && !confirming) {
      setPendingCount(n);
      setConfirming(true);
      return;
    }
    await signOut();
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="space-y-6 px-5 pb-6">
        <Row label="Appearance">
          <div className="bg-surface-2 flex rounded-full p-0.5" role="radiogroup" aria-label="Appearance">
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => setTheme(t)}
                className={cn(
                  "h-9 flex-1 rounded-full px-3 text-[14px] transition-colors",
                  theme === t ? "bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted",
                )}
              >
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Notifications">
          {state === null && <p className="text-muted-dim text-[14px]">Checking…</p>}
          {(state === "enabled" || state === "available" || state === "granted") && (
            <button
              type="button"
              role="switch"
              aria-checked={state === "enabled"}
              disabled={busy}
              onClick={() => void toggle()}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
            >
              <span className="flex items-center gap-2.5 text-[15px]">
                <Bell className="size-4" strokeWidth={1.5} aria-hidden />
                {state === "enabled" ? "On for this device" : "Tell me when something's done"}
              </span>
              <span className={cn("relative h-7 w-12 rounded-full transition-colors", state === "enabled" ? "bg-brand" : "bg-surface-2")}>
                <span className={cn("bg-surface absolute top-0.5 size-6 rounded-full shadow-sm transition-transform", state === "enabled" ? "translate-x-5" : "translate-x-0.5")} />
              </span>
            </button>
          )}
          {state === "denied" && (
            <p className="text-muted flex items-start gap-2.5 text-[14px]">
              <BellOff className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              Blocked. I can't ask again; allow notifications for Reeve in your device settings.
            </p>
          )}
          {state === "unsupported" && (
            <p className="text-muted flex items-start gap-2.5 text-[14px]">
              <BellOff className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              Not available here. On iPhone, add Reeve to the Home Screen first.
            </p>
          )}
        </Row>

        <Row label="Account">
          {confirming ? (
            <div className="space-y-2 text-[14px]">
              <p className="text-muted">
                {pendingCount} unsent {pendingCount === 1 ? "message" : "messages"} will stay on this device and go when you sign back in.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void onSignOut()} className="bg-text text-bg h-10 rounded-full px-4 font-medium">
                  Sign out anyway
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-full px-4">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => void onSignOut()} className="text-muted hover:text-text flex min-h-[44px] items-center gap-2.5 text-[15px]">
              <LogOut className="size-4" strokeWidth={1.5} aria-hidden />
              Sign out
            </button>
          )}
        </Row>

        <p className="text-muted-dim text-[12px] tabular-nums">Reeve · build {__BUILD_ID__}</p>
      </div>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-dim mb-2 text-[12px] font-medium tracking-wide uppercase">{label}</p>
      {children}
    </div>
  );
}
