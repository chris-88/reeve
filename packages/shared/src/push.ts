/**
 * Web Push payloads and the rules for pruning dead subscriptions.
 *
 * Pure on purpose. WP-F6.1 asks for these two things to be unit-tested and
 * they are the two places the bugs will be: a payload that leaks content onto
 * a lock screen, and a dead endpoint that is retried forever because nobody
 * decided what "dead" means.
 */

/**
 * What a notification may say.
 *
 * WP-F3.4: **identifiers and user-authored titles, never content.** Not
 * `raw_text`, not a commitment body, not model output. A notification renders
 * on a lock screen — a more exposed surface than the telemetry hardening F7.4
 * already scrubs, and one the owner cannot choose not to look at.
 *
 * The shape is closed and `buildPushPayload` copies field by field, so a
 * caller cannot widen it by passing extra keys through.
 */
export type PushNotification = {
  /** Short. Shown bold on the lock screen. */
  title: string;
  /** Optional second line. Counts and dates are fine; extracted text is not. */
  body?: string;
  /** In-app path to open on tap. Must be same-origin and relative. */
  url?: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
};

/** iOS truncates well before this; the limit is about payload size, not looks. */
const MAX_TITLE = 120;
const MAX_BODY = 300;

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * The exact JSON the service worker will parse.
 *
 * Field by field rather than a spread: an object handed in with a `raw_text`
 * key must not reach the wire because someone added a field upstream and
 * forgot this existed.
 */
export function buildPushPayload(notification: PushNotification): string {
  const payload: PushNotification = { title: clip(notification.title, MAX_TITLE) || "Reeve" };

  if (notification.body) {
    const body = clip(notification.body, MAX_BODY);
    if (body) payload.body = body;
  }
  if (notification.tag) payload.tag = notification.tag;

  // Relative, same-origin only. A push payload is attacker-controlled the
  // moment anything upstream of it is, and `notificationclick` navigates.
  if (notification.url?.startsWith("/") && !notification.url.startsWith("//")) {
    payload.url = notification.url;
  }

  return JSON.stringify(payload);
}

/**
 * WP-F5.3: does this response mean the subscription is gone for good?
 *
 * 404 and 410 are the push service saying the endpoint no longer exists — the
 * app was uninstalled, or its storage cleared. The row must be deleted, or
 * every subsequent send fails against it forever and the failure rate stops
 * meaning anything.
 *
 * Everything else is transient or a bug on our side: record it, keep the row.
 * A 401 or 403 means the VAPID configuration is wrong, and deleting the user's
 * subscriptions because the sender is misconfigured would be a rout.
 */
export function isSubscriptionGone(status: number): boolean {
  return status === 404 || status === 410;
}
