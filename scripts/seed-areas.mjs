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
//
// P1-F0.4: an owner is required. Areas are owner-scoped since 0003, and a row
// seeded without one is invisible to every account — a silent failure that
// looks like a broken app rather than a missing flag.
//
//   pnpm db:seed --owner you@example.com
//   REEVE_SEED_OWNER=you@example.com pnpm db:seed

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

const ownerFlag = process.argv.indexOf("--owner");
const ownerEmail =
  (ownerFlag !== -1 ? process.argv[ownerFlag + 1] : undefined) ?? process.env.REEVE_SEED_OWNER;

if (!ownerEmail) {
  console.error(
    "An owner is required. Areas are owner-scoped, and a row seeded without\n" +
      "one is readable by nobody.\n\n" +
      "  pnpm db:seed --owner you@example.com",
  );
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

  const { rows } = await client.query("select id from auth.users where email = $1", [ownerEmail]);
  if (rows.length === 0) {
    console.error(`No account found for ${ownerEmail}. Areas belong to a user, not to the project.`);
    process.exit(1);
  }
  const ownerId = rows[0].id;

  for (const a of areas) {
    await client.query(
      `insert into areas (owner_id, id, label, classifier_hint, colour, sort_order, active)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, true))
       on conflict (owner_id, id) do update set
         label = excluded.label,
         classifier_hint = excluded.classifier_hint,
         colour = excluded.colour,
         sort_order = excluded.sort_order,
         active = excluded.active`,
      [ownerId, a.id, a.label, a.classifier_hint, a.colour, a.sort_order ?? 0, a.active ?? true],
    );
    console.log(`✓ ${a.id}`);
  }
  console.log(`Seeded ${areas.length} area(s) for ${ownerEmail}.`);
} finally {
  await client.end().catch(() => {});
}
