export type Pusher = (userId: string, n: { title: string; body?: string; url?: string; tag?: string }) => Promise<void>;

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
      log(`push ${res.status} ${body.slice(0, 120)}`);
    } catch (err) {
      log(`push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
