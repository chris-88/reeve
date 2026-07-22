import { describe, expect, it } from "vitest";
import {
  commitmentFingerprint,
  dueAtFromDate,
  normaliseCommitmentText,
} from "../packages/shared/src/commitments.ts";

const CAPTURE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("normaliseCommitmentText", () => {
  it("ignores casing, spacing and trailing punctuation", () => {
    expect(normaliseCommitmentText("Ring the foreman.")).toBe(
      normaliseCommitmentText("ring  the FOREMAN"),
    );
  });

  it("keeps genuinely different wording different", () => {
    expect(normaliseCommitmentText("Ring the foreman")).not.toBe(
      normaliseCommitmentText("Ring the surveyor"),
    );
  });
});

describe("commitmentFingerprint", () => {
  it("is stable across re-triage of the same capture", async () => {
    // The property the whole idempotency guarantee rests on: the model
    // rephrasing its own output between runs must not create a second row.
    const a = await commitmentFingerprint(CAPTURE, "Ring the foreman about the pour.");
    const b = await commitmentFingerprint(CAPTURE, "ring the foreman about the pour");
    expect(a).toBe(b);
  });

  it("separates the same promise made in two captures", async () => {
    // Saying the same thing twice on different days is two obligations, not
    // one — and collapsing them would hide the second.
    const a = await commitmentFingerprint(CAPTURE, "Ring the foreman");
    const b = await commitmentFingerprint(OTHER, "Ring the foreman");
    expect(a).not.toBe(b);
  });
});

describe("dueAtFromDate", () => {
  it("lands on the intended day in Dublin", () => {
    // Midnight UTC, because Ireland is never behind it. The day the user reads
    // is the day the model resolved.
    const at = dueAtFromDate("2026-07-23");
    expect(at).toBe("2026-07-23T00:00:00.000Z");
    expect(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date(at!)),
    ).toBe("2026-07-23");
  });

  it("refuses anything that is not a plain date", () => {
    // The model returning the phrase back unresolved must not become a due
    // date of "Invalid Date" — the commitment stays undated and visible.
    expect(dueAtFromDate("Thursday")).toBeNull();
    expect(dueAtFromDate("next week")).toBeNull();
    expect(dueAtFromDate("2026-07-23T09:00:00Z")).toBeNull();
    expect(dueAtFromDate(null)).toBeNull();
    expect(dueAtFromDate("")).toBeNull();
  });
});
