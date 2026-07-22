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
  /**
   * WP-F1.4. Public by design — `pushManager.subscribe` needs it client-side.
   *
   * Checked at boot rather than at the moment someone taps "notify me": a
   * denied permission cannot be re-requested, so a misconfiguration that only
   * surfaces at the tap burns the one chance the app gets to ask.
   *
   * 65 uncompressed P-256 bytes, base64url — 87 characters.
   */
  VITE_VAPID_PUBLIC_KEY: z.string().min(80),
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
