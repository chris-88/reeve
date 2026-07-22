#!/usr/bin/env node
// Asserts no secret reached the browser bundle. Runs after every web build.
//
// Only VITE_-prefixed vars are exposed to client code, so a leak should be
// impossible by construction — but "should be impossible" is exactly the class
// of thing worth checking, because the failure is silent and permanent.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true });

const DIST = path.join(ROOT, "apps", "web", "dist");

// Values that must never appear in a build artefact.
//
// The exact-value check is the only defence for a credential with no
// distinctive shape, and it only works for names listed here. A VAPID private
// key is 32 base64url bytes with no prefix; the pattern list below cannot see
// it, so leaving it off this array would leave it entirely uncovered.
const SECRETS = [
  "DATABASE_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "VAPID_PRIVATE_KEY",
  "GITHUB_ISSUES_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
];

// Patterns that indicate a leaked credential even if it isn't in our .env.local
// (a teammate's key, a stale value pasted into source).
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/sbp_[a-f0-9]{40}/, "Supabase access token"],
  [/postgresql:\/\/[^\s"']*:[^\s"']+@/, "Postgres connection string with password"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT (possible service_role key)"],
  // A Sentry org token is `sntrys_` plus a single base64 blob — no
  // dot-separated segments, so the JWT pattern above never matches it. During
  // provisioning this token was pasted into SENTRY_DSN, one keystroke from
  // VITE_SENTRY_DSN, which compiles into the bundle and publishes to Pages.
  [/sntrys_[A-Za-z0-9+/=_-]{10,}/, "Sentry auth token"],
  // GitHub tokens. Reeve files issues; it never holds a token that can push
  // code, and neither kind may reach the browser.
  [/\bghp_[A-Za-z0-9]{20,}/, "GitHub personal access token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/\bgho_[A-Za-z0-9]{20,}/, "GitHub OAuth token"],
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const findings = [];
let scanned = 0;

for await (const file of walk(DIST)) {
  if (!/\.(js|css|html|json|map|webmanifest)$/.test(file)) continue;
  const content = await readFile(file, "utf8");
  scanned++;
  const rel = path.relative(ROOT, file);

  for (const name of SECRETS) {
    const value = process.env[name];
    if (value && value.length > 8 && content.includes(value)) {
      findings.push(`${rel}: contains the value of ${name}`);
    }
  }
  for (const [pattern, label] of PATTERNS) {
    const m = content.match(pattern);
    if (m) findings.push(`${rel}: looks like a ${label} (${m[0].slice(0, 12)}…)`);
  }
}

if (findings.length > 0) {
  console.error("\n✗ Secret detected in build output — do not deploy:\n");
  for (const f of findings) console.error(`  ${f}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ No secrets in bundle (${scanned} files scanned)`);
