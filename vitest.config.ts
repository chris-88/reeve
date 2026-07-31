// Vitest config for the unit and integration suites under `tests/` — the `@/`
// alias, and the long timeouts and serial runs the live-backend tests need.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // The app uses the `@/` alias; a test importing an app module needs it too.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    // These hit the real Supabase project. They are slow and they are the only
    // thing that actually proves RLS works, which a mock cannot.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
