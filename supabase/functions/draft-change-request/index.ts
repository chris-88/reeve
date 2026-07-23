import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ceilingOr,
  checkBudget,
  costUsd,
  DEFAULT_DAILY_CEILING_USD,
  DEFAULT_MONTHLY_CEILING_USD,
  DRAFT_JSON_SCHEMA,
  DraftResult,
  MODELS,
  recordRefusal,
  reportToSentry,
  buildChangeRequestSystemPrompt,
  buildChangeRequestUserPrompt,
  type SourceCapture,
} from "../../../packages/shared/src/index.ts";

/**
 * P1-F8: the drafting agent.
 *
 * Turns fragmentary dictated notes into something worth handing to a
 * developer. Two triggers (F8.1): on demand, with an explicit set of captures,
 * which produces a `proposed` row awaiting Chris; and a weekly scheduled pass
 * over the unpromoted `reeve` pile, which produces `draft` rows only and never
 * advances to `proposed` without being read.
 *
 * The agent reads captures and nothing else (F12.6), writes only its own
 * change_requests row, and cannot act on the outside world — that is P1-F9's
 * job, behind an explicit approval.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * First-version clustering ceiling. §7 says clustering "wants P1-F4's
 * retrieval" and that "a first version needs neither" — so the first version
 * treats the unpromoted pile as one cluster. Above this it is genuinely a
 * clustering problem retrieval should solve, so the pass logs and skips rather
 * than drafting one incoherent monster. That skip is the observation that
 * earns the retrieval-backed version.
 */
const MAX_SCHEDULED_PILE = 8;

// The browser invokes this on demand (F11.1's "Draft a change"), so the same
// CORS discipline as triage applies: the preflight must allow exactly the
// headers supabase-js sends, or the request is blocked before it arrives.
const ALLOWED_ORIGINS = new Set(["https://app.chrisquinn.ie", "http://localhost:5173"]);

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":
      origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://app.chrisquinn.ie",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "content-type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dsn = Deno.env.get("SENTRY_DSN");

  if (!anthropicKey || !supabaseUrl || !secretKey) {
    return json({ error: "function is not configured" }, 500);
  }

  const db = createClient(supabaseUrl, secretKey);

  // Two callers: the cron pass presents the service key; the browser presents
  // a user's own JWT. The scheduled pass is service-only, and an on-demand
  // request is scoped to whoever the JWT resolves to — a user cannot draft
  // from another account's captures.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const isService = token === secretKey;
  const {
    data: { user },
  } = isService ? { data: { user: null } } : await db.auth.getUser(token);
  if (!isService && !user) return json({ error: "unauthorised" }, 401);

  let payload: { capture_ids?: unknown; mode?: unknown; user_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  // Only the cron may run the scheduled pass; the browser only ever drafts
  // from an explicit set of captures.
  const scheduled = payload.mode === "scheduled" && isService;

  // Resolve the captures to draft from, and whose account they belong to.
  let userId: string;
  let captures: SourceCapture[];

  if (scheduled) {
    if (typeof payload.user_id !== "string") return json({ error: "user_id is required" }, 400);
    userId = payload.user_id;
    captures = await unpromotedReevePile(db, userId);
    if (captures.length < 2) return json({ status: "nothing_to_cluster", pile: captures.length });
    if (captures.length > MAX_SCHEDULED_PILE) {
      // Do not silently draft an incoherent pile. This is the recorded miss.
      await reportToSentry(dsn, {
        message: `change-request clustering skipped: pile of ${captures.length} exceeds first-version ceiling`,
        level: "warning",
        tags: { step: "change_request", reason: "pile_too_large" },
        extra: { user_id: userId, pile: captures.length, ceiling: MAX_SCHEDULED_PILE },
      });
      return json({ status: "pile_too_large", pile: captures.length });
    }
  } else {
    const ids = Array.isArray(payload.capture_ids) ? (payload.capture_ids as unknown[]) : [];
    if (ids.length === 0 || !ids.every((i) => typeof i === "string")) {
      return json({ error: "capture_ids must be a non-empty array of ids" }, 400);
    }
    const resolved = await resolveCaptures(db, ids as string[]);
    if (!resolved) return json({ error: "captures not found or span more than one account" }, 400);
    ({ userId, captures } = resolved);

    // A browser caller may only draft from its own captures. The service key
    // is trusted; a user JWT is scoped to itself.
    if (user && userId !== user.id) return json({ error: "unauthorised" }, 403);
  }

  // P1-F5.2: before the model call, not after. The ceiling is shared across
  // every agent, so a runaway anywhere stops the drafting agent too.
  const verdict = await checkBudget(db, userId, {
    dailyUsd: ceilingOr(Deno.env.get("REEVE_DAILY_CEILING_USD"), DEFAULT_DAILY_CEILING_USD),
    monthlyUsd: ceilingOr(Deno.env.get("REEVE_MONTHLY_CEILING_USD"), DEFAULT_MONTHLY_CEILING_USD),
  });
  if (!verdict.ok) {
    await recordRefusal(db, { userId, step: "change_request", model: MODELS.change_request, verdict, dsn });
    return json({ status: "refused", reason: verdict.reason }, 200);
  }

  const started = Date.now();
  let usage = { input_tokens: 0, output_tokens: 0 };

  try {
    const result = await draft({
      apiKey: anthropicKey,
      system: buildChangeRequestSystemPrompt(),
      user: buildChangeRequestUserPrompt(captures),
      onUsage: (u) => (usage = u),
    });

    // F8.1: scheduled produces `draft`, on-demand produces `proposed`.
    const status = scheduled ? "draft" : "proposed";

    const { data: cr, error } = await db
      .from("change_requests")
      .insert({
        user_id: userId,
        title: result.title,
        body: composeBody(result),
        questions: result.questions,
        status,
      })
      .select("id")
      .single();
    if (error) throw new Error(`change_requests insert: ${error.message}`);

    // Link the sources. The trigger from 0012 refuses a capture already in a
    // non-rejected request, so a race that tried to draft the same capture
    // twice fails the second insert rather than filing it twice.
    const links = captures.map((c) => ({ change_request_id: cr.id, capture_id: c.id }));
    const { error: linkError } = await db.from("change_request_captures").insert(links);
    if (linkError) {
      // The capture is already spoken for. Roll back the orphan draft rather
      // than leave a change request pointing at nothing.
      await db.from("change_requests").delete().eq("id", cr.id);
      throw new Error(`linking captures: ${linkError.message}`);
    }

    await log(db, { userId, usage, started, ok: true });
    return json({ status, change_request_id: cr.id, captures: captures.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, { userId, usage, started, ok: false, error: message });
    await reportToSentry(dsn, {
      message: `change-request drafting failed: ${message}`,
      level: "error",
      tags: { step: "change_request" },
      extra: { user_id: userId, captures: captures.length },
    });
    return json({ status: "failed", error: message }, 500);
  }
});

/** F8.8: cite the source captures verbatim. The model quotes them in the body,
 * and the composed body carries acceptance criteria, files and size as sections
 * so the stored `body` is the whole issue and questions stay a separate array. */
function composeBody(r: DraftResult): string {
  const parts = [r.body.trim()];
  if (r.acceptance_criteria.length > 0) {
    parts.push(`## Acceptance criteria\n\n${r.acceptance_criteria.map((a) => `- [ ] ${a}`).join("\n")}`);
  }
  if (r.files_likely_touched.length > 0) {
    parts.push(`## Files likely touched\n\n${r.files_likely_touched.map((f) => `- \`${f}\``).join("\n")}`);
  }
  parts.push(`_Estimated size: ${r.size}._`);
  return parts.join("\n\n");
}

/** Every capture must exist and belong to one account — never draft across two. */
async function resolveCaptures(
  db: SupabaseClient,
  ids: string[],
): Promise<{ userId: string; captures: SourceCapture[] } | null> {
  const { data } = await db
    .from("captures")
    .select("id, user_id, raw_text, created_at")
    .in("id", ids);
  if (!data || data.length !== ids.length) return null;
  const owners = new Set(data.map((c) => c.user_id));
  if (owners.size !== 1) return null;
  return {
    userId: data[0].user_id as string,
    captures: data.map((c) => ({
      id: c.id as string,
      raw_text: c.raw_text as string,
      created_at: c.created_at as string,
    })),
  };
}

/** The reeve captures not yet in any change request — the pile the weekly pass clusters. */
async function unpromotedReevePile(db: SupabaseClient, userId: string): Promise<SourceCapture[]> {
  const { data } = await db
    .from("captures")
    .select("id, raw_text, created_at, change_request_captures(capture_id)")
    .eq("user_id", userId)
    .eq("area_id", "reeve")
    .eq("status", "done")
    .order("created_at", { ascending: true })
    .limit(50);
  return (data ?? [])
    .filter((c) => {
      const links = c.change_request_captures as unknown[] | null;
      return !links || links.length === 0;
    })
    .map((c) => ({
      id: c.id as string,
      raw_text: c.raw_text as string,
      created_at: c.created_at as string,
    }));
}

async function draft(opts: {
  apiKey: string;
  system: string;
  user: string;
  onUsage: (u: { input_tokens: number; output_tokens: number }) => void;
}): Promise<DraftResult> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELS.change_request,
      max_tokens: 4096,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { format: { type: "json_schema", schema: DRAFT_JSON_SCHEMA } },
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  opts.onUsage(body.usage ?? { input_tokens: 0, output_tokens: 0 });

  // F8.3: guard stop_reason before reading content.
  if (body.stop_reason === "refusal") {
    throw new Error(`refused: ${body.stop_details?.category ?? "unspecified"}`);
  }
  if (body.stop_reason === "max_tokens") throw new Error("response truncated at max_tokens");

  const text = body.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in response");

  const parsed = DraftResult.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`draft failed validation: ${parsed.error.message}`);
  return parsed.data;
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
  // F8.7: log to agent_runs with step 'change_request'. The table needs no change.
  await db.from("agent_runs").insert({
    user_id: o.userId,
    capture_id: null,
    step: "change_request",
    model: MODELS.change_request,
    input_tokens: o.usage.input_tokens,
    output_tokens: o.usage.output_tokens,
    cost_usd: costUsd(MODELS.change_request, o.usage.input_tokens, o.usage.output_tokens),
    duration_ms: Date.now() - o.started,
    ok: o.ok,
    error: o.error ?? null,
  });
}
