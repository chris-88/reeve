import { execFile } from "node:child_process";
import { MAX_TURNS, RUN_TIMEOUT_MS } from "./config.ts";

export type RunRequest = {
  prompt: string;
  cwd: string;
  addDirs: string[];
  maxTurns?: number;
  timeoutMs?: number;
};

export type RunOutcome = {
  ok: boolean;
  /** The CLI's final message (`result` in its JSON), or "" on failure. */
  output: string;
  /** What to tell Chris when ok is false. */
  error: string | null;
  model: string;
  costUsd: number | null;
  durationMs: number;
  numTurns: number | null;
  stderr: string;
};

export type Runner = (req: RunRequest) => Promise<RunOutcome>;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * BR-3.2: one headless Claude Code run, the way `claude-routine` does it. No
 * --dangerously-skip-permissions, ever: the allowlist in ~/.claude/settings.json
 * is the envelope and a denial is a denial. `--output-format json` gives the
 * final message plus model and cost without parsing a transcript.
 */
export const runClaude: Runner = (req) =>
  new Promise((resolve) => {
    const started = Date.now();
    const args = [
      "-p",
      req.prompt,
      "--output-format",
      "json",
      "--max-turns",
      String(req.maxTurns ?? MAX_TURNS),
      ...req.addDirs.flatMap((d) => ["--add-dir", d]),
    ];
    const finish = (o: Omit<RunOutcome, "durationMs">) => resolve({ ...o, durationMs: Date.now() - started });

    execFile(
      "claude",
      args,
      {
        cwd: req.cwd,
        timeout: req.timeoutMs ?? RUN_TIMEOUT_MS,
        killSignal: "SIGTERM",
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, CLAUDE_BRIDGE: "1" },
      },
      (err, stdout, stderr) => {
        const tail = (s: string) => s.trim().slice(-500);
        const timedOut = !!err && (err as { killed?: boolean }).killed === true;
        const parsed = parseJson(stdout);
        const model = parsed?.modelUsage ? Object.keys(parsed.modelUsage as object).join("+") || "claude-code" : "claude-code";
        const costUsd = typeof parsed?.total_cost_usd === "number" ? parsed.total_cost_usd : null;
        const numTurns = typeof parsed?.num_turns === "number" ? parsed.num_turns : null;
        const result = typeof parsed?.result === "string" ? parsed.result : "";

        if (timedOut) {
          return finish({ ok: false, output: "", error: `timed out after ${Math.round((req.timeoutMs ?? RUN_TIMEOUT_MS) / 60000)} minutes`, model, costUsd, numTurns, stderr });
        }
        if (err && !parsed) {
          return finish({ ok: false, output: "", error: `claude exited ${String((err as { code?: unknown }).code ?? "")}: ${tail(stderr) || tail(stdout) || err.message}`, model, costUsd, numTurns, stderr });
        }
        if (parsed?.is_error || (parsed?.subtype && parsed.subtype !== "success")) {
          return finish({ ok: false, output: result, error: `${String(parsed?.subtype ?? "error")}${result ? `: ${tail(result)}` : ""}`, model, costUsd, numTurns, stderr });
        }
        if (!result.trim()) {
          return finish({ ok: false, output: "", error: `empty result${tail(stderr) ? `: ${tail(stderr)}` : ""}`, model, costUsd, numTurns, stderr });
        }
        finish({ ok: true, output: result, error: null, model, costUsd, numTurns, stderr });
      },
    );
  });
