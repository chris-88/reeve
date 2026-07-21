import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  Area,
  MODELS,
  TRIAGE_JSON_SCHEMA,
  TriageResult,
  UNSORTED_AREA_ID,
  buildTriageSystemPrompt,
  costUsd,
  EMPTY_ENTITIES,
} from "../../../packages/shared/src/index.ts";

const MAX_ATTEMPTS = 3;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!anthropicKey || !supabaseUrl || !secretKey) {
    return json({ error: "function is not configured" }, 500);
  }

  // Identify the caller from their own JWT before touching anything.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(supabaseUrl, secretKey);
  const {
    data: { user },
  } = await caller.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "unauthorised" }, 401);

  let captureId: string;
  try {
    ({ capture_id: captureId } = await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (typeof captureId !== "string") return json({ error: "capture_id is required" }, 400);

  // Service-role client for writes. RLS is bypassed, so every query below is
  // explicitly scoped by user_id — the check is ours to enforce, not Postgres'.
  const db = createClient(supabaseUrl, secretKey);

  const { data: capture, error: loadError } = await db
    .from("captures")
    .select("*")
    .eq("id", captureId)
    .eq("user_id", user.id)
    .single();

  if (loadError || !capture) return json({ error: "capture not found" }, 404);

  // Idempotency: a retry after a lost response must not re-run the model.
  if (capture.status === "done") return json({ status: "done", already: true });
  if (capture.attempts >= MAX_ATTEMPTS) return json({ status: "failed", exhausted: true });

  await db.from("captures").update({ status: "processing" }).eq("id", captureId);

  const { data: areaRows } = await db.from("areas").select("*").order("sort_order");
  const areas = (areaRows ?? []).map((a) => Area.parse(a));
  const system = buildTriageSystemPrompt(areas);
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

    await log(db, { user, captureId, usage, started, ok: true });
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

    await log(db, { user, captureId, usage, started, ok: false, error: message });
    return json({ status: attempts >= MAX_ATTEMPTS ? "failed" : "queued", error: message }, 500);
  }
});

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
    user: { id: string };
    captureId: string;
    usage: { input_tokens: number; output_tokens: number };
    started: number;
    ok: boolean;
    error?: string;
  },
): Promise<void> {
  await db.from("agent_runs").insert({
    user_id: o.user.id,
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
