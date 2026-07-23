import { describe, expect, it } from "vitest";
import { assembleBrief } from "../apps/web/src/lib/brief.ts";

describe("assembleBrief", () => {
  it("includes the title, the capture's words, area and commitments", () => {
    const brief = assembleBrief({
      actionTitle: "Draft Mary's invoice",
      rawText: "invoice mary for the retaining wall, due friday",
      areaLabel: "Contracting",
      areaHint: "The building business.",
      commitments: [{ text: "Send Mary the invoice", due_text: "Friday" }],
    });
    expect(brief).toContain("# Draft Mary's invoice");
    expect(brief).toContain("**Area:** Contracting — The building business.");
    expect(brief).toContain("invoice mary for the retaining wall");
    expect(brief).toContain("- Send Mary the invoice (Friday)");
  });

  it("omits the area and commitment sections when there are none", () => {
    const brief = assembleBrief({ actionTitle: "Ring the foreman", rawText: "ring the foreman" });
    expect(brief).toContain("# Ring the foreman");
    expect(brief).toContain("## What Chris said");
    expect(brief).not.toContain("**Area:**");
    expect(brief).not.toContain("## Commitments");
  });
});
