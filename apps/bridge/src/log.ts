import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE = path.join(homedir(), ".local", "state", "bridge");
const HEALTH = path.join(homedir(), "backups", "health", "bridge.log");

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/** BR-7: a dated log under ~/.local/state/bridge/, and the journal. */
export function log(line: string): void {
  const text = `${stamp()} ${line}`;
  console.log(text);
  try {
    mkdirSync(STATE, { recursive: true });
    appendFileSync(path.join(STATE, `${new Date().toISOString().slice(0, 10)}.log`), `${text}\n`);
  } catch {
    /* the journal still has it */
  }
}

/** One line per run in ~/backups/health/bridge.log, the file box-status reads. */
export function health(fields: Record<string, string | number | boolean | null>): void {
  const line = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v ?? "").replace(/\s+/g, "_")}`)
    .join(" ");
  try {
    mkdirSync(path.dirname(HEALTH), { recursive: true });
    appendFileSync(HEALTH, `${new Date().toISOString().slice(0, 16)} ${line}\n`);
  } catch {
    /* non-fatal */
  }
}
