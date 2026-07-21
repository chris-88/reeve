import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative so the same build works both at the domain root
  // (app.chrisquinn.ie) and under a subpath (chris-88.github.io/reeve/).
  // Safe here because the app has no client-side routing — two screens,
  // switched by state.
  base: "./",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  envDir: path.resolve(import.meta.dirname, "../.."),
});
