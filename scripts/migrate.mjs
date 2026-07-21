#!/usr/bin/env node
// Applies supabase/migrations/*.sql in filename order against DATABASE_URL.
//
// We use this rather than `supabase db push` because that shells out to Docker,
// which isn't available here. Each migration runs in its own transaction and is
// recorded in _reeve_migrations, so re-running is a no-op.

import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const statusOnly = process.argv.includes("--status");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

// Supabase terminates TLS with a chain Node doesn't ship a root for. The
// connection is still encrypted; we're only skipping chain verification.
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

try {
  await client.connect();
  await client.query(`
    create table if not exists _reeve_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);

  const applied = new Map(
    (await client.query("select name, checksum from _reeve_migrations")).rows.map((r) => [
      r.name,
      r.checksum,
    ]),
  );

  const files = (await readdir(MIGRATIONS_DIR).catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found in supabase/migrations/");
    process.exit(0);
  }

  let pending = 0;
  for (const name of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    const checksum = sha(sql);
    const prior = applied.get(name);

    if (prior && prior !== checksum) {
      // An applied migration was edited. Silently re-running it would diverge
      // this database from every other one, so stop and make it visible.
      console.error(`✗ ${name} has changed since it was applied (${prior} -> ${checksum}).`);
      console.error("  Add a new migration instead of editing an applied one.");
      process.exit(1);
    }
    if (prior) {
      console.log(`· ${name} (already applied)`);
      continue;
    }

    pending++;
    if (statusOnly) {
      console.log(`… ${name} (pending)`);
      continue;
    }

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _reeve_migrations (name, checksum) values ($1, $2)", [
        name,
        checksum,
      ]);
      await client.query("commit");
      console.log(`✓ ${name}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`✗ ${name} failed and was rolled back:\n  ${err.message}`);
      process.exit(1);
    }
  }

  console.log(
    pending === 0
      ? "Up to date."
      : statusOnly
        ? `${pending} migration(s) pending.`
        : `Applied ${pending} migration(s).`,
  );
} finally {
  await client.end().catch(() => {});
}
