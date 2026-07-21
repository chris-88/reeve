import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Served from app.chrisquinn.ie via GitHub Pages, so the app sits at the
  // domain root rather than under a /repo-name/ path.
  base: "/",
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  envDir: path.resolve(import.meta.dirname, "../.."),
});
