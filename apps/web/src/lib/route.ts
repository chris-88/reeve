/**
 * E-3c: the two addresses the app understands.
 *
 *   #/            the thread
 *   #/m/<id>      the thread, scrolled to and highlighting one message
 *
 * A message id is `<kind>:<uuid>` exactly as `thread_events` spells it
 * (`action:…`, `notice:…`, `capture:…`). A hash is the cheapest address that
 * survives a cold launch from a notification tap on an installed PWA, and the
 * service worker can hand it over without a reload (PN-1.4).
 */

export type Route = { messageId?: string };

const MESSAGE_ID = /^[a-z_-]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `"#/m/action:abc…"` → `{ messageId: "action:abc…" }`. Anything else → the thread. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (!path.startsWith("/m/")) return {};
  const id = decodeURIComponent(path.slice(3));
  return MESSAGE_ID.test(id) ? { messageId: id.toLowerCase() } : {};
}

/** The inverse. The thread is the root, so it writes an empty hash. */
export function hashFor(route: Route): string {
  return route.messageId ? `#/m/${route.messageId}` : "";
}
