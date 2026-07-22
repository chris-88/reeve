/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

/**
 * Reeve's service worker.
 *
 * Owned rather than generated, because Web Push, Background Sync and a share
 * target are all handlers that belong in this file, and adding them should be
 * an edit rather than a migration off generateSW.
 */

// The precache manifest is injected here at build time.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/**
 * Navigation: try the network, fall back to the precached shell.
 *
 * This is what makes a cold launch work with no connectivity at all — without
 * it the app does not load, so the local-first capture queue never gets the
 * chance to run.
 */
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "reeve-navigation",
      networkTimeoutSeconds: 3,
    }),
  ),
);

/**
 * Areas: change roughly never, and the inbox is unreadable without them —
 * every row's colour and label comes from here.
 */
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/areas"),
  new StaleWhileRevalidate({
    cacheName: "reeve-areas",
    plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

/**
 * Captures: a stale inbox beats an empty one. The persisted query cache is the
 * primary offline read path; this is defence in depth for a cold worker.
 */
registerRoute(
  ({ url }) =>
    url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/captures"),
  new NetworkFirst({
    cacheName: "reeve-captures",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
  }),
);

/**
 * Never cached, deliberately:
 *
 *   /auth/v1/*       caching an auth response is a security defect, and a
 *                    cached token would outlive its own revocation
 *   /functions/v1/*  non-idempotent from the client's point of view
 *
 * Both are left to fall through to the network with no route registered. Since
 * Reeve is single-user this is theoretical today; it is stated here so that it
 * stays true when it stops being theoretical.
 */

/**
 * Take control as soon as this worker activates.
 *
 * Without claim(), a freshly installed worker does not control the page that
 * registered it — so the very first session after install has no offline
 * capability, which is exactly the session where someone is most likely to
 * walk out of signal. Safe alongside registerType "prompt": an *update* only
 * activates after an explicit skipWaiting below, and the page reloads with it.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Applying an update is an explicit user action — see UpdatePrompt.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

/* ---------------------------------------------------------------------------
 * Web Push
 *
 * The payload carries identifiers and titles the user wrote themselves — never
 * `raw_text`, never a commitment body, never model output (WP-F3.4). A
 * notification renders on a lock screen, which is a more exposed surface than
 * the telemetry hardening F7.4 already scrubs.
 * ------------------------------------------------------------------------- */

type PushPayload = {
  title?: string;
  body?: string;
  /** In-app path to open. Defaults to the root. */
  url?: string;
  /** Collapses replacements of the same logical notification. */
  tag?: string;
};

/**
 * WP-F3.1.
 *
 * A notification is shown even when the payload is missing or unparseable. iOS
 * revokes the permission from an app that receives a push and displays
 * nothing, and the permission cannot be requested again — so showing something
 * slightly wrong is recoverable and showing nothing is not.
 */
self.addEventListener("push", (event) => {
  let payload: PushPayload;
  try {
    payload = (event.data?.json() as PushPayload | undefined) ?? {};
  } catch {
    payload = {};
  }

  const title = payload.title?.trim() || "Reeve";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body?.trim() || undefined,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

/**
 * WP-F3.2: focus what is already open rather than opening a second window.
 *
 * `launch_handler: focus-existing` in the manifest tells the platform the same
 * thing; this is the half that runs when the platform hands the click to the
 * worker instead.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data as { url?: string } | undefined)?.url ?? "/",
    self.location.origin,
  );

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        if ("navigate" in client && client.url !== target.href) {
          await client.navigate(target.href).catch(() => {});
        }
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

/**
 * WP-F3.3: the subscription was rotated by the push service.
 *
 * The worker has no Supabase client and no session, so it cannot write the new
 * endpoint itself. It asks an open page to do it, and only falls back to a
 * bare REST call when no page is open — that fallback is best-effort, because
 * the anon key alone cannot satisfy the owner-scoped insert policy. The
 * durable repair is `syncSubscription()` on next launch; this just shortens
 * the window in which pushes silently go nowhere.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const oldEndpoint = (event as PushSubscriptionChangeEvent).oldSubscription?.endpoint;
      for (const client of clients) {
        client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", oldEndpoint });
      }
    })(),
  );
});

/** Not in TypeScript's lib.dom yet, and only the two fields are used. */
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription?: PushSubscription;
  readonly newSubscription?: PushSubscription;
}
