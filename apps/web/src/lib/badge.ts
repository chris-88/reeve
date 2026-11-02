/**
 * PN-2: the app-icon badge is the Needs you count.
 *
 * Set by the app whenever the count changes and by the worker on every push
 * (the payload carries the same number, computed by `send-push`), so the icon
 * is right before the app is next opened. The Badging API exists on installed
 * iOS web apps since 16.4; everywhere else this is a no-op.
 */
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function badgeSupported(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as BadgeNavigator).setAppBadge === "function";
}

export async function applyBadge(count: number): Promise<void> {
  if (!badgeSupported()) return;
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) await nav.setAppBadge!(count);
    else if (nav.clearAppBadge) await nav.clearAppBadge();
    else await nav.setAppBadge!(0);
  } catch {
    /* a refused badge is not an error anyone can act on */
  }
}
