export type Notification = { title: string; body?: string; url?: string; tag?: string };
export type Pusher = (userId: string, n: Notification) => Promise<void>;

/**
 * PN-1.3 / PN-5.1: the address and tag the web app reads. Spelled here rather
 * than imported because the worker takes only types from @reeve/shared (see
 * db.ts); tests/bridge.test.ts asserts these match the shared definitions.
 */
export const actionPath = (actionId: string) => `/#/m/action:${actionId}`;
export const actionTag = (actionId: string) => `action:${actionId}`;
export const noticePath = (noticeId: string) => `/#/m/notice:${noticeId}`;
export const THREAD_PATH = "/#/";

/**
 * BR-3.4 / PN-1.3: what the phone shows when a run comes back. The title is the
 * action's (Chris's words); the body is the result's first line, written to be
 * read on a lock screen, or a fixed line on failure. Tapping opens the card.
 */
export function resultNotification(action: { id: string; title: string }, ok: boolean, result: string): Notification {
  return {
    title: `Reeve: ${action.title}`,
    body: ok ? result.split("\n")[0]?.slice(0, 200) : "Could not complete it. Tap to see why.",
    url: actionPath(action.id),
    tag: actionTag(action.id),
  };
}

/**
 * BR-3.4: the push on every result, through the one send-push function (WP-F5).
 * Best effort: a failed push is logged, never a failed run. Title and body stay
 * within WP-F3.4 — the action's title (user-authored) and the result's first
 * line, which the bridge wrote to be read on a lock screen.
 */
export function makePusher(functionsUrl: string, serviceRoleKey: string, log: (s: string) => void): Pusher {
  return async (userId, notification) => {
    try {
      const res = await fetch(`${functionsUrl}/send-push`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ user_id: userId, notification }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      // The address and tag are logged (never the body: WP-F3.4 applies to logs too).
      log(`push ${notification.tag ?? "-"} ${notification.url ?? "-"} → ${res.status} ${body.slice(0, 120)}`);
    } catch (err) {
      log(`push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
