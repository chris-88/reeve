#!/usr/bin/env node
// P1-F13.5: fail the run if test fixtures are accumulating.
//
// The suites run against the live project. A test account that quietly grows
// past the real one is not a tidiness problem — it is the precondition for the
// data loss recorded in docs/arc-spec-phase-1.md §0, where a migration derived
// ownership from row counts and picked the account holding 24 fixtures against
// the owner's 5.
//
// That state existed for weeks and nothing was watching. This watches.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ACCUMULATION_LIMIT, assertNoAccumulation, testAccountIds } from "../tests/support/test-accounts.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("VITE_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });

const accounts = await testAccountIds(admin);
const offenders = await assertNoAccumulation(admin);

if (offenders.length > 0) {
  console.error("\n✗ Test fixtures are accumulating in the live project:\n");
  for (const o of offenders) {
    console.error(`  ${o.userId}: ${o.captures} captures (limit ${ACCUMULATION_LIMIT})`);
  }
  console.error(
    "\n  A suite is not tearing down. Fix the teardown rather than raising the\n" +
      "  limit — this is the state that misled the ownership backfill.\n",
  );
  process.exit(1);
}

console.log(`✓ ${accounts.length} test account(s), none accumulating`);
