import type { TraceReport } from "@trace/report-contract";

/** Presentation order never changes the authored report or reviewer selections. */
export function journeyContext(
  report: Pick<TraceReport, "flows" | "mainJourney">,
  selectedId = "",
) {
  const main = report.mainJourney
    ? report.flows.find((flow) => flow.id === report.mainJourney?.flowId)
    : undefined;
  const journeys = main
    ? [main, ...report.flows.filter((flow) => flow.id !== main.id)]
    : report.flows;
  const selected =
    journeys.find((flow) => flow.id === selectedId) ?? journeys[0];
  const isMain = Boolean(main && selected?.id === main.id);
  return {
    journeys,
    selected,
    mainId: main?.id,
    isMain,
    whyMain: isMain ? report.mainJourney?.why : undefined,
  };
}
