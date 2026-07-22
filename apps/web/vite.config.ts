import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";

// Changes on every build; used to bust the persisted query cache so a schema
// change cannot resurrect incompatible cached rows.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) ?? String(Date.now());

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Single origin. Service worker scope, manifest id, push subscription
  // endpoints and storage partitioning are all origin- and path-bound, so
  // serving one build from two URLs produces two installations with two
  // separate data stores. chris-88.github.io/reeve/ 301s to the custom domain.
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      /**
       * injectManifest, not generateSW.
       *
       * Web Push, Background Sync and a share target are all service worker
       * event handlers and are all plausible next steps. Owning the worker
       * source means adding them later is an edit, not a restructure.
       */
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      /**
       * Never auto-update. Swapping the JS bundle under someone who is
       * mid-sentence is precisely the data loss this hardening exists to
       * prevent — the update is offered, and applying it is the user's call.
       */
      registerType: "prompt",
      injectManifest: {
        // The whole shell is ~800 KB; there is no reason to be selective.
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
      },
      devOptions: { enabled: false },
      manifest: {
        /**
         * A stable id. Without it, app identity derives from start_url, so
         * changing start_url later orphans every existing installation and
         * installs a duplicate rather than updating.
         */
        id: "/",
        name: "Reeve",
        short_name: "Reeve",
        description: "Capture a thought, and it gets filed.",
        lang: "en-IE",
        dir: "ltr",
        categories: ["productivity", "utilities"],
        start_url: "/",
        scope: "/",
        /**
         * WP-F3.2. Tapping a notification must return to the app that is
         * already open, not start a second copy alongside it — two windows
         * means two outboxes racing the same queue.
         */
        launch_handler: { client_mode: "focus-existing" },
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        background_color: "#0c0b0d",
        theme_color: "#0c0b0d",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // Maskable needs ~40% safe-zone padding, so it cannot be the same
          // asset as "any" — one or the other would be clipped or undersized.
          {
            src: "/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    /**
     * F7.3: upload sourcemaps, and only where there is a token to do it with.
     *
     * The org is in the **EU region**. sentry-cli and this plugin both default
     * to sentry.io, which is US, and against an EU org that fails as "project
     * not found" — a message that sends you hunting for a typo in the project
     * slug. `url` is not optional here.
     *
     * Absent in a local build, so `pnpm build` needs no Sentry credentials.
     */
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            url: process.env.SENTRY_URL,
            release: { name: BUILD_ID },
            // deploy.yml strips .map from the Pages artefact after the build.
            sourcemaps: { filesToDeleteAfterUpload: [] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  envDir: path.resolve(import.meta.dirname, "../.."),
  build: {
    // Uploaded to Sentry in CI, never deployed to Pages.
    sourcemap: true,
  },
});
