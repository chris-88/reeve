/**
 * Step -> model mapping.
 *
 * Tier by task difficulty, not by role. This file exists in Phase 0 so that a
 * step which starts needing judgment can be moved up a tier by changing one
 * line rather than touching call sites.
 *
 * Per 1M tokens (input / output):
 *   claude-haiku-4-5   $1  / $5   classification, triage, routing
 *   claude-sonnet-5    $3  / $15  drafting — email, documents, replies
 *   claude-opus-4-8    $5  / $25  coordination, anything genuinely multi-step
 *   claude-fable-5     $10 / $50  reserved: hard, long-horizon work only
 */
export const MODELS = {
  triage: "claude-haiku-4-5",
  // P1-F6.4. Drafting is the documented use for the Sonnet tier, and a brief
  // is drafting: it reads a day's worth of context and writes a paragraph a
  // person will act on. Named here rather than hardcoded at the call site so
  // that moving it a tier is one line.
  brief: "claude-sonnet-5",
  // P1-F8.2. Turning dictated fragments into an issue a developer can act on
  // is drafting too, and the harder end of it.
  change_request: "claude-sonnet-5",
} as const satisfies Record<string, string>;

export type Step = keyof typeof MODELS;

/** Published price per million tokens, used to cost each call in agent_runs. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-fable-5": { input: 10, output: 50 },
};

/**
 * Cost of a single call in USD. Returns null for an unpriced model rather than
 * guessing — a null in agent_runs.cost_usd is a visible prompt to add pricing,
 * whereas a wrong number silently corrupts the spend history.
 */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
