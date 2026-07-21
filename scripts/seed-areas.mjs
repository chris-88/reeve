#!/usr/bin/env node
// Upserts life areas from supabase/seed/areas.json.
//
// Areas are seeded here rather than in the migration because each area's
// classifier_hint describes a real part of the owner's life. That is personal
// content and the repo is public, so the real file is gitignored — see
// supabase/seed/areas.example.json for the shape.
//
// Upsert rather than insert: editing a hint and re-running should update the
// row, which is the normal way to tune triage quality.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const SEED = path.join(ROOT, "supabase", "seed", "areas.json");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

let areas;
try {
  areas = JSON.parse(await readFile(SEED, "utf8"));
} catch {
  console.error(
    `Could not read ${path.relative(ROOT, SEED)}.\n` +
      `Copy supabase/seed/areas.example.json to areas.json and edit it.`,
  );
  process.exit(1);
}

if (!Array.isArray(areas) || areas.length === 0) {
  console.error("areas.json must be a non-empty array.");
  process.exit(1);
}
if (!areas.some((a) => a.id === "unsorted")) {
  // Triage routes low-confidence captures here rather than failing them.
  // Without it, every uncertain capture would hit a foreign key violation.
  console.error("areas.json must include an area with id 'unsorted'.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  for (const a of areas) {
    await client.query(
      `insert into areas (id, label, classifier_hint, colour, sort_order, active)
       values ($1, $2, $3, $4, $5, coalesce($6, true))
       on conflict (id) do update set
         label = excluded.label,
         classifier_hint = excluded.classifier_hint,
         colour = excluded.colour,
         sort_order = excluded.sort_order,
         active = excluded.active`,
      [a.id, a.label, a.classifier_hint, a.colour, a.sort_order ?? 0, a.active ?? true],
    );
    console.log(`✓ ${a.id}`);
  }
  console.log(`Seeded ${areas.length} area(s).`);
} finally {
  await client.end().catch(() => {});
}
