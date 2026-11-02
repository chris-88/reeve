import { RATE_LIMITS } from "./config.ts";

/**
 * BR-8: a sliding window over run start times. Pure. The timestamps come from
 * agent_runs (step = 'bridge'), so a restart does not reset the count.
 */
export function rateLimited(
  startedAt: readonly Date[],
  now: Date = new Date(),
  limits: { perHour: number; perDay: number } = RATE_LIMITS,
): { limited: false } | { limited: true; reason: string } {
  const hour = now.getTime() - 3_600_000;
  const day = now.getTime() - 86_400_000;
  const lastHour = startedAt.filter((d) => d.getTime() > hour).length;
  const lastDay = startedAt.filter((d) => d.getTime() > day).length;
  if (lastDay >= limits.perDay) return { limited: true, reason: `daily limit (${limits.perDay})` };
  if (lastHour >= limits.perHour) return { limited: true, reason: `hourly limit (${limits.perHour})` };
  return { limited: false };
}
