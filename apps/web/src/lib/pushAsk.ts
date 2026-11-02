import { pushSupported } from "@/lib/push";

/**
 * PN-4: when to ask for notification permission.
 *
 * WP-F4.3 left the inline ask for "the moment the value is self-evident". With
 * the bridge, that moment is the first Go: the result will arrive as a push.
 * A denied permission is permanent, so the offer appears only when it can
 * succeed (installed, never asked), and "Not now" rests it for a week rather
 * than nagging on every Go.
 */
export const SNOOZE_KEY = "reeve.push-ask.snoozed-until";
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem">;

/** Pure: given the permission state and the store, should the line show? */
export function shouldOffer(
  permission: NotificationPermission | "unsupported",
  store: Store,
  now: number = Date.now(),
): boolean {
  if (permission !== "default") return false;
  const until = Number(store.getItem(SNOOZE_KEY) ?? 0);
  return !(Number.isFinite(until) && until > now);
}

export function snooze(store: Store, now: number = Date.now()): void {
  store.setItem(SNOOZE_KEY, String(now + SNOOZE_MS));
}

/** The browser-facing wrapper the screen calls after a Go. */
export function shouldOfferPush(): boolean {
  if (typeof window === "undefined" || !pushSupported()) return false;
  return shouldOffer(Notification.permission, window.localStorage);
}

export function snoozePushAsk(): void {
  snooze(window.localStorage);
}
