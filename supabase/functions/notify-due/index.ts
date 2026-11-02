import { createClient } from "@supabase/supabase-js";
import { DUE_PATH, dueReminder, dueWindow } from "../../../packages/shared/src/index.ts";

/**
 * PN-3: the morning "due today" line.
 *
 * Dispatched by pg_cron (`run_due_reminders`, migration 0018) at 07:30 Dublin
 * time, one call per user with something open. Reads open commitments, splits
 * them by the Dublin calendar day, and sends one push through `send-push` —
 * or nothing, when the day is clear. Service-key only, like every scheduled
 * function: no browser calls this.
 */
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !secretKey) return json({ error: "function is not configured" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token !== secretKey) return json({ error: "unauthorised" }, 401);

  let userId: string;
  try {
    ({ user_id: userId } = await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (typeof userId !== "string") return json({ error: "user_id is required" }, 400);

  const db = createClient(supabaseUrl, secretKey);
  const { data, error } = await db
    .from("commitments")
    .select("text, due_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .not("due_at", "is", null)
    .order("due_at", { ascending: true })
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  const window = dueWindow((data ?? []) as { text: string; due_at: string }[]);
  const reminder = dueReminder(window);
  if (!reminder) return json({ sent: 0, today: 0, overdue: 0 });

  const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${secretKey}` },
    body: JSON.stringify({
      user_id: userId,
      notification: { ...reminder, url: DUE_PATH, tag: "due" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const outcome = await res.json().catch(() => ({}));
  return json({
    ...outcome,
    today: window.today.length,
    overdue: window.overdue.length,
  });
});
