import { env } from "./env";
import { supabase } from "./supabase";

/**
 * Web Push, client side.
 *
 * The constraint that shapes every decision here: **a denied permission is
 * effectively permanent.** The app cannot re-prompt, so asking at the wrong
 * moment burns the only chance there is. Nothing in this file calls
 * `requestPermission()` except `enablePush()`, and that is only ever reached
 * from a tap on an affirmative control.
 */

export type PushState =
  /** No push at all: not iOS-installed, or the APIs are absent. */
  | "unsupported"
  /** Available and never asked. The only state in which an offer is shown. */
  | "available"
  /** Granted, and this device has a live subscription. */
  | "enabled"
  /** Granted at the browser level but no subscription here yet. */
  | "granted"
  /** Refused. Only system settings can undo it, and the app must say so. */
  | "denied";

/**
 * WP-F4.2: can push work here at all?
 *
 * On iOS, push exists only for an app installed to the Home Screen — in a
 * Safari tab `Notification` is undefined and `subscribe()` cannot succeed. An
 * offer that cannot succeed is worse than no offer, so this gates the UI
 * rather than the outcome.
 */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("PushManager" in window)) return false;
  if (!("serviceWorker" in navigator)) return false;

  // Standalone is required on iOS and harmless to require elsewhere: a
  // notification is only useful to someone who installed the app.
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return standalone;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "available";

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? "enabled" : "granted";
}

/**
 * base64url VAPID key -> the bytes `subscribe()` wants.
 *
 * Backed by an explicit ArrayBuffer rather than `Uint8Array.from`, because the
 * latter infers `ArrayBufferLike` — which includes SharedArrayBuffer, and
 * `PushSubscriptionOptionsInit` will not take one.
 */
function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The two keys a push service needs to encrypt for this device. */
function subscriptionKeys(sub: PushSubscription): { p256dh: string; auth: string } {
  const read = (name: "p256dh" | "auth") => {
    const raw = sub.getKey(name);
    if (!raw) throw new Error(`subscription is missing its ${name} key`);
    return btoa(String.fromCharCode(...new Uint8Array(raw)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };
  return { p256dh: read("p256dh"), auth: read("auth") };
}

async function store(userId: string, sub: PushSubscription): Promise<void> {
  const { p256dh, auth } = subscriptionKeys(sub);
  // WP-F2.2: upsert on the endpoint. A device that reinstalls presents the
  // same endpoint and must update one row rather than add another.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 255),
      last_error: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

/**
 * Subscribe this device and record it.
 *
 * WP-F4.4: this is the only path that calls `requestPermission()`, and it must
 * only be reached from a tap on the affirmative control. Ignoring an offer is
 * not a denial, and must leave the door open.
 */
export async function enablePush(userId: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "available";

  const registration = await navigator.serviceWorker.ready;
  const sub =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Required, and required to be true: iOS revokes the permission of an
      // app that receives a push without displaying one.
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(env.VITE_VAPID_PUBLIC_KEY),
    }));

  await store(userId, sub);
  return "enabled";
}

/** Remove this device. The row goes with it — see the migration's note on why. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return "granted";

  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
  return "granted";
}

/**
 * Reconcile the stored row with what this device actually holds.
 *
 * Subscriptions are rotated by the push service without asking, and the worker
 * that hears about it (`pushsubscriptionchange`) has no session to write with.
 * Running this on launch is the durable repair; the worker's message just
 * makes it happen sooner.
 */
export async function syncSubscription(userId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return;
  try {
    await store(userId, sub);
  } catch (err) {
    console.warn("[reeve] could not record push subscription", err);
  }
}

/** Listen for the worker telling us the endpoint moved. */
export function watchSubscriptionChanges(userId: string): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type !== "PUSH_SUBSCRIPTION_CHANGED") return;
    const oldEndpoint = event.data.oldEndpoint as string | undefined;
    void (async () => {
      // Drop the stale row first: it is dead, and every future send against it
      // fails until something removes it.
      if (oldEndpoint) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", oldEndpoint);
      }
      await syncSubscription(userId);
    })();
  };

  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
