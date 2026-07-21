import { describe, expect, it } from "vitest";
import {
  EMPTY_ENTITIES,
  MODELS,
  TRIAGE_JSON_SCHEMA,
  TriageResult,
  UNSORTED_AREA_ID,
  buildTriageSystemPrompt,
  costUsd,
  type Area,
} from "../packages/shared/src/index.ts";

const area = (over: Partial<Area> & Pick<Area, "id">): Area => ({
  label: "Label",
  classifier_hint: "Hint.",
  colour: "#fff",
  sort_order: 0,
  active: true,
  ...over,
});

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

  it("requires the four fields the Edge Function writes", () => {
    expect((TRIAGE_JSON_SCHEMA as { required: string[] }).required).toEqual(
      expect.arrayContaining(["area_id", "title", "summary", "entities"]),
    );
  });
});

describe("TriageResult", () => {
  const valid = {
    area_id: "personal",
    title: "Bins out Tuesday",
    summary: "The bins go out on Tuesday.",
    entities: { ...EMPTY_ENTITIES, dates: ["Tuesday"] },
  };

  it("accepts well-formed output", () => {
    expect(TriageResult.safeParse(valid).success).toBe(true);
  });

  it("accepts entirely empty entities", () => {
    // Empty arrays are correct output, not a failure to extract.
    const r = TriageResult.safeParse({ ...valid, entities: EMPTY_ENTITIES });
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
});

describe("buildTriageSystemPrompt", () => {
  const areas = [
    area({ id: "work", label: "Work", classifier_hint: "Anything job related." }),
    area({ id: "retired", label: "Retired", active: false }),
    area({ id: UNSORTED_AREA_ID, label: "Unsorted", sort_order: 999 }),
  ];

  it("includes active areas with their hints", () => {
    const p = buildTriageSystemPrompt(areas);
    expect(p).toContain("work (Work): Anything job related.");
  });

  it("excludes inactive areas", () => {
    // An inactive area must not be offered, or captures land somewhere unusable.
    expect(buildTriageSystemPrompt(areas)).not.toContain("retired");
  });

  it("instructs the model to prefer unsorted over guessing", () => {
    const p = buildTriageSystemPrompt(areas);
    expect(p).toContain(UNSORTED_AREA_ID);
    expect(p.toLowerCase()).toContain("not a failure state");
  });

  it("orders areas by sort_order", () => {
    const p = buildTriageSystemPrompt(areas);
    expect(p.indexOf("work (Work)")).toBeLessThan(p.indexOf(`${UNSORTED_AREA_ID} (Unsorted)`));
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
