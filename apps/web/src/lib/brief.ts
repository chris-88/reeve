/**
 * AQ-4: the handoff brief an agent receives when Chris says "Go".
 *
 * Assembled from the action title, the capture's own words, the area and its
 * context, and any commitments — everything an agent needs to act without the
 * app. Kept close in shape to what a change-request handoff produces, so that
 * automating dispatch later (spec.md §9) is wiring, not redesign.
 */
export function assembleBrief(input: {
  actionTitle: string;
  rawText: string;
  areaLabel?: string | null;
  areaHint?: string | null;
  commitments?: { text: string; due_text?: string | null }[];
}): string {
  const lines: string[] = [`# ${input.actionTitle}`, ""];

  if (input.areaLabel) {
    lines.push(`**Area:** ${input.areaLabel}${input.areaHint ? ` — ${input.areaHint}` : ""}`, "");
  }

  lines.push("## What Chris said", input.rawText.trim(), "");

  if (input.commitments?.length) {
    lines.push("## Commitments");
    for (const c of input.commitments) {
      lines.push(`- ${c.text}${c.due_text ? ` (${c.due_text})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
