#!/usr/bin/env node
// P1-F1.6: lift commitments out of captures.entities into commitment rows.
//
// Captures triaged before migration 0004 carry their commitments as a bare
// string[] inside jsonb. Nothing reads that key any more, so without this they
// are invisible to the Due view — present, but not on the list.
//
// Dry run by default. Pass --apply to write.
//
//   node scripts/backfill-commitments.mjs           # report only
//   node scripts/backfill-commitments.mjs --apply
//
// Idempotent: rows are inserted on conflict do nothing against the same
// fingerprint the Edge Function computes, so running it twice — or running it
// after re-triage has already created a row — changes nothing.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { commitmentFingerprint } from "../packages/shared/src/commitments.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const apply = process.argv.includes("--apply");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  const { rows: captures } = await client.query(`
    select id,
           user_id,
           coalesce(corrected_area_id, area_id) as area_id,
           entities->'commitments' as commitments
      from captures
     where jsonb_typeof(entities->'commitments') = 'array'
       and jsonb_array_length(entities->'commitments') > 0
     order by created_at
  `);

  let considered = 0;
  let written = 0;
  let alreadyPresent = 0;

  for (const capture of captures) {
    for (const raw of capture.commitments) {
      if (typeof raw !== "string") continue;
      const text = raw.trim();
      if (!text) continue;
      considered++;

      const fingerprint = await commitmentFingerprint(capture.id, text);

      if (!apply) {
        const { rows } = await client.query(
          "select 1 from commitments where fingerprint = $1",
          [fingerprint],
        );
        if (rows.length) alreadyPresent++;
        else written++;
        continue;
      }

      // due_text and due_at stay null. The old extraction put dates in a
      // separate entities.dates array with no link back to the commitment they
      // belonged to, and guessing that pairing now would invent a due date
      // Chris never gave. P1-F1.5: an undated commitment is valid.
      const { rowCount } = await client.query(
        `insert into commitments (user_id, capture_id, area_id, text, fingerprint)
         values ($1, $2, $3, $4, $5)
         on conflict (fingerprint) do nothing`,
        [capture.user_id, capture.id, capture.area_id, text, fingerprint],
      );
      if (rowCount === 1) written++;
      else alreadyPresent++;
    }
  }

  console.log(
    `${captures.length} capture(s) carry commitments in jsonb; ${considered} entr(ies) considered.`,
  );
  console.log(`  ${alreadyPresent} already present`);
  console.log(apply ? `  ${written} written` : `  ${written} would be written`);
  if (!apply && written > 0) console.log("\nRe-run with --apply to write them.");
} finally {
  await client.end().catch(() => {});
}
