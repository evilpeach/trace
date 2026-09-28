import { describe, expect, it } from "vitest";
import { sortFindingsBySeverity } from "./finding-severity";
import type { Priority } from "@trace/report-contract";

describe("sortFindingsBySeverity", () => {
  it("orders the complete finding queue by severity, with unclassified findings last", () => {
    const findings: { id: string; priority: Priority | null }[] = [
      { id: "unknown", priority: null },
      { id: "medium", priority: "P2" },
      { id: "low", priority: "P3" },
      { id: "critical", priority: "P0" },
      { id: "high", priority: "P1" },
    ];
    expect(sortFindingsBySeverity(findings).map((item) => item.id)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
      "unknown",
    ]);
    expect(findings[0].id).toBe("unknown");
  });

  it("retains authored ordering within a level across regeneration", () => {
    const findings = [
      { id: "first-medium", priority: "P2" as const },
      { id: "high", priority: "P1" as const },
      { id: "second-medium", priority: "P2" as const },
    ];
    expect(sortFindingsBySeverity(findings).map((item) => item.id)).toEqual([
      "high",
      "first-medium",
      "second-medium",
    ]);
  });
});
