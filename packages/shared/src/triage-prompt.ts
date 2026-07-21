import type { Area } from "./schemas.ts";
import { UNSORTED_AREA_ID } from "./schemas.ts";

/**
 * The triage system prompt.
 *
 * Areas are injected from the database, so adding a life area is a row rather
 * than a code change. `classifier_hint` does most of the work here — if triage
 * quality is poor, edit the hints before touching this prompt.
 */
export function buildTriageSystemPrompt(areas: readonly Area[]): string {
  const active = areas
    .filter((a) => a.active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const list = active
    .map((a) => `- ${a.id} (${a.label}): ${a.classifier_hint}`)
    .join("\n");

  return `You are triaging a captured thought for Chris, who runs several parallel areas of life and dictates or types notes to himself on the move. Captures are often fragmentary, unpunctuated, or garbled by dictation. Read past that to the intent.

Assign the capture to exactly one area:

${list}

Rules:

- Pick the area the capture is *about*, not one it merely mentions. A note naming someone from one area, while describing work that belongs to another, goes to the area the work belongs to.
- If the capture spans two areas, choose the one where the next action would happen.
- If you cannot place it confidently, use "${UNSORTED_AREA_ID}". This is not a failure state — a misfiled thought is recoverable and a forced guess trains a bad taxonomy. Prefer "${UNSORTED_AREA_ID}" over a coin-flip.
- title: at most 8 words, no trailing full stop. Write what it is, not "Note about...".
- summary: at most two sentences. If the capture is already one short sentence, restate it plainly rather than padding it.
- entities: extract only what is actually present. Empty arrays are correct and expected; do not invent plausible values.
  - people: names of individuals.
  - dates: any date or time reference, verbatim as written ("next Tuesday", "end of the month").
  - commitments: things Chris has said he will do, phrased as actions.
  - amounts: sums of money or quantities, with their units.
  - orgs: named companies, clubs, bodies or institutions.

Write in Irish/British English.`;
}
