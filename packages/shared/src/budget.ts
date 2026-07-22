import { reportToSentry } from "./sentry.ts";

/**
 * P1-F5.2: the cost ceiling.
 *
 * `agent_runs.cost_usd` has been recorded correctly since Phase 0 and read by
 * nothing. At Haiku prices and one call per capture that was fine. On a
 * schedule, at Sonnet or above, a loop that retries pathologically is a
 * genuinely expensive night — and the first thing to run unattended must not
 * also be the first thing with no limit.
 *
 * **Refusing is the correct behaviour.** This system's job is capture and
 * drafting, and neither is worth an unbounded bill. A brief that did not
 * generate is a missing paragraph; a runaway loop is a bill.
 */

/** Rolling windows, not calendar periods — a calendar month resets the budget at
 * midnight on the 1st, which is exactly when a runaway loop gets a second night. */
export const DEFAULT_DAILY_CEILING_USD = 1;
export const DEFAULT_MONTHLY_CEILING_USD = 10;

type Rpc = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type BudgetVerdict =
  | { ok: true; daily: number; monthly: number }
  | { ok: false; reason: string; daily: number; monthly: number };

/** Parsed from configuration by the caller; a bad value falls back rather than throwing. */
export function ceilingOr(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type Ceilings = { dailyUsd?: number; monthlyUsd?: number };

/**
 * May this function spend?
 *
 * Fails **closed** on an error reading the spend. If the ceiling cannot be
 * evaluated then it is not a ceiling, and the whole point is that nothing
 * unattended runs unbounded — a missing brief is cheaper than the alternative.
 */
export async function checkBudget(
  db: Rpc,
  userId: string,
  ceilings: Ceilings = {},
): Promise<BudgetVerdict> {
  const read = async (window: string): Promise<number> => {
    const { data, error } = await db.rpc("agent_spend_since", {
      p_user_id: userId,
      p_window: window,
    });
    if (error) throw new Error(`agent_spend_since(${window}): ${error.message}`);
    return Number(data ?? 0);
  };

  let daily: number;
  let monthly: number;
  try {
    [daily, monthly] = await Promise.all([read("24 hours"), read("30 days")]);
  } catch (err) {
    return {
      ok: false,
      reason: `could not read spend: ${err instanceof Error ? err.message : String(err)}`,
      daily: NaN,
      monthly: NaN,
    };
  }

  // Passed in rather than read from the environment here: a module shared by
  // the browser, Deno and Node has no business reaching for one runtime's
  // globals, and the caller already knows where its configuration lives.
  const dailyCeiling = ceilings.dailyUsd ?? DEFAULT_DAILY_CEILING_USD;
  const monthlyCeiling = ceilings.monthlyUsd ?? DEFAULT_MONTHLY_CEILING_USD;

  if (daily >= dailyCeiling) {
    return { ok: false, reason: `daily spend $${daily.toFixed(4)} >= $${dailyCeiling}`, daily, monthly };
  }
  if (monthly >= monthlyCeiling) {
    return {
      ok: false,
      reason: `30-day spend $${monthly.toFixed(4)} >= $${monthlyCeiling}`,
      daily,
      monthly,
    };
  }
  return { ok: true, daily, monthly };
}

type Insertable = {
  from(table: string): { insert(rows: Record<string, unknown>): PromiseLike<unknown> };
};

/**
 * P1-F5.2's other two halves: log the refusal, and alert.
 *
 * The `agent_runs` row matters as much as the alert. Without it the spend
 * history shows a quiet day rather than a day the system spent nothing
 * *because it was stopped*, and those are opposite facts.
 */
export async function recordRefusal(
  db: Insertable,
  o: { userId: string; step: string; model: string; verdict: BudgetVerdict; dsn?: string },
): Promise<void> {
  const reason = o.verdict.ok ? "" : o.verdict.reason;

  await db.from("agent_runs").insert({
    user_id: o.userId,
    step: o.step,
    model: o.model,
    ok: false,
    error: `refused by cost ceiling: ${reason}`,
    // Zero, not null. Null means "unpriced model" (P1-F5.3) and would make the
    // refusal look like a pricing gap rather than a deliberate stop.
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: 0,
  });

  await reportToSentry(o.dsn, {
    message: `cost ceiling refused ${o.step}: ${reason}`,
    level: "error",
    tags: { step: o.step, refused: "budget" },
    extra: {
      user_id: o.userId,
      daily_usd: Number.isFinite(o.verdict.daily) ? o.verdict.daily : null,
      monthly_usd: Number.isFinite(o.verdict.monthly) ? o.verdict.monthly : null,
    },
  });
}
