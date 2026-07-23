import { z } from "zod";

/**
 * The drafting agent's house style and output contract.
 *
 * Its own file, mirroring `triage-prompt.ts` and `brief-prompt.ts`. F8.6: the
 * style lives here, not fetched from the repository's own specs — that would
 * be a retrieval feature to be earned, and `docs/spec.md` is gitignored so it
 * is not there to fetch anyway.
 */

export const CHANGE_REQUEST_SIZES = ["small", "medium", "large"] as const;

/**
 * F8.4: the output shape. Closed and fully required, the same discipline as
 * `TriageResult` — structured outputs rejects an object without `required` on
 * every property and `additionalProperties: false`.
 */
export const DraftResult = z.object({
  title: z
    .string()
    .describe("A short imperative title. What the change does, not 'a change to...'."),
  body: z
    .string()
    .describe(
      "The issue body in markdown. State the problem, then the change. Quote the source captures verbatim where they motivate a point — the raw words are the requirement.",
    ),
  acceptance_criteria: z
    .array(z.string())
    .describe("Concrete, checkable conditions for the change being done. Empty if genuinely none apply."),
  files_likely_touched: z
    .array(z.string())
    .describe("Best-guess file paths a developer would start from. Empty if unknown — do not invent paths."),
  size: z.enum(CHANGE_REQUEST_SIZES).describe("A rough effort estimate."),
  questions: z
    .array(z.string())
    .describe(
      "Anything you had to guess to write this. Every ambiguity you resolved by assumption goes here instead of into the body.",
    ),
});
export type DraftResult = z.infer<typeof DraftResult>;

const { $schema: _dropped, ...draftSchema } = z.toJSONSchema(DraftResult, {
  io: "output",
}) as Record<string, unknown>;

export const DRAFT_JSON_SCHEMA = draftSchema;

/** A capture as the drafting agent sees it: its own words, and where it was filed. */
export type SourceCapture = { id: string; raw_text: string; created_at: string };

export function buildChangeRequestSystemPrompt(): string {
  return `You are drafting a change request for Reeve — a thought-capture app its owner, Chris, is building for himself. He dictates thoughts about the app on the move; they are filed under a "reeve" area, and now several of them are being turned into one issue a developer or a coding agent can act on.

Your output is read by whoever builds the change. It has to be specific enough to act on and honest about what it does not know.

The captures you are given are fragmentary, dictated, and span several days. Read them as one intent where they share one, and say so where they do not.

Rules:

- Write the body in the plain, declarative style of a good issue: the problem first, in one or two sentences, then the change that addresses it. No preamble, no "this ticket proposes", no restating the title.
- Quote the source captures verbatim where they motivate a point. The raw words are the requirement; your prose is an interpretation of them, and the reviewer needs both. Use markdown blockquotes.
- **Do not resolve ambiguity by inventing requirements.** A dictated fragment frequently does not contain enough to specify a change. Anything you had to guess — a value, a scope, which of two readings was meant — goes in questions, not silently into the body. A confidently-specified wrong thing is worse than an obviously incomplete one, because the first gets built.
- acceptance_criteria: concrete and checkable. "The date is at least 1rem", not "the date is bigger". Empty is acceptable when the captures genuinely do not imply any.
- files_likely_touched: a starting point, not a promise. If you cannot tell, leave it empty rather than guessing paths that may not exist.
- size: small is an afternoon, medium is a day or two, large is more. Estimate the change as described, not as it might grow.
- If the captures do not actually cohere into one change — if they are two unrelated ideas that happened to be filed together — say so in questions and draft the more developed one.

Write in Irish/British English.`;
}

export function buildChangeRequestUserPrompt(captures: readonly SourceCapture[]): string {
  const blocks = captures
    .map(
      (c, i) =>
        `Capture ${i + 1} (id ${c.id}, ${c.created_at.slice(0, 10)}):\n${c.raw_text.trim()}`,
    )
    .join("\n\n");
  return `Draft one change request from these ${captures.length} capture(s):\n\n${blocks}`;
}
