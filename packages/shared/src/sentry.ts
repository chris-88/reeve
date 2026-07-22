/**
 * Server-side error reporting, without an SDK.
 *
 * Hardening F7.2 asks for Sentry in the Edge Function. A Sentry event is a
 * JSON POST with one header, so pulling a runtime SDK into Deno to send one
 * would add a dependency, a bundle and a compatibility surface to save about
 * twenty lines. The same shape is used by the `pg_cron` stuck-capture alert in
 * SQL, so there is one event format across the system rather than two.
 *
 * F7.4 governs what goes in one: **ids and counts, never capture content.**
 */

/** `https://<publicKey>@<host>/<projectId>` */
export type ParsedDsn = { url: string; publicKey: string };

/** Null rather than throwing: an unset or malformed DSN disables reporting. */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  const match = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/i.exec(dsn.trim());
  if (!match) return null;
  const [, publicKey, host, projectId] = match as unknown as [string, string, string, string];
  return { url: `https://${host}/api/${projectId}/store/`, publicKey };
}

export type ServerEvent = {
  message: string;
  level?: "error" | "warning" | "info";
  /** Indexed and searchable. Short, low-cardinality values only. */
  tags?: Record<string, string>;
  /** Ids and counts. Never `raw_text`, a commitment body, or model output. */
  extra?: Record<string, string | number | boolean | null>;
};

export function buildSentryEvent(
  event: ServerEvent,
  now: string,
  eventId: string,
): Record<string, unknown> {
  return {
    event_id: eventId.replace(/-/g, ""),
    timestamp: now,
    platform: "javascript",
    logger: "reeve",
    level: event.level ?? "error",
    message: { formatted: event.message },
    tags: event.tags ?? {},
    extra: event.extra ?? {},
  };
}

/**
 * Report, best effort.
 *
 * Never throws and never blocks the caller's outcome: a capture that was filed
 * correctly must not be marked failed because telemetry was unreachable. The
 * whole point of this is to observe the system, not to become part of it.
 */
export async function reportToSentry(
  dsn: string | undefined | null,
  event: ServerEvent,
): Promise<void> {
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  try {
    await fetch(parsed.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=reeve/1.0`,
      },
      body: JSON.stringify(
        buildSentryEvent(event, new Date().toISOString(), crypto.randomUUID()),
      ),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error("[reeve] could not report to Sentry", err);
  }
}
