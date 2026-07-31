import { useEffect, useState } from "react";
import { Bell, BellOff, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import ResponsiveSheet from "@/components/ResponsiveSheet";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { pendingOutboxCount, signOut } from "@/lib/session";

/**
 * WP-F4.5: the notification state, stated honestly.
 *
 * The Web Push spec assumes a settings surface exists as the secondary path
 * for anyone who ignored the inline ask. None did — Reeve has three screens
 * and no settings anywhere — so this is the minimum that satisfies it. It is
 * also the obvious home for sign-out when hardening F10 lands, which is the
 * other thing currently unreachable without developer tools.
 */
export default function Settings({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function onSignOut() {
    // F10.2: warn if there is unsent work — it stays on the device, but the
    // user should know why signing back in shows it still pending.
    const n = await pendingOutboxCount();
    if (n > 0 && !confirming) {
      setPendingCount(n);
      setConfirming(true);
      return;
    }
    setSigningOut(true);
    // App re-renders to the sign-in screen on the auth event; this sheet
    // unmounts with it, so there is nothing to reset here.
    await signOut();
  }

  async function toggle() {
    setBusy(true);
    try {
      // WP-F4.4: requestPermission() is reached only from this tap. Opening
      // the sheet, reading it and closing it again must leave the door open —
      // a denial cannot be undone by the app.
      setState(state === "enabled" ? await disablePush() : await enablePush(userId));
    } catch (err) {
      console.error("[reeve] push toggle failed", err);
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet title="Settings" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <div>
          <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
            Notifications
          </h3>

          {state === null && <p className="text-muted-dim mt-2.5 text-sm">Checking…</p>}

          {state === "enabled" && (
            <div className="mt-2.5 space-y-3">
              <p className="flex items-center gap-2.5 text-sm">
                <Bell className="size-4 shrink-0" aria-hidden />
                On for this device.
              </p>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void toggle()}>
                Turn off
              </Button>
            </div>
          )}

          {(state === "available" || state === "granted") && (
            <div className="mt-2.5 space-y-3">
              <p className="text-muted-foreground text-sm">
                Get told when something is due or a change ships, without opening the app.
              </p>
              <Button type="button" size="sm" disabled={busy} onClick={() => void toggle()}>
                <Bell className="size-4" aria-hidden />
                Turn on
              </Button>
            </div>
          )}

          {/*
            Honesty matters more than tidiness here. The app genuinely cannot
            undo a denial — saying anything else would send someone tapping a
            control that can never work.
          */}
          {state === "denied" && (
            <p className="text-muted-foreground mt-2.5 flex items-start gap-2.5 text-sm">
              <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Blocked. Reeve can&rsquo;t ask again — you&rsquo;d have to allow notifications
                for this app in your device settings.
              </span>
            </p>
          )}

          {state === "unsupported" && (
            <p className="text-muted-foreground mt-2.5 flex items-start gap-2.5 text-sm">
              <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Not available here. On iPhone, notifications only work once Reeve is added to
                the Home Screen.
              </span>
            </p>
          )}
        </div>

        <div className="border-border/40 border-t pt-6">
          <h3 className="text-muted-dim text-[0.7rem] font-semibold tracking-widest uppercase">
            Account
          </h3>

          {confirming ? (
            <div className="mt-2.5 space-y-3">
              <p className="text-muted-foreground text-sm">
                {pendingCount} unsent {pendingCount === 1 ? "capture" : "captures"} will stay on
                this device and sync when you sign back in. Sign out anyway?
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={signingOut} onClick={() => void onSignOut()}>
                  Sign out anyway
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={signingOut}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={() => void onSignOut()}
              className="mt-2.5"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          )}
        </div>
      </div>
    </ResponsiveSheet>
  );
}
