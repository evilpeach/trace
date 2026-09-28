import { describe, expect, it } from "vitest";
import { exampleReport } from "@trace/report-contract";
import { journeyContext } from "./journeys";

const supporting = { ...exampleReport.flows[0], id: "supporting" };
const central = { ...exampleReport.flows[0], id: "central" };
const flows = [supporting, central];
const mainJourney = { flowId: central.id, why: "The central user outcome." };

describe("explicit main journey presentation", () => {
  it("opens the main journey first without mutating report order", () => {
    const context = journeyContext({ flows, mainJourney });
    expect(context.journeys.map((flow) => flow.id)).toEqual([
      "central",
      "supporting",
    ]);
    expect(context.selected).toBe(central);
    expect(context.isMain).toBe(true);
    expect(context.whyMain).toBe(mainJourney.why);
    expect(flows.map((flow) => flow.id)).toEqual(["supporting", "central"]);
  });

  it("honors an existing selection without mislabeling it as main", () => {
    const context = journeyContext({ flows, mainJourney }, supporting.id);
    expect(context.selected).toBe(supporting);
    expect(context.isMain).toBe(false);
    expect(context.whyMain).toBeUndefined();
    expect(context.mainId).toBe(central.id);
  });

  it("does not infer importance from first position in an older report", () => {
    const context = journeyContext({ flows });
    expect(context.selected).toBe(supporting);
    expect(context.isMain).toBe(false);
    expect(context.mainId).toBeUndefined();
    expect(context.whyMain).toBeUndefined();
  });

  it("falls back from a removed selection and handles an empty report", () => {
    expect(journeyContext({ flows, mainJourney }, "removed").selected).toBe(
      central,
    );
    expect(journeyContext({ flows: [] }).selected).toBeUndefined();
    expect(journeyContext({ flows: [] }).isMain).toBe(false);
  });
});
