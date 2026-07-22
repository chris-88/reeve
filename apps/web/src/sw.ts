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
