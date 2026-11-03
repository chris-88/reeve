import { createClient } from "@supabase/supabase-js";
import { noticePath, THREAD_PATH, dueReminder, dueWindow } from "../../../packages/shared/src/index.ts";

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
    .select("id, text, due_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .not("due_at", "is", null)
    .order("due_at", { ascending: true })
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as { id: string; text: string; due_at: string }[];
  const window = dueWindow(rows);
  const reminder = dueReminder(window);
  if (!reminder) return json({ sent: 0, today: 0, overdue: 0 });

  // E-4: the digest is a card in the thread with one tick per item. The notice
  // carries the item ids; the card reads their current status live.
  const items = [...window.overdue, ...window.today].map((i) => ({
    id: rows.find((r) => r.text === i.text && r.due_at === i.due_at)?.id ?? null,
    text: i.text,
    due_at: i.due_at,
  }));
  const { data: notice } = await db
    .from("notices")
    .insert({
      user_id: userId,
      kind: "due",
      body: `${reminder.title}. ${reminder.body}`,
      meta: { items, today: window.today.length, overdue: window.overdue.length },
    })
    .select("id")
    .single();

  const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${secretKey}` },
    body: JSON.stringify({
      user_id: userId,
      notification: { ...reminder, url: notice?.id ? noticePath(notice.id) : THREAD_PATH, tag: "due" },
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
