import type { ReportSummary } from "./native-types";

export function groupPullRequests(reports: ReportSummary[]) {
  const groups = new Map<
    string,
    { id: string; label: string; reports: ReportSummary[] }
  >();
  for (const report of reports) {
    const id = `${report.projectId}:${report.prNumber === null ? `branch:${report.reportId}` : `pr:${report.prNumber}`}`;
    const group = groups.get(id) ?? {
      id,
      label:
        report.prNumber === null ? "Branch review" : `PR #${report.prNumber}`,
      reports: [],
    };
    group.reports.push(report);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      reports: group.reports.sort(
        (a, b) =>
          Date.parse(b.generatedAt) - Date.parse(a.generatedAt) ||
          a.handle.localeCompare(b.handle),
      ),
    }))
    .sort(
      (a, b) =>
        Date.parse(b.reports[0].generatedAt) -
        Date.parse(a.reports[0].generatedAt),
    );
}
export function reportDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
