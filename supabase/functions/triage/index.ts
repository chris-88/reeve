import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  Area,
  MODELS,
  TRIAGE_JSON_SCHEMA,
  TriageResult,
  UNSORTED_AREA_ID,
  buildTriageSystemPrompt,
  commitmentFingerprint,
  costUsd,
  dueAtFromDate,
  EMPTY_ENTITIES,
} from "../../../packages/shared/src/index.ts";

const MAX_ATTEMPTS = 3;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// supabase-js sends apikey and x-client-info alongside authorization. Omitting
// them from the preflight response makes the browser block the request outright
// while server-side callers, which skip CORS entirely, keep working — so the
// failure is invisible unless you test from a real browser.
const ALLOWED_ORIGINS = new Set([
  "https://app.chrisquinn.ie",
  "http://localhost:5173",
]);

function cors(origin: string | null): Record<string, string> {
  return {
    // Echo the origin only when it is one of ours. The endpoint is auth-gated
    // so "*" was low-risk, but there is no reason to offer it.
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

  if (!anthropicKey || !supabaseUrl || !secretKey) {
    return json({ error: "function is not configured" }, 500);
  }

  // One service-role client. RLS is bypassed, so every query below is
  // explicitly scoped by user_id — the check is ours to enforce, not Postgres'.
  const db = createClient(supabaseUrl, secretKey);

  // Identify the caller from their own JWT before touching anything. The cron
  // sweeper presents the service key itself, which resolves to no user; it is
  // trusted because possessing that key already implies full access.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const isService = token === secretKey;
  const {
    data: { user },
  } = isService ? { data: { user: null } } : await db.auth.getUser(token);
  if (!isService && !user) return json({ error: "unauthorised" }, 401);

  let captureId: string;
  try {
    ({ capture_id: captureId } = await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (typeof captureId !== "string") return json({ error: "capture_id is required" }, 400);

  let query = db.from("captures").select("*").eq("id", captureId);
  if (user) query = query.eq("user_id", user.id);
  const { data: capture, error: loadError } = await query.single();

  if (loadError || !capture) return json({ error: "capture not found" }, 404);

  // Idempotency: a retry after a lost response must not re-run the model.
  if (capture.status === "done") return json({ status: "done", already: true });
  if (capture.attempts >= MAX_ATTEMPTS) return json({ status: "failed", exhausted: true });

  // F5.1: claim by compare-and-swap. An unconditional update let two
  // concurrent invocations — the browser and the cron sweeper, say — both read
  // 'queued' and both call the model: double spend, two agent_runs rows, and
  // last-write-wins on the result. Filtering the update on the status we
  // expect means exactly one caller can win.
  const { data: claimed } = await db
    .from("captures")
    .update({ status: "processing" })
    .eq("id", captureId)
    .eq("status", "queued")
    .select("id");

  if (!claimed?.length) {
    return json({ status: capture.status, claimed_by_other: true });
  }

  // Scoped by owner explicitly. This client holds the secret key and bypasses
  // RLS, so 0003's owner-scoped policy does nothing here — without the filter
  // the prompt would be built from every account's areas.
  const { data: areaRows } = await db
    .from("areas")
    .select("*")
    .eq("owner_id", capture.user_id)
    .order("sort_order");
  const areas = (areaRows ?? []).map((a) => Area.parse(a));
  const system = buildTriageSystemPrompt(areas, { capturedAt: capture.created_at });
  const validIds = new Set(areas.filter((a) => a.active).map((a) => a.id));

  const started = Date.now();
  let usage = { input_tokens: 0, output_tokens: 0 };

  try {
    const result = await triage({
      apiKey: anthropicKey,
      system,
      rawText: capture.raw_text,
      onUsage: (u) => (usage = u),
    });

    // Guard against a hallucinated area id. Filing it wrong is recoverable;
    // writing a dangling foreign key is not.
    const areaId = validIds.has(result.area_id) ? result.area_id : UNSORTED_AREA_ID;

    // Before the capture reaches 'done', not after. A capture that says it is
    // filed while its commitments are still only in the model's response is a
    // partial write, and nothing would ever come back for the remainder.
    await writeCommitments(db, {
      captureId,
      userId: capture.user_id,
      areaId,
      commitments: result.commitments,
    });

    await db
      .from("captures")
      .update({
        status: "done",
        area_id: areaId,
        title: result.title,
        summary: result.summary,
        entities: result.entities,
        error: null,
      })
      .eq("id", captureId);

    await log(db, { userId: capture.user_id, captureId, usage, started, ok: true });
    return json({ status: "done", area_id: areaId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = capture.attempts + 1;

    await db
      .from("captures")
      .update({
        attempts,
        error: message,
        status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      })
      .eq("id", captureId);

    await log(db, { userId: capture.user_id, captureId, usage, started, ok: false, error: message });
    return json({ status: attempts >= MAX_ATTEMPTS ? "failed" : "queued", error: message }, 500);
  }
});

/**
 * Persist the extracted commitments.
 *
 * Insert-if-absent on the fingerprint, never delete-and-reinsert. Re-triage is
 * a legitimate and increasingly common event — the cron sweeper does it, and
 * so does the retry button — and a row the user has since completed, dropped
 * or reworded must survive one. The model's later opinion about a promise does
 * not outrank the user's record of what they did about it.
 */
async function writeCommitments(
  db: SupabaseClient,
  o: {
    captureId: string;
    userId: string;
    areaId: string;
    commitments: TriageResult["commitments"];
  },
): Promise<void> {
  const rows = await Promise.all(
    o.commitments
      .map((c) => ({ ...c, text: c.text.trim() }))
      .filter((c) => c.text.length > 0)
      .map(async (c) => ({
        user_id: o.userId,
        capture_id: o.captureId,
        area_id: o.areaId,
        text: c.text,
        due_text: c.due_text?.trim() || null,
        // A phrase the model could not resolve still belongs on the list.
        due_at: dueAtFromDate(c.due_at),
        fingerprint: await commitmentFingerprint(o.captureId, c.text),
      })),
  );
  if (rows.length === 0) return;

  const { error } = await db
    .from("commitments")
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true });

  // Thrown, not swallowed: the caller's catch marks the capture for retry, and
  // the upsert above is safe to replay.
  if (error) throw new Error(`commitments: ${error.message}`);
}

/** One model call, validated. Retries once with the validation error appended. */
async function triage(opts: {
  apiKey: string;
  system: string;
  rawText: string;
  onUsage: (u: { input_tokens: number; output_tokens: number }) => void;
}): Promise<TriageResult> {
  let repair: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.triage,
        max_tokens: 2048,
        system: repair ? `${opts.system}\n\n${repair}` : opts.system,
        messages: [{ role: "user", content: opts.rawText }],
        output_config: { format: { type: "json_schema", schema: TRIAGE_JSON_SCHEMA } },
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const body = await res.json();
    opts.onUsage(body.usage ?? { input_tokens: 0, output_tokens: 0 });

    // Check stop_reason before reading content — on a refusal or a truncated
    // response, content may be empty or partial.
    if (body.stop_reason === "refusal") {
      throw new Error(`refused: ${body.stop_details?.category ?? "unspecified"}`);
    }
    if (body.stop_reason === "max_tokens") {
      throw new Error("response truncated at max_tokens");
    }

    const text = body.content?.find((b: { type: string }) => b.type === "text")?.text;
    if (!text) throw new Error("no text block in response");

    const parsed = TriageResult.safeParse(safeJson(text));
    if (parsed.success) {
      return { ...parsed.data, entities: { ...EMPTY_ENTITIES, ...parsed.data.entities } };
    }

    repair =
      `Your previous response failed validation with: ${parsed.error.message}. ` +
      `Return JSON matching the schema exactly.`;
  }

  throw new Error("model output failed schema validation twice");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function log(
  db: SupabaseClient,
  o: {
    userId: string;
    captureId: string;
    usage: { input_tokens: number; output_tokens: number };
    started: number;
    ok: boolean;
    error?: string;
  },
): Promise<void> {
  await db.from("agent_runs").insert({
    user_id: o.userId,
    capture_id: o.captureId,
    step: "triage",
    model: MODELS.triage,
    input_tokens: o.usage.input_tokens,
    output_tokens: o.usage.output_tokens,
    cost_usd: costUsd(MODELS.triage, o.usage.input_tokens, o.usage.output_tokens),
    duration_ms: Date.now() - o.started,
    ok: o.ok,
    error: o.error ?? null,
  });
}
