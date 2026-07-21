import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // These hit the real Supabase project. They are slow and they are the only
    // thing that actually proves RLS works, which a mock cannot.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
