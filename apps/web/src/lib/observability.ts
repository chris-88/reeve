import * as Sentry from "@sentry/react";

/**
 * Hardening F7: the instrument that would tell you durability had broken.
 *
 * Every failure mode the hardening spec describes is otherwise silent — an
 * outbox that wedges in a pocket, a capture stuck at `queued`, a service
 * worker that fails to activate. The system's core promise is durability and
 * there has been nothing watching it.
 *
 * F7.4 is the constraint that shapes this file: **captures are personal, and
 * none of their content leaves the device through here.** The same reasoning
 * that put `areas.json` behind `.gitignore`, with more force — a crash report
 * goes to a third party. Ids travel; words do not.
 */

/**
 * Keys whose values are capture content, or near enough.
 *
 * Belt and braces: nothing in this app deliberately puts them in an event, so
 * anything matching here is a mistake, and a mistake in this direction is
 * unrecoverable once it has been sent.
 */
const FORBIDDEN_KEYS = /^(raw_text|text|summary|title|body|classifier_hint|due_text|content)$/i;

/** Recursively drop anything that could carry what someone wrote. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = FORBIDDEN_KEYS.test(key) ? "[scrubbed]" : scrub(v, depth + 1);
  }
  return out;
}

export function initObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  // Optional on purpose. Reeve boots and captures without telemetry; making
  // this required would trade a silent instrument for a dead app, which is the
  // trade check-bundle.mjs's REQUIRED_PUBLIC note exists to avoid repeating.
  if (!dsn) return;

  Sentry.init({
    dsn,
    release: __BUILD_ID__,
    environment: import.meta.env.DEV ? "development" : "production",
    // F7.1: this is where the outbox's `void flush()` failures currently
    // vanish — nothing awaits them, so nothing reports them.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    // Personal content is the whole risk here. No request bodies, no IPs.
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb(breadcrumb) {
      // A fetch breadcrumb carries the URL, which for Supabase REST carries
      // the query — including filter values. Keep the path, drop the rest.
      if (breadcrumb.data?.url && typeof breadcrumb.data.url === "string") {
        try {
          const url = new URL(breadcrumb.data.url);
          breadcrumb.data.url = `${url.origin}${url.pathname}`;
        } catch {
          delete breadcrumb.data.url;
        }
      }
      breadcrumb.data = scrub(breadcrumb.data) as Record<string, unknown>;
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      // A request body would be the single most likely place for capture text
      // to escape, and nothing here needs it.
      if (event.request) delete event.request.data;
      return event;
    },
  });
}

/**
 * F7.5: the durability path, as breadcrumbs.
 *
 * When something does go wrong the question is always the same — did the write
 * become durable, did the flush run, did it land. These are the events that
 * answer it, and they carry ids and counts only.
 */
export function trail(
  message: string,
  data?: Record<string, string | number | boolean | undefined>,
): void {
  Sentry.addBreadcrumb({ category: "reeve", level: "info", message, data });
}

/** Report something that went wrong but was handled. */
export function report(error: unknown, context?: Record<string, string | number>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
