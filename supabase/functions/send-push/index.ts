import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  buildPushPayload,
  isSubscriptionGone,
  type PushNotification,
} from "../../../packages/shared/src/index.ts";

/**
 * WP-F5: the one place a push is sent from.
 *
 * A function rather than a library import, so that every sender — the daily
 * brief, the change-request webhook, whatever Stage 6 brings — goes through
 * one implementation. Two call sites assembling VAPID headers two different
 * ways is how one of them quietly stops working, and a push that silently
 * stops arriving is indistinguishable from having nothing to say.
 *
 * Service-key only. This is an unauthenticated-looking endpoint that sends
 * notifications to a person's lock screen; the caller must already hold full
 * access for that to be an acceptable thing to expose.
 */

type SendRequest = { user_id: string; notification: PushNotification };

type Subscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");

  if (!supabaseUrl || !secretKey) return json({ error: "function is not configured" }, 500);

  // WP-F1.1: all three, not two. `setVapidDetails` throws on a missing subject
  // at send time rather than at deploy time, so the failure would otherwise
  // arrive as a silent non-delivery long after the deploy that caused it.
  if (!publicKey || !privateKey || !subject) {
    return json({ error: "VAPID is not configured" }, 500);
  }

  // No browser ever calls this, so there is no CORS block and no caller to
  // identify from a JWT — possessing the secret key is the whole authorisation.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token !== secretKey) return json({ error: "unauthorised" }, 401);

  let body: SendRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (typeof body?.user_id !== "string" || typeof body?.notification?.title !== "string") {
    return json({ error: "user_id and notification.title are required" }, 400);
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const db = createClient(supabaseUrl, secretKey);
  const { data: subscriptions, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", body.user_id);

  if (error) return json({ error: error.message }, 500);
  if (!subscriptions?.length) return json({ sent: 0, pruned: 0, failed: 0, no_subscriptions: true });

  const payload = buildPushPayload(body.notification);
  const results = await Promise.allSettled(
    (subscriptions as Subscription[]).map((sub) => deliver(db, sub, payload)),
  );

  // WP-F5.2: one dead device must not stop the others. allSettled, not all.
  const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value : "failed"));
  return json({
    sent: outcomes.filter((o) => o === "sent").length,
    pruned: outcomes.filter((o) => o === "pruned").length,
    failed: outcomes.filter((o) => o === "failed").length,
  });
});

async function deliver(
  db: SupabaseClient,
  sub: Subscription,
  payload: string,
): Promise<"sent" | "pruned" | "failed"> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
    await db
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString(), last_error: null })
      .eq("id", sub.id);
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 0;
    const message = err instanceof Error ? err.message : String(err);

    // WP-F5.3: the push service is telling us this endpoint is gone. Left in
    // place it fails on every send from now until someone notices, and the
    // failure count stops carrying information.
    if (isSubscriptionGone(status)) {
      await db.from("push_subscriptions").delete().eq("id", sub.id);
      return "pruned";
    }

    await db
      .from("push_subscriptions")
      .update({ last_error: message.slice(0, 500) })
      .eq("id", sub.id);
    // WP-F5.5: logged, never surfaced. Per P1-F6.8 a failure at seven in the
    // morning must not become a user-facing error.
    console.error("[reeve] push failed", sub.id, status, message);
    return "failed";
  }
}
