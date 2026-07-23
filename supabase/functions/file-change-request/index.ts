import { createClient } from "@supabase/supabase-js";
import { reportToSentry } from "../../../packages/shared/src/index.ts";

/**
 * P1-F9: filing, and the handoff.
 *
 * The only place the GitHub credential exists (F9.1). It is a fine-grained
 * token scoped to this one repository with `issues: write` and nothing else
 * (F9.2) — Reeve files issues, it does not push code, and the coding agent's
 * credentials are separate and never meet this one.
 *
 * Invoked by the filing sweeper when an approval syncs (F7.5). Idempotent on
 * `filing_key` (F9.3): an approval that syncs twice, or a sweeper that runs
 * while a previous filing is still in flight, must not create two issues.
 */

/** F9.8: a drafting pass that misbehaves should hit a wall, not fill the repo. */
const MAX_OPEN_FILED = 10;

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("GITHUB_ISSUES_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO") ?? "chris-88/reeve";
  const dsn = Deno.env.get("SENTRY_DSN");

  if (!supabaseUrl || !secretKey || !githubToken) {
    return json({ error: "function is not configured" }, 500);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token !== secretKey) return json({ error: "unauthorised" }, 401);

  let changeRequestId: string;
  try {
    ({ change_request_id: changeRequestId } = await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (typeof changeRequestId !== "string") {
    return json({ error: "change_request_id is required" }, 400);
  }

  const db = createClient(supabaseUrl, secretKey);

  const { data: cr, error: loadError } = await db
    .from("change_requests")
    .select("*")
    .eq("id", changeRequestId)
    .single();
  if (loadError || !cr) return json({ error: "change request not found" }, 404);

  // Already filed on an earlier run whose response we never saw. Success.
  if (cr.issue_number) {
    return json({ status: "filed", already: true, issue_number: cr.issue_number });
  }
  // Only an approved, proposed request is fileable. A draft has not been read;
  // a rejected one must never be filed.
  if (cr.status !== "proposed" || !cr.decided_at) {
    return json({ status: cr.status, not_approved: true });
  }

  // Claim by compare-and-swap, exactly as triage claims a capture. Setting
  // filed_at while it is null lets precisely one invocation proceed; a second,
  // concurrent sweeper tick finds zero rows and backs off — so the model of
  // "the sweeper runs every minute" cannot double-file within one process.
  const { data: claimed } = await db
    .from("change_requests")
    .update({ filed_at: new Date().toISOString() })
    .eq("id", changeRequestId)
    .eq("status", "proposed")
    .is("issue_number", null)
    .is("filed_at", null)
    .select("id");
  if (!claimed?.length) return json({ status: "claimed_by_other" });

  const release = async () => {
    // Let the sweeper try again on the next tick.
    await db.from("change_requests").update({ filed_at: null }).eq("id", changeRequestId);
  };

  try {
    // F9.8: refuse past the cap. Refusing is correct behaviour — a repository
    // full of auto-filed issues is the failure, not a missing one.
    const { count: openFiled } = await db
      .from("change_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", cr.user_id)
      .in("status", ["filed", "in_progress"]);
    if ((openFiled ?? 0) >= MAX_OPEN_FILED) {
      await release();
      await reportToSentry(dsn, {
        message: `filing refused: ${openFiled} open filed change requests at the cap of ${MAX_OPEN_FILED}`,
        level: "error",
        tags: { step: "file_change_request", refused: "cap" },
        extra: { user_id: cr.user_id, open_filed: openFiled ?? 0 },
      });
      return json({ status: "refused", reason: "open-issue cap reached" }, 200);
    }

    // F9.4: the issue names the change request and its source captures, so the
    // trail from thought to diff is followable in both directions.
    const { data: links } = await db
      .from("change_request_captures")
      .select("capture_id")
      .eq("change_request_id", changeRequestId);
    const captureIds = (links ?? []).map((l) => l.capture_id as string);

    const marker = `reeve-filing-key: ${cr.filing_key}`;

    // F9.3: recover a mid-flight crash. If a previous attempt claimed, created
    // the issue, then died before recording it, the key is already on an
    // issue — adopt it rather than filing a second.
    const existing = await findByMarker(githubToken, repo, marker);
    const issue =
      existing ??
      (await createIssue(githubToken, repo, {
        title: cr.title,
        body: issueBody(cr, captureIds, marker),
      }));

    const { error: recordError } = await db
      .from("change_requests")
      .update({
        status: "filed",
        issue_number: issue.number,
        issue_url: issue.html_url,
      })
      .eq("id", changeRequestId);
    if (recordError) throw new Error(`recording issue: ${recordError.message}`);

    return json({ status: "filed", issue_number: issue.number, issue_url: issue.html_url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await release();
    await reportToSentry(dsn, {
      message: `filing failed: ${message}`,
      level: "error",
      tags: { step: "file_change_request" },
      extra: { change_request_id: changeRequestId },
    });
    return json({ status: "failed", error: message }, 500);
  }
});

type Issue = { number: number; html_url: string };

/** F9.5: the handoff is opt-in per request. Where opted in, a `@claude` mention
 * is the whole handoff — the Claude Code GitHub Action picks it up (F9.6: do not
 * build the coding agent; it exists and runs with its own, separate credentials). */
function issueBody(
  cr: { id: string; body: string | null; questions: string[]; auto_handoff: boolean; filing_key: string },
  captureIds: string[],
  marker: string,
): string {
  const parts = [cr.body?.trim() || "_No description drafted._"];

  if (cr.questions.length > 0) {
    parts.push(`## Open questions\n\n${cr.questions.map((q) => `- ${q}`).join("\n")}`);
  }

  const captures = captureIds.length
    ? captureIds.map((id) => `\`${id}\``).join(", ")
    : "_none recorded_";
  parts.push(
    `---\n\nFiled by Reeve from change request \`${cr.id}\`.\nSource captures: ${captures}.`,
  );

  if (cr.auto_handoff) {
    parts.push("@claude please implement this change.");
  }

  // A hidden marker so a replay can find this issue by its filing key. HTML
  // comments do not render, so it is invisible in the issue but searchable.
  parts.push(`<!-- ${marker} -->`);
  return parts.join("\n\n");
}

async function findByMarker(token: string, repo: string, marker: string): Promise<Issue | null> {
  const q = encodeURIComponent(`repo:${repo} in:body "${marker}"`);
  const res = await gh(token, `https://api.github.com/search/issues?q=${q}`);
  if (!res.ok) return null; // best effort — the CAS claim is the primary guard
  const body = await res.json();
  const hit = body.items?.[0];
  return hit ? { number: hit.number, html_url: hit.html_url } : null;
}

async function createIssue(
  token: string,
  repo: string,
  issue: { title: string; body: string },
): Promise<Issue> {
  const res = await gh(token, `https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify(issue),
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  return { number: body.number, html_url: body.html_url };
}

function gh(token: string, url: string, init?: { method?: string; body?: string }) {
  return fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "content-type": "application/json",
    },
    body: init?.body,
    signal: AbortSignal.timeout(20_000),
  });
}
