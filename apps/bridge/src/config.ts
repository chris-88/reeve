import { execFileSync } from "node:child_process";

/** BR-1: the assistant identity shown on the Work card. */
export const IDENTITY = "claude@quinn";

/** BR-1.1: how often the Queued lane is re-read when no NOTIFY arrives. */
export const POLL_MS = 20_000;
/** BR-3.2: one run's ceiling. systemd's TimeoutStopSec is set a little above this. */
export const RUN_TIMEOUT_MS = 40 * 60_000;
export const MAX_TURNS = 80;
/** BR-3.3: the result is read on a phone; anything past this is clipped with a marker. */
export const RESULT_MAX_CHARS = 1_500;
/** BR-8: the safety envelope. Beyond either, the bridge pauses and pushes once. */
export const RATE_LIMITS = { perHour: 6, perDay: 30 } as const;

export type Secrets = {
  databaseUrl: string;
  serviceRoleKey: string;
  /** The stack's own API, reached locally; send-push lives behind it. */
  functionsUrl: string;
};

function pass(path: string): string {
  return execFileSync("pass", ["show", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\n")[0]!
    .trim();
}

/**
 * Secrets are read from pass once at start (user-level CLAUDE.md: never from
 * .env files). The BRIDGE_* variables exist so a test can point the worker at
 * the same stack without pass, and so the unit could be moved to another box.
 */
export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  return {
    databaseUrl: env.BRIDGE_DATABASE_URL || pass("env/reeve/DATABASE_URL"),
    serviceRoleKey: env.BRIDGE_SERVICE_ROLE_KEY || pass("infra/reeve/SERVICE_ROLE_KEY"),
    functionsUrl: (env.BRIDGE_FUNCTIONS_URL || "http://localhost:8001/functions/v1").replace(/\/$/, ""),
  };
}
