import { createClient } from "@supabase/supabase-js";
import {
  referencedIssues,
  reportToSentry,
  verifyGithubSignature,
} from "../../../packages/shared/src/index.ts";

/**
 * P1-F10: closing the loop.
 *
 * A dictated thought became an issue in Stage 5; this is how Reeve learns what
 * became of it. GitHub posts pull-request events here, and a change request
 * moves through in_progress → shipped as its PR opens and merges. Without this
 * the loop is open — Reeve can send a thought outward and never hear back,
 * exactly the failure corrected_area_id was designed to avoid elsewhere.
 *
 * F10.1: this is the one unauthenticated public endpoint the project exposes,
 * and therefore the one new attack surface. Every request is HMAC-verified
 * against the webhook secret before anything is read from it.
 */

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  const dsn = Deno.env.get("SENTRY_DSN");

  if (!supabaseUrl || !secretKey || !webhookSecret) {
    return json({ error: "function is not configured" }, 500);
  }

  // The raw body, read once. Verification is over the exact bytes GitHub
  // signed; re-serialising parsed JSON would change them and break the MAC.
  const raw = await req.text();
  const signature = req.headers.get("X-Hub-Signature-256");
  if (!(await verifyGithubSignature(webhookSecret, raw, signature))) {
    // The acceptance criterion: an unsigned or wrongly-signed request is
    // rejected. No detail in the response — this endpoint is public.
    return json({ error: "invalid signature" }, 401);
  }

  const event = req.headers.get("X-GitHub-Event");
  if (event === "ping") return json({ ok: true, pong: true });
  if (event !== "pull_request") return json({ ok: true, ignored: event });

  let payload: PullRequestEvent;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const pr = payload.pull_request;
  if (!pr) return json({ ok: true, no_pr: true });

  const db = createClient(supabaseUrl, secretKey);

  // Map the PR to a change request through the issue it closes. The filed
  // issue's number is the link; the coding agent's PR references it with a
  // closing keyword, which is the GitHub convention the handoff relies on.
  const issueNumbers = referencedIssues(`${pr.title ?? ""}\n${pr.body ?? ""}`);
  if (issueNumbers.length === 0) return json({ ok: true, no_linked_issue: true });

  const { data: changeRequests } = await db
    .from("change_requests")
    .select("*")
    .in("issue_number", issueNumbers);
  if (!changeRequests?.length) return json({ ok: true, no_matching_change_request: true });

  const merged = payload.action === "closed" && pr.merged === true;
  const closedUnmerged = payload.action === "closed" && !pr.merged;

  const updated: string[] = [];
  for (const cr of changeRequests as ChangeRequest[]) {
    try {
      if (payload.action === "opened" || payload.action === "reopened") {
        // F10: a PR is open against this change request's issue.
        await db
          .from("change_requests")
          .update({ status: "in_progress", pr_number: pr.number, pr_url: pr.html_url })
          .eq("id", cr.id)
          .in("status", ["filed", "in_progress"]);
      } else if (merged) {
        // F10.2: the most satisfying event this system can produce. A thought
        // dictated in a car has become a deployed change.
        const { data: shipped } = await db
          .from("change_requests")
          .update({
            status: "shipped",
            pr_number: pr.number,
            pr_url: pr.html_url,
            shipped_at: new Date().toISOString(),
          })
          .eq("id", cr.id)
          .neq("status", "shipped")
          .select("id");
        // F10.3: tell him, and only on the transition — a merge webhook can
        // arrive more than once, and a second push for the same ship is noise.
        if (shipped?.length) {
          await notifyShipped(supabaseUrl, secretKey, cr);
        }
      } else if (closedUnmerged) {
        await db
          .from("change_requests")
          .update({ status: "abandoned" })
          .eq("id", cr.id)
          .in("status", ["filed", "in_progress"]);
      }
      updated.push(cr.id);
    } catch (err) {
      await reportToSentry(dsn, {
        message: `github-webhook: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
        tags: { step: "github_webhook", action: payload.action ?? "unknown" },
        extra: { change_request_id: cr.id, pr_number: pr.number },
      });
    }
  }

  return json({ ok: true, action: payload.action, updated });
});

type PullRequestEvent = {
  action?: string;
  pull_request?: {
    number: number;
    html_url: string;
    title?: string;
    body?: string;
    merged?: boolean;
  };
};

type ChangeRequest = {
  id: string;
  user_id: string;
  title: string;
  issue_number: number | null;
};

async function notifyShipped(
  supabaseUrl: string,
  secretKey: string,
  cr: ChangeRequest,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${secretKey}` },
      body: JSON.stringify({
        user_id: cr.user_id,
        // The title is what Chris's own change request was called — his words,
        // not a capture's. Per WP-F3.4, naming the shipped thing is the point.
        notification: { title: "Shipped", body: cr.title, url: "/", tag: `cr-${cr.id}` },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error("[reeve] shipped notification failed", err);
  }
}
