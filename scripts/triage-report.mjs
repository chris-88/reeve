#!/usr/bin/env node
// P1-F3.3: the corrections report. A script, printing to the terminal.
//
// Deliberately not a screen. docs/arc-spec-phase-1.md §9 lists a corrections
// screen as deferred, and names the observation that earns it: finding
// yourself running this weekly. Until then a screen is a thing to maintain in
// exchange for a thing you look at twice a year.
//
//   pnpm triage:report
//   pnpm triage:report --owner you@example.com
//
// It answers one question — which classifier_hint should I edit first — and it
// prints both hints in the confused pair so the answer is on screen rather
// than one lookup away.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const ownerFlag = process.argv.indexOf("--owner");
const ownerEmail = ownerFlag !== -1 ? process.argv[ownerFlag + 1] : undefined;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

/** Wrap a hint so a two-sentence description does not run off the terminal. */
function wrap(text, indent) {
  const width = 78 - indent.length;
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out.map((l) => indent + l).join("\n");
}

try {
  await client.connect();

  // This runs over a direct connection, which bypasses RLS, so the account has
  // to be chosen rather than inferred from a session.
  const owner = ownerEmail
    ? (await client.query("select id, email from auth.users where email = $1", [ownerEmail])).rows[0]
    : (
        await client.query(`
          select u.id, u.email
            from auth.users u
            join captures c on c.user_id = u.id
           group by u.id, u.email
           order by count(*) desc, u.id
           limit 1
        `)
      ).rows[0];

  if (!owner) {
    console.error(ownerEmail ? `No account found for ${ownerEmail}.` : "No captures yet.");
    process.exit(1);
  }

  console.log(`\nTriage quality for ${owner.email}\n${"=".repeat(60)}`);

  const { rows: rates } = await client.query(
    "select * from triage_rates where user_id = $1 order by week desc limit 8",
    [owner.id],
  );

  console.log("\nBy week\n");
  if (rates.length === 0) {
    console.log("  Nothing filed yet.");
  } else {
    console.log("  week          filed   corrected      unsorted");
    for (const r of rates) {
      const week = new Date(r.week).toISOString().slice(0, 10);
      const corrected = `${r.corrections} (${r.correction_rate ?? 0}%)`;
      const unsorted = `${r.unsorted} (${r.unsorted_rate ?? 0}%)`;
      console.log(
        `  ${week}   ${String(r.captures).padStart(5)}   ${corrected.padStart(9)}   ${unsorted.padStart(11)}`,
      );
    }
    console.log(
      "\n  A rising unsorted rate means the taxonomy has a gap — an area is missing.\n" +
        "  A rising correction rate on one pair means a specific hint is wrong.\n" +
        "  They are different problems with different fixes.",
    );
  }

  const { rows: pairs } = await client.query(
    "select * from triage_corrections where user_id = $1 order by corrections desc, last_corrected_at desc",
    [owner.id],
  );

  console.log(`\n\nConfused pairs\n`);
  if (pairs.length === 0) {
    console.log("  Nothing has been re-filed. Either the hints are good or the app is new.");
  } else {
    for (const p of pairs) {
      const times = p.corrections === 1 ? "once" : `${p.corrections} times`;
      console.log(
        `\n  ${p.predicted_label} → ${p.corrected_label}   (${times}, last ${new Date(p.last_corrected_at).toISOString().slice(0, 10)})`,
      );
      console.log(`\n    ${p.predicted_area_id} hint — this is the one that is probably wrong:`);
      console.log(wrap(p.predicted_hint, "      "));
      console.log(`\n    ${p.corrected_area_id} hint — where they actually belong:`);
      console.log(wrap(p.corrected_hint, "      "));
      console.log(`\n    e.g. ${p.sample_capture_ids.slice(0, 3).join(", ")}`);
    }
    console.log(
      `\n\n  Edit the hint in supabase/seed/areas.json, then \`pnpm db:seed --owner ${owner.email}\`.`,
    );
  }

  // ---------------------------------------------------------------------------
  // P1-F10.5: the reeve share, alongside the taxonomy report as the spec asks.
  // A rising share is a warning — the tool eating its own purpose — not a
  // number to admire.
  // ---------------------------------------------------------------------------
  const { rows: share } = await client.query(
    "select * from reeve_capture_share where user_id = $1 order by week desc limit 6",
    [owner.id],
  );

  console.log(`\n\nReeve's share of captures, by week\n`);
  if (share.length === 0) {
    console.log("  Nothing filed yet.");
  } else {
    console.log("  week          captures   reeve");
    for (const r of share) {
      const week = new Date(r.week).toISOString().slice(0, 10);
      console.log(
        `  ${week}   ${String(r.captures).padStart(8)}   ${`${r.reeve} (${r.reeve_pct ?? 0}%)`.padStart(9)}`,
      );
    }
    console.log(
      "\n  A rising share means Reeve is being used mostly to build Reeve.\n" +
        "  Treat it as a warning to point the tool back at the work it serves.",
    );
  }

  // ---------------------------------------------------------------------------
  // P1-F10.4: capture-to-shipped lead time — the one honest measure of whether
  // the self-change loop actually works.
  // ---------------------------------------------------------------------------
  const { rows: shipped } = await client.query(
    "select * from change_request_leadtime where user_id = $1 order by shipped_at desc limit 10",
    [owner.id],
  );

  console.log(`\n\nThought to shipped\n`);
  if (shipped.length === 0) {
    console.log("  Nothing has shipped through the loop yet.");
  } else {
    const avg = shipped.reduce((s, r) => s + Number(r.lead_days), 0) / shipped.length;
    for (const r of shipped) {
      console.log(
        `  ${Number(r.lead_days).toFixed(1).padStart(5)}d   ${r.title.slice(0, 60)}`,
      );
    }
    console.log(`\n  Average ${avg.toFixed(1)} days from first capture to merged.`);
  }

  console.log("");
} finally {
  await client.end().catch(() => {});
}
