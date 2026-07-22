import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  BRIEF_JSON_SCHEMA,
  BriefResult,
  MODELS,
  buildBriefSystemPrompt,
  buildBriefUserPrompt,
  ceilingOr,
  checkBudget,
  costUsd,
  DEFAULT_DAILY_CEILING_USD,
  DEFAULT_MONTHLY_CEILING_USD,
  recordRefusal,
  reportToSentry,
  TIMEZONE,
  type BriefContext,
} from "../../../packages/shared/src/index.ts";

/**
 * P1-F6: the daily brief.
 *
 * The first agent on a schedule, and chosen for what it cannot do. No tools,
 * no credentials, no sandbox, nothing to write but its own table, and no
 * contact with the outside world beyond one model call and one notification.
 * The worst failure available to it is a badly written paragraph.
 *
 * That risk profile is the point. The first thing deployed unattended should
 * not also be the first thing capable of causing harm.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dsn = Deno.env.get("SENTRY_DSN");

  if (!anthropicKey || !supabaseUrl || !secretKey) {
    return json({ error: "function is not configured" }, 500);
  }

  // Scheduled work only. No browser calls this and there is no user JWT to
  // resolve — possessing the secret key is the whole authorisation.
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

  // The window is the calendar day in Dublin that is just beginning.
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
  const periodStart = new Date(`${today}T00:00:00.000Z`);
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);

  // Idempotency before spend. The scheduler is at-least-once, and finding out
  // a brief already exists after paying for a Sonnet call is the wrong order.
  const { data: existing } = await db
    .from("briefs")
    .select("id")
    .eq("user_id", userId)
    .eq("period_start", periodStart.toISOString())
    .maybeSingle();
  if (existing) return json({ status: "already", brief_id: existing.id });

  /**
   * P1-F5.2. Before the model call, not after.
   *
   * Refusing is the correct behaviour: this system's job is capture and
   * drafting, and neither is worth an unbounded bill. A missing brief is a
   * missing paragraph.
   */
  const verdict = await checkBudget(db, userId, {
    dailyUsd: ceilingOr(Deno.env.get("REEVE_DAILY_CEILING_USD"), DEFAULT_DAILY_CEILING_USD),
    monthlyUsd: ceilingOr(Deno.env.get("REEVE_MONTHLY_CEILING_USD"), DEFAULT_MONTHLY_CEILING_USD),
  });
  if (!verdict.ok) {
    await recordRefusal(db, { userId, step: "brief", model: MODELS.brief, verdict, dsn });
    return json({ status: "refused", reason: verdict.reason }, 200);
  }

  const context = await gatherContext(db, userId, periodStart, periodEnd);

  // Nothing owed and nothing captured is not worth a model call or a
  // notification. Silence on a quiet morning is the right output.
  if (
    context.overdue.length === 0 &&
    context.dueToday.length === 0 &&
    context.dueThisWeek.length === 0 &&
    context.captured.length === 0
  ) {
    return json({ status: "nothing_to_say" });
  }

  const started = Date.now();
  let usage = { input_tokens: 0, output_tokens: 0 };

  try {
    const result = await draft({
      apiKey: anthropicKey,
      system: buildBriefSystemPrompt(),
      user: buildBriefUserPrompt(context),
      onUsage: (u) => (usage = u),
    });

    const { data: brief, error } = await db
      .from("briefs")
      .insert({
        user_id: userId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        body: result.body,
        model: MODELS.brief,
      })
      .select("id")
      .single();
    if (error) throw new Error(`briefs insert: ${error.message}`);

    await log(db, { userId, usage, started, ok: true });

    /**
     * P1-F6.7 delivery, and WP-F5.4: best effort, never blocking.
     *
     * A brief that generated but failed to notify is still a brief. The
     * notification is not the transaction — and the headline is the model's
     * own words about counts, not a capture's text (WP-F3.4).
     */
    await notify(supabaseUrl, secretKey, userId, result.headline);

    return json({ status: "done", brief_id: brief.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, { userId, usage, started, ok: false, error: message });

    // P1-F6.8: silent to the user. A failure at ten past six in the morning
    // must not become a notification; it is visible in agent_runs and here.
    await reportToSentry(dsn, {
      message: `brief failed: ${message}`,
      level: "error",
      tags: { step: "brief" },
      extra: { user_id: userId, period_start: periodStart.toISOString() },
    });

    return json({ status: "failed", error: message }, 500);
  }
});

/**
 * P1-F6.3: the context, from the tables rather than from bespoke prose.
 *
 * Commitments due or overdue in the window, captures created in the window,
 * and the size of the unsorted pile. Only what the model needs to name things
 * Chris will recognise — never `raw_text`, which is neither needed nor safe to
 * put through a third party for a paragraph.
 */
async function gatherContext(
  db: SupabaseClient,
  userId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<BriefContext> {
  const weekEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [{ data: commitments }, { data: captures }, { count: unsorted }] = await Promise.all([
    db
      .from("commitments")
      .select("text, due_at, area_id")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(60),
    db
      .from("captures")
      .select("title, area_id")
      .eq("user_id", userId)
      .gte("created_at", new Date(periodStart.getTime() - 24 * 60 * 60 * 1000).toISOString())
      .not("title", "is", null)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("captures")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("area_id", "unsorted"),
  ]);

  const day = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-IE", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) : null;

  const rows = (commitments ?? []).map((c) => ({
    text: c.text as string,
    due_at: c.due_at as string | null,
    area: (c.area_id as string | null) ?? null,
  }));

  const shape = (r: (typeof rows)[number]) => ({ text: r.text, due: day(r.due_at), area: r.area });

  return {
    today: new Intl.DateTimeFormat("en-IE", {
      timeZone: TIMEZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(periodStart),
    overdue: rows.filter((r) => r.due_at && new Date(r.due_at) < periodStart).map(shape),
    dueToday: rows
      .filter((r) => r.due_at && new Date(r.due_at) >= periodStart && new Date(r.due_at) < periodEnd)
      .map(shape),
    dueThisWeek: rows
      .filter((r) => r.due_at && new Date(r.due_at) >= periodEnd && new Date(r.due_at) < weekEnd)
      .map(shape),
    captured: (captures ?? []).map((c) => ({
      title: c.title as string,
      area: (c.area_id as string | null) ?? null,
    })),
    unsortedCount: unsorted ?? 0,
  };
}

/** One model call, validated. The triage function is the reference for this. */
async function draft(opts: {
  apiKey: string;
  system: string;
  user: string;
  onUsage: (u: { input_tokens: number; output_tokens: number }) => void;
}): Promise<BriefResult> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELS.brief,
      max_tokens: 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { format: { type: "json_schema", schema: BRIEF_JSON_SCHEMA } },
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  opts.onUsage(body.usage ?? { input_tokens: 0, output_tokens: 0 });

  // P1-F6.5: check stop_reason before reading content — on a refusal or a
  // truncated response, content may be empty or partial.
  if (body.stop_reason === "refusal") {
    throw new Error(`refused: ${body.stop_details?.category ?? "unspecified"}`);
  }
  if (body.stop_reason === "max_tokens") throw new Error("response truncated at max_tokens");

  const text = body.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in response");

  const parsed = BriefResult.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`brief failed validation: ${parsed.error.message}`);
  return parsed.data;
}

async function notify(
  supabaseUrl: string,
  secretKey: string,
  userId: string,
  headline: string,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${secretKey}` },
      body: JSON.stringify({
        user_id: userId,
        notification: { title: "Today", body: headline, url: "/due", tag: "brief" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error("[reeve] brief notification failed", err);
  }
}

async function log(
  db: SupabaseClient,
  o: {
    userId: string;
    usage: { input_tokens: number; output_tokens: number };
    started: number;
    ok: boolean;
    error?: string;
  },
): Promise<void> {
  // P1-F6.6: every attempt, success or failure. capture_id is null — a brief
  // belongs to a window, not to one capture.
  await db.from("agent_runs").insert({
    user_id: o.userId,
    capture_id: null,
    step: "brief",
    model: MODELS.brief,
    input_tokens: o.usage.input_tokens,
    output_tokens: o.usage.output_tokens,
    cost_usd: costUsd(MODELS.brief, o.usage.input_tokens, o.usage.output_tokens),
    duration_ms: Date.now() - o.started,
    ok: o.ok,
    error: o.error ?? null,
  });
}
