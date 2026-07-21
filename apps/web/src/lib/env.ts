import { z } from "zod";

/**
 * Only VITE_-prefixed vars reach the browser bundle. Anything secret
 * (DATABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY) lives in .env.local
 * without the prefix and is therefore invisible here by construction.
 *
 * `scripts/check-bundle.mjs` asserts after every build that none of those
 * strings made it into dist/ anyway.
 */
const Env = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

const parsed = Env.safeParse(import.meta.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Missing or invalid environment configuration: ${missing}. ` +
      `Copy .env.example to .env.local at the repo root and fill it in.`,
  );
}

export const env = parsed.data;
