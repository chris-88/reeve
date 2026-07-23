import { describe, expect, it } from "vitest";
import {
  DRAFT_JSON_SCHEMA,
  DraftResult,
  buildChangeRequestSystemPrompt,
  buildChangeRequestUserPrompt,
} from "../packages/shared/src/index.ts";

describe("DRAFT_JSON_SCHEMA", () => {
  // Structured outputs rejects an object without `required` on every property
  // and `additionalProperties: false`. Same closed-schema guard as triage.
  function assertClosed(node: unknown, path: string): void {
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;
    if (o.type === "object") {
      expect(o.additionalProperties, `${path}: additionalProperties`).toBe(false);
      const props = Object.keys((o.properties ?? {}) as object);
      expect((o.required as string[]).length, `${path}: required covers all props`).toBe(props.length);
    }
    for (const [k, v] of Object.entries(o)) assertClosed(v, `${path}.${k}`);
  }

  it("is closed at every object level", () => {
    assertClosed(DRAFT_JSON_SCHEMA, "root");
  });

  it("requires the six fields the function reads", () => {
    expect((DRAFT_JSON_SCHEMA as { required: string[] }).required).toEqual(
      expect.arrayContaining([
        "title",
        "body",
        "acceptance_criteria",
        "files_likely_touched",
        "size",
        "questions",
      ]),
    );
  });
});

describe("DraftResult", () => {
  const valid = {
    title: "Make the due date bigger",
    body: "The date is hard to read.",
    acceptance_criteria: ["The date is at least 1rem"],
    files_likely_touched: ["apps/web/src/screens/Due.tsx"],
    size: "small" as const,
    questions: [],
  };

  it("accepts a well-formed draft", () => {
    expect(DraftResult.safeParse(valid).success).toBe(true);
  });

  it("accepts empty criteria, files and questions", () => {
    // A fragment that implies no checkable criteria is still a valid draft —
    // the emptiness is surfaced, not invented around.
    const r = DraftResult.safeParse({
      ...valid,
      acceptance_criteria: [],
      files_likely_touched: [],
      questions: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a size outside the enum", () => {
    expect(DraftResult.safeParse({ ...valid, size: "epic" }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    const { questions: _omitted, ...partial } = valid;
    expect(DraftResult.safeParse(partial).success).toBe(false);
  });
});

describe("buildChangeRequestUserPrompt", () => {
  it("presents each capture's words with its id and date", () => {
    // F8.8: the raw words are the requirement. They must reach the model
    // verbatim, tagged with the id so the drafted issue can cite them.
    const prompt = buildChangeRequestUserPrompt([
      { id: "cap-1", raw_text: "the inbox feels cramped", created_at: "2026-07-20T09:00:00Z" },
      { id: "cap-2", raw_text: "why is the word count still there", created_at: "2026-07-22T18:00:00Z" },
    ]);
    expect(prompt).toContain("the inbox feels cramped");
    expect(prompt).toContain("why is the word count still there");
    expect(prompt).toContain("cap-1");
    expect(prompt).toContain("2026-07-22");
  });
});

describe("buildChangeRequestSystemPrompt", () => {
  it("forbids inventing requirements to resolve ambiguity", () => {
    // F8.5 is the load-bearing instruction. A confidently-specified wrong
    // thing is worse than an obviously incomplete one, because it gets built.
    const p = buildChangeRequestSystemPrompt().toLowerCase();
    expect(p).toContain("do not resolve ambiguity by inventing");
    expect(p).toContain("questions");
  });
});
