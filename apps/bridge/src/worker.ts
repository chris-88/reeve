import type { Action } from "@reeve/shared";
import { contextFor, expandHome } from "./areas.ts";
import { IDENTITY, RATE_LIMITS } from "./config.ts";
import {
  captureContext,
  claimNext,
  insertCommitments,
  insertProposedActions,
  recentRunStarts,
  recordRun,
  returnForReview,
  type Db,
} from "./db.ts";
import { buildPrompt, describeDecomposition, parseDecomposeResult, parseTaskResult } from "./prompt.ts";
import type { Pusher } from "./push.ts";
import { rateLimited } from "./ratelimit.ts";
import type { Runner } from "./run.ts";

export type Deps = {
  db: Db;
  run: Runner;
  push: Pusher;
  log: (line: string) => void;
  health: (fields: Record<string, string | number | boolean | null>) => void;
  home: string;
  /** Overrides for tests; production uses the config defaults. */
  limits?: { perHour: number; perDay: number };
  assignee?: string;
};

export type Tick =
  | { kind: "idle" }
  | { kind: "paused"; reason: string }
  | { kind: "ran"; action: Action; ok: boolean; result: string };

/**
 * One pass of the loop: claim, run, return, record, push. Returns what
 * happened so the caller (and the integration test) can decide what to do
 * next. Never throws for a run's failure: BR-4 says a failure is a decision
 * for Chris, so it becomes a review card with the error text.
 */
export async function processOnce(deps: Deps): Promise<Tick> {
  const limit = rateLimited(await recentRunStarts(deps.db), new Date(), deps.limits ?? RATE_LIMITS);
  if (limit.limited) return { kind: "paused", reason: limit.reason };

  const action = await claimNext(deps.db, deps.assignee ?? IDENTITY);
  if (!action) return { kind: "idle" };

  const context = contextFor(action.area_id);
  const capture = await captureContext(deps.db, action.capture_id);
  const prompt = buildPrompt({ action, context, rawText: capture.rawText, commitments: capture.commitments });
  deps.log(`claimed ${action.id} "${action.title}" kind=${action.kind} area=${action.area_id ?? "none"} cwd=${context.cwd}`);

  const outcome = await deps.run({
    prompt,
    cwd: expandHome(context.cwd, deps.home),
    addDirs: context.addDirs.map((d) => expandHome(d, deps.home)),
  });

  let ok = outcome.ok;
  let error = outcome.error;
  let result: string;

  if (!outcome.ok) {
    result = `Reeve could not complete this: ${outcome.error ?? "unknown error"}`;
  } else if (action.kind === "decompose") {
    const parsed = parseDecomposeResult(outcome.output);
    if (!parsed.ok) {
      ok = false;
      error = `decompose output invalid: ${parsed.error}`;
      result = `Reeve could not complete this: ${error.slice(0, 500)}`;
    } else {
      const scope = { userId: action.user_id, captureId: action.capture_id, areaId: action.area_id };
      const created = await insertProposedActions(deps.db, scope, parsed.value.actions);
      const committed = await insertCommitments(deps.db, scope, parsed.value.commitments);
      deps.log(`decomposed ${action.id}: ${created} action(s), ${committed} new commitment(s), ${parsed.value.notes.length} note(s)`);
      result = describeDecomposition(parsed.value);
    }
  } else {
    result = parseTaskResult(outcome.output) ?? "Reeve could not complete this: empty result";
  }

  await returnForReview(deps.db, action.id, result);
  await recordRun(deps.db, {
    userId: action.user_id,
    captureId: action.capture_id,
    model: outcome.model,
    costUsd: outcome.costUsd,
    durationMs: outcome.durationMs,
    ok,
    error: ok ? null : (error ?? "failed").slice(0, 1000),
  });
  deps.health({ action: action.id, status: ok ? "ok" : "failed", secs: Math.round(outcome.durationMs / 1000), turns: outcome.numTurns, cost: outcome.costUsd?.toFixed(2) ?? null, kind: action.kind });
  deps.log(`${ok ? "returned" : "failed"} ${action.id} in ${Math.round(outcome.durationMs / 1000)}s${error ? `: ${error.slice(0, 200)}` : ""}`);

  await deps.push(action.user_id, {
    title: `Reeve: ${action.title}`,
    body: ok ? result.split("\n")[0]?.slice(0, 200) : "Could not complete it. Tap to see why.",
    url: "/#/needs-you",
    tag: `bridge-${action.id}`,
  });

  return { kind: "ran", action, ok, result };
}
