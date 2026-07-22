import { describe, expect, it } from "vitest";
import {
  EMPTY_ENTITIES,
  MODELS,
  TIMEZONE,
  TRIAGE_JSON_SCHEMA,
  TriageResult,
  UNSORTED_AREA_ID,
  buildTriageSystemPrompt,
  costUsd,
  type Area,
} from "../packages/shared/src/index.ts";

const area = (over: Partial<Area> & Pick<Area, "id">): Area => ({
  owner_id: "11111111-1111-1111-1111-111111111111",
  label: "Label",
  classifier_hint: "Hint.",
  colour: "#fff",
  sort_order: 0,
  active: true,
  ...over,
});

/** A Thursday, so "next Tuesday" and a bare weekday both have a real answer. */
const CAPTURED_AT = "2026-07-23T09:15:00.000Z";

describe("TRIAGE_JSON_SCHEMA", () => {
  /**
   * Structured outputs rejects objects without `required` on every property and
   * `additionalProperties: false`. A schema that drifts out of compliance fails
   * at request time with a 400, so assert it here instead.
   */
  function assertClosed(node: unknown, path: string): void {
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;

    if (o.type === "object") {
      expect(o.additionalProperties, `${path}: additionalProperties`).toBe(false);
      const props = Object.keys((o.properties ?? {}) as object);
      expect(o.required, `${path}: required`).toEqual(expect.arrayContaining(props));
      expect((o.required as string[]).length, `${path}: required covers all props`).toBe(
        props.length,
      );
    }
    for (const [k, v] of Object.entries(o)) assertClosed(v, `${path}.${k}`);
  }

  it("is closed at every object level", () => {
    assertClosed(TRIAGE_JSON_SCHEMA, "root");
  });

  it("carries no $schema key", () => {
    // Not a supported keyword; an unrecognised root key risks a 400.
    expect(TRIAGE_JSON_SCHEMA).not.toHaveProperty("$schema");
  });

  it("requires the five fields the Edge Function writes", () => {
    expect((TRIAGE_JSON_SCHEMA as { required: string[] }).required).toEqual(
      expect.arrayContaining(["area_id", "title", "summary", "entities", "commitments"]),
    );
  });
});

describe("TriageResult", () => {
  const valid = {
    area_id: "personal",
    title: "Bins out Tuesday",
    summary: "The bins go out on Tuesday.",
    entities: { ...EMPTY_ENTITIES, dates: ["Tuesday"] },
    commitments: [
      { text: "Put the bins out", due_text: "Tuesday", due_at: "2026-07-28" },
    ],
  };

  it("accepts well-formed output", () => {
    expect(TriageResult.safeParse(valid).success).toBe(true);
  });

  it("accepts entirely empty entities", () => {
    // Empty arrays are correct output, not a failure to extract.
    const r = TriageResult.safeParse({ ...valid, entities: EMPTY_ENTITIES, commitments: [] });
    expect(r.success).toBe(true);
  });

  it("rejects a missing entity group", () => {
    const { people: _omitted, ...partial } = EMPTY_ENTITIES;
    expect(TriageResult.safeParse({ ...valid, entities: partial }).success).toBe(false);
  });

  it("rejects a missing top-level field", () => {
    const { summary: _omitted, ...partial } = valid;
    expect(TriageResult.safeParse(partial).success).toBe(false);
  });

  it("accepts a commitment with no date at all", () => {
    // P1-F1.5: "I'll sort the insurance at some point" is a real obligation.
    // Dropping it because it has no date is the failure mode routing to
    // 'unsorted' exists to avoid, in a different costume.
    const r = TriageResult.safeParse({
      ...valid,
      commitments: [{ text: "Sort the insurance", due_text: null, due_at: null }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a commitment missing due_at", () => {
    // Structured outputs requires every property; null is how absence is said.
    const r = TriageResult.safeParse({
      ...valid,
      commitments: [{ text: "Sort the insurance", due_text: null }],
    });
    expect(r.success).toBe(false);
  });
});

describe("buildTriageSystemPrompt", () => {
  const areas = [
    area({ id: "work", label: "Work", classifier_hint: "Anything job related." }),
    area({ id: "retired", label: "Retired", active: false }),
    area({ id: UNSORTED_AREA_ID, label: "Unsorted", sort_order: 999 }),
  ];

  const prompt = () => buildTriageSystemPrompt(areas, { capturedAt: CAPTURED_AT });

  it("includes active areas with their hints", () => {
    expect(prompt()).toContain("work (Work): Anything job related.");
  });

  it("excludes inactive areas", () => {
    // An inactive area must not be offered, or captures land somewhere unusable.
    expect(prompt()).not.toContain("retired");
  });

  it("instructs the model to prefer unsorted over guessing", () => {
    expect(prompt()).toContain(UNSORTED_AREA_ID);
    expect(prompt().toLowerCase()).toContain("not a failure state");
  });

  it("orders areas by sort_order", () => {
    const p = prompt();
    expect(p.indexOf("work (Work)")).toBeLessThan(p.indexOf(`${UNSORTED_AREA_ID} (Unsorted)`));
  });

  it("states the capture's own date, with its weekday", () => {
    // P1-F1.4. Without this "Thursday" is unresolvable, and the model was
    // previously being asked to extract dates it had no way to anchor.
    const p = prompt();
    expect(p).toContain("2026-07-23");
    expect(p).toContain("Thursday");
    expect(p).toContain(TIMEZONE);
  });

  it("anchors on the capture, not on now", () => {
    // A capture swept off the queue days late must resolve against the day it
    // was written. Using the current date here would silently misdate anything
    // the cron sweeper picks up.
    const p = buildTriageSystemPrompt(areas, { capturedAt: "2026-01-02T23:30:00.000Z" });
    expect(p).toContain("2026-01-02");
    expect(p).not.toContain("2026-07-23");
  });
});

describe("costUsd", () => {
  it("prices the triage model", () => {
    // 1M in + 1M out on Haiku 4.5 = $1 + $5.
    expect(costUsd(MODELS.triage, 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
  });

  it("returns null for an unpriced model rather than guessing", () => {
    // A null in agent_runs.cost_usd is a visible prompt to add pricing;
    // a wrong number silently corrupts the spend history.
    expect(costUsd("claude-not-a-real-model", 100, 100)).toBeNull();
  });
});
