import { homedir } from "node:os";
import pg from "pg";
import { POLL_MS, RATE_LIMITS, loadSecrets } from "./config.ts";
import { connect } from "./db.ts";
import { health, log } from "./log.ts";
import { makePusher, noticePath } from "./push.ts";
import { runClaude } from "./run.ts";
import { processOnce } from "./worker.ts";

/**
 * The loop. Wakes on NOTIFY actions_dispatched (0017) or every POLL_MS, drains
 * the queue one action at a time, and on SIGTERM finishes the run in flight
 * before exiting (systemd: KillMode=mixed, TimeoutStopSec above the run
 * timeout). `systemctl --user stop reeve-bridge` is the pause switch.
 */
const secrets = loadSecrets();
const db = connect(secrets.databaseUrl);
const deps = {
  db,
  run: runClaude,
  push: makePusher(secrets.functionsUrl, secrets.serviceRoleKey, log),
  log,
  health,
  home: homedir(),
};

let stopping = false;
let wake: (() => void) | null = null;
let pausedFor: string | null = null;
let pushedPause = false;

function nudge() {
  wake?.();
  wake = null;
}

process.on("SIGTERM", () => {
  log("SIGTERM: finishing the current run, then stopping");
  stopping = true;
  nudge();
});
process.on("SIGINT", () => {
  stopping = true;
  nudge();
});

async function listen(): Promise<void> {
  // A dedicated session for LISTEN; the pool's connections come and go.
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(secrets.databaseUrl);
  const client = new pg.Client({ connectionString: secrets.databaseUrl, ssl: local ? false : { rejectUnauthorized: false } });
  client.on("notification", (n) => {
    log(`notify ${n.channel} ${n.payload ?? ""}`);
    nudge();
  });
  client.on("error", (err) => {
    log(`listen connection lost: ${err.message}; polling only until it is back`);
    setTimeout(() => void listen(), 10_000);
  });
  try {
    await client.connect();
    await client.query("listen actions_dispatched");
    log("listening on actions_dispatched");
  } catch (err) {
    log(`listen failed: ${err instanceof Error ? err.message : String(err)}; polling only`);
    setTimeout(() => void listen(), 30_000);
  }
}

async function loop(): Promise<void> {
  log(`bridge up: poll ${POLL_MS / 1000}s, limits ${RATE_LIMITS.perHour}/h ${RATE_LIMITS.perDay}/d, functions ${secrets.functionsUrl}`);
  void listen();
  while (!stopping) {
    let tick;
    try {
      tick = await processOnce(deps);
    } catch (err) {
      log(`tick failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      tick = { kind: "idle" as const };
    }
    if (tick.kind === "paused") {
      if (pausedFor !== tick.reason) {
        pausedFor = tick.reason;
        log(`paused: ${tick.reason}`);
        if (!pushedPause) {
          pushedPause = true;
          const { rows } = await db.query<{ user_id: string }>(
            "select user_id from actions where status = 'dispatched' and archived_at is null limit 1",
          );
          // PN-7.1 / E-4: a notice in the thread, and a push that opens it.
          if (rows[0]) {
            const body = `I've hit the ${tick.reason}; I'll carry on when it resets. What you handed me stays queued.`;
            const { rows: n } = await db.query<{ id: string }>(
              "insert into notices (user_id, kind, body, meta) values ($1, 'paused', $2, $3) returning id",
              [rows[0].user_id, body, JSON.stringify({ reason: tick.reason })],
            );
            await deps.push(rows[0].user_id, { title: "Reeve is paused", body: `Reached the ${tick.reason}.`, tag: "bridge", url: n[0] ? noticePath(n[0].id) : "/#/" });
          }
        }
      }
    } else {
      pausedFor = null;
      pushedPause = false;
    }
    if (stopping) break;
    // Drain: after a run, look again at once. Otherwise wait for a NOTIFY or the poll.
    if (tick.kind !== "ran") {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, POLL_MS);
      });
    }
  }
  await db.end().catch(() => {});
  log("bridge stopped");
  process.exit(0);
}

void loop();
