/**
 * PN-1: the hash routes the app understands.
 *
 *   #/capture · #/needs-you · #/needs-you/<actionId> · #/work · #/due
 *
 * The app has no router and does not want one: four screens held in state,
 * plus one thing a notification needs to say — "open this card". A hash is the
 * cheapest address that survives a cold launch from a notification tap on an
 * installed PWA, and the service worker can hand it over without a reload.
 */

export const SCREENS = ["capture", "needs-you", "work", "due"] as const;
export type Screen = (typeof SCREENS)[number];

export type Route = { screen: Screen; actionId?: string };

const DEFAULT: Route = { screen: "capture" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isScreen(s: string): s is Screen {
  return (SCREENS as readonly string[]).includes(s);
}

/** `"#/needs-you/abc"` → `{ screen: "needs-you", actionId: "abc" }`. Anything else → Capture. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (!path.startsWith("/")) return DEFAULT;
  const [screen = "", id = ""] = path.slice(1).split("/");
  if (!isScreen(screen)) return DEFAULT;
  if (screen === "needs-you" && UUID.test(id)) return { screen, actionId: id.toLowerCase() };
  return { screen };
}

/** The inverse. Capture is the root, so it writes an empty hash rather than `#/capture`. */
export function hashFor(route: Route): string {
  if (route.screen === "needs-you" && route.actionId) return `#/needs-you/${route.actionId}`;
  return route.screen === "capture" ? "" : `#/${route.screen}`;
}

