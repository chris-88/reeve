import { describe, expect, it } from "vitest";
import { buildSentryEvent, parseDsn } from "../packages/shared/src/sentry.ts";

describe("parseDsn", () => {
  it("splits a DSN into its store endpoint and public key", () => {
    // The EU host is the point: sentry-cli and the SDKs default to sentry.io,
    // which is US, and against an EU org that fails as "project not found".
    const parsed = parseDsn("https://abc123def456@o4511779418210304.ingest.de.sentry.io/4511779420700752");
    expect(parsed).toEqual({
      url: "https://o4511779418210304.ingest.de.sentry.io/api/4511779420700752/store/",
      publicKey: "abc123def456",
    });
  });

  it("disables reporting rather than throwing on anything malformed", () => {
    // Telemetry must never become the reason a capture fails to file.
    for (const dsn of [undefined, null, "", "   ", "not-a-dsn", "http://k@h/1", "https://k@h"]) {
      expect(parseDsn(dsn), String(dsn)).toBeNull();
    }
  });
});

describe("buildSentryEvent", () => {
  const now = "2026-07-22T12:00:00.000Z";
  const id = "3f1c9a2e-1111-2222-3333-444455556666";

  it("carries the fields Sentry needs, with a dashless event id", () => {
    const event = buildSentryEvent({ message: "triage failed" }, now, id);
    // Sentry wants 32 hex characters, not a formatted uuid.
    expect(event.event_id).toBe("3f1c9a2e111122223333444455556666");
    expect(event.timestamp).toBe(now);
    expect(event.level).toBe("error");
    expect(event.message).toEqual({ formatted: "triage failed" });
  });

  it("keeps ids and counts in extra", () => {
    // F7.4 is enforced at the call sites — this asserts the envelope passes
    // through exactly what it was given and adds nothing of its own.
    const event = buildSentryEvent(
      {
        message: "triage failed",
        level: "warning",
        tags: { step: "triage" },
        extra: { capture_id: "abc", attempt: 2 },
      },
      now,
      id,
    );
    expect(event.level).toBe("warning");
    expect(event.tags).toEqual({ step: "triage" });
    expect(event.extra).toEqual({ capture_id: "abc", attempt: 2 });
  });
});
