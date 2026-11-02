import type { Action } from "@reeve/shared";
import pg from "pg";
import { IDENTITY } from "./config.ts";

export type Db = pg.Pool;

/** The pooler on localhost speaks plain TCP; a hosted URL would need TLS. */
export function connect(databaseUrl: string): Db {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  return new pg.Pool({
    connectionString: databaseUrl,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3,
  });
}

/**
 * BR-1.1: claim the head of the queue atomically. Dispatched actions first, in
 * the order the Work board shows (queue_position, then dispatch time); then a
 * proposed `decompose` (BR-6.3), oldest first. `for update skip locked` means
 * two workers could never take the same row, though v1 runs one.
 */
export const CLAIM_SQL = `
with next as (
  select id from actions
   where archived_at is null
     and (status = 'dispatched' or (status = 'proposed' and kind = 'decompose'))
   order by (status = 'dispatched') desc, queue_position nulls last, coalesce(dispatched_at, created_at)
   limit 1
   for update skip locked
)
update actions a
   set status = 'working', assignee = $1, started_at = now()
  from next
 where a.id = next.id
returning a.*`;

export async function claimNext(db: Db, assignee: string = IDENTITY): Promise<Action | null> {
  const { rows } = await db.query<Action>(CLAIM_SQL, [assignee]);
  return rows[0] ?? null;
}

/** The capture's words and its commitments: the brief's fallback and decompose's input. */
export async function captureContext(
  db: Db,
  captureId: string,
): Promise<{ rawText: string; commitments: { text: string; due_text: string | null }[] }> {
  const cap = await db.query<{ raw_text: string }>("select raw_text from captures where id = $1", [captureId]);
  const com = await db.query<{ text: string; due_text: string | null }>(
    "select text, due_text from commitments where capture_id = $1 and status = 'open' order by created_at",
    [captureId],
  );
  return { rawText: cap.rows[0]?.raw_text ?? "", commitments: com.rows };
}

/** BR-3.4 / BR-4.1: hand the action back to "Needs you". */
export async function returnForReview(db: Db, id: string, result: string): Promise<void> {
  await db.query("update actions set status = 'review', result = $2 where id = $1", [id, result]);
}

export type RunRecord = {
  userId: string;
  captureId: string;
  model: string;
  costUsd: number | null;
  durationMs: number;
  ok: boolean;
  error: string | null;
};

/** BR-3.5: every run leaves a row, the same table triage and the brief write to. */
export async function recordRun(db: Db, r: RunRecord): Promise<void> {
  await db.query(
    `insert into agent_runs (user_id, capture_id, step, model, cost_usd, duration_ms, ok, error)
     values ($1, $2, 'bridge', $3, $4, $5, $6, $7)`,
    [r.userId, r.captureId, r.model, r.costUsd, r.durationMs, r.ok, r.error],
  );
}

/** BR-8: when the bridge's runs started in the last day. */
export async function recentRunStarts(db: Db): Promise<Date[]> {
  const { rows } = await db.query<{ created_at: Date }>(
    "select created_at from agent_runs where step = 'bridge' and created_at > now() - interval '1 day'",
  );
  return rows.map((r) => r.created_at);
}

/** BR-6.3: what a decomposition creates. Every action is proposed; nothing is dispatched. */
export async function insertProposedActions(
  db: Db,
  o: { userId: string; captureId: string; areaId: string | null },
  actions: { title: string; brief: string }[],
): Promise<number> {
  let n = 0;
  for (const a of actions) {
    await db.query(
      `insert into actions (user_id, capture_id, area_id, title, brief, status, kind)
       values ($1, $2, $3, $4, $5, 'proposed', 'task')`,
      [o.userId, o.captureId, o.areaId, a.title.trim(), a.brief.trim()],
    );
    n++;
  }
  return n;
}

/**
 * The same identity rule triage uses (packages/shared commitments.ts): capture
 * plus normalised text, SHA-256. Duplicated here in Node's crypto rather than
 * imported, so the worker has no runtime dependency on the shared package's
 * Deno/browser build assumptions; the unit test pins the two to each other.
 */
export function normaliseCommitmentText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?\s]+$/, "").trim();
}
export async function commitmentFingerprint(captureId: string, text: string): Promise<string> {
  const input = `${captureId}|${normaliseCommitmentText(text)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function insertCommitments(
  db: Db,
  o: { userId: string; captureId: string; areaId: string | null },
  commitments: { text: string; due_text?: string | null; due_at?: string | null }[],
): Promise<number> {
  let n = 0;
  for (const c of commitments) {
    const text = c.text.trim();
    if (!text) continue;
    const dueAt = c.due_at && /^\d{4}-\d{2}-\d{2}$/.test(c.due_at) ? `${c.due_at}T00:00:00.000Z` : null;
    const res = await db.query(
      `insert into commitments (user_id, capture_id, area_id, text, due_text, due_at, fingerprint)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (fingerprint) do nothing`,
      [o.userId, o.captureId, o.areaId, text, c.due_text?.trim() || null, dueAt, await commitmentFingerprint(o.captureId, text)],
    );
    n += res.rowCount ?? 0;
  }
  return n;
}
